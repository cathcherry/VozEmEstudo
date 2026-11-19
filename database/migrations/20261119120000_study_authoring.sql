-- Study authoring: named summary versions, named question lists with custom counts and
-- read-only question-list shares. MIGRATION CANDIDATE, NOT APPLIED.
-- Apply only with backup, database/checks/authoring-preflight.sql, explicit approval and the
-- correct environment. Then enable FEATURE_STUDY_AUTHORING.
--
-- Additive: nullable/defaulted columns, new functions and one new table. Existing functions are
-- not replaced. The single constraint change WIDENS question_batches.requested_count from
-- {3,5,10,20} to 1..100: every existing row already satisfies the new rule and no row is touched.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
begin
  if to_regclass('public.summary_versions') is null
    or to_regclass('public.question_batches') is null
    or to_regprocedure('public.commit_summary_admin(uuid,uuid,text,text,text)') is null
    or to_regprocedure('public.require_material_permission_admin(uuid,uuid,text)') is null
    or not exists (
      select 1 from pg_constraint
      where conrelid = 'public.materials'::regclass and conname = 'materials_id_user_planning_unique'
    ) then
    raise exception 'AUTHORING_ABORT: aplicar e verificar E02 e E05 antes desta migration';
  end if;
  if to_regclass('public.question_list_shares') is not null
    or to_regprocedure('public.commit_question_list_admin(uuid,uuid,integer,jsonb,text,text,text,jsonb,jsonb,text)') is not null then
    raise exception 'AUTHORING_ABORT: estruturas de autoria ja existem; nao reaplicar';
  end if;
end
$guard$;

-- Summary versions: optional name, generation options and provider. Older rows keep defaults.
alter table public.summary_versions
  add column label text check (label is null or char_length(btrim(label)) between 1 and 120),
  add column options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  add column provider text check (provider is null or char_length(provider) between 1 and 60);

-- Question batches become named lists. Older batches have no title (UI shows "Conjunto N").
alter table public.question_batches
  add column title text check (title is null or char_length(btrim(title)) between 1 and 160),
  add column config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  add column coverage jsonb not null default '{}'::jsonb check (jsonb_typeof(coverage) = 'object'),
  add column provider text check (provider is null or char_length(provider) between 1 and 60);
alter table public.question_batches drop constraint if exists question_batches_requested_count_check;
do $verify$
begin
  -- A legacy list constraint under another name would silently keep custom counts blocked.
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.question_batches'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ~ 'requested_count' and pg_get_constraintdef(oid) ~ 'ANY'
  ) then
    raise exception 'AUTHORING_ABORT: restricao legada de requested_count com outro nome; revisar manualmente';
  end if;
end
$verify$;
alter table public.question_batches
  add constraint question_batches_requested_count_range check (requested_count between 1 and 100);
-- NOT VALID: enforced for new rows without scanning or judging historical rows.
alter table public.question_batches
  add constraint question_batches_generated_within_request
  check (generated_count between 0 and requested_count) not valid;

-- Questions: extensible format column. Only the format with complete generation, grading,
-- feedback and export support is allowed; new formats need their own migration.
alter table public.questions
  add column format text not null default 'single_choice' check (format in ('single_choice')),
  add column metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object');

-- Reuses the E02 commit (lock, frozen source, idempotency) and only records the extra fields once.
create function public.commit_named_summary_admin(
  p_material_id uuid, p_job_id uuid, p_text text, p_model text, p_prompt_version text,
  p_label text, p_options jsonb, p_provider text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_summary jsonb; v_row public.summary_versions;
begin
  if p_options is not null and jsonb_typeof(p_options) <> 'object' then raise exception 'INVALID_GENERATION'; end if;
  v_summary := public.commit_summary_admin(p_material_id, p_job_id, p_text, p_model, p_prompt_version);
  update public.summary_versions
    set label = nullif(btrim(coalesce(p_label, '')), ''),
        options = coalesce(p_options, '{}'::jsonb),
        provider = nullif(btrim(coalesce(p_provider, '')), '')
    where id = (v_summary->>'id')::uuid and processing_job_id = p_job_id and provider is null
      and label is null and options = '{}'::jsonb;
  select * into v_row from public.summary_versions where id = (v_summary->>'id')::uuid;
  return to_jsonb(v_row);
end $$;

create function public.rename_summary_admin(p_user_id uuid, p_material_id uuid, p_summary_id uuid, p_label text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_row public.summary_versions;
begin
  if not exists (select 1 from public.materials where id = p_material_id and user_id = p_user_id) then
    raise exception 'AUTHORING_NOT_FOUND';
  end if;
  update public.summary_versions set label = nullif(btrim(coalesce(p_label, '')), '')
    where id = p_summary_id and material_id = p_material_id returning * into v_row;
  if not found then raise exception 'AUTHORING_NOT_FOUND'; end if;
  return to_jsonb(v_row);
end $$;

-- Same checks as the E02 enqueue for generation jobs (ownership, permission, current confirmed
-- revision, idempotency), but with the custom count range. The E02 trigger re-verifies the source.
create function public.enqueue_question_list_admin(p_user_id uuid, p_material_id uuid, p_params jsonb,
  p_source_version_id uuid, p_idempotency_key uuid, p_permission_version text, p_max_attempts integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_material public.materials; v_job public.processing_jobs; v_confirmation uuid;
  v_transcription public.transcriptions; v_params jsonb; v_count integer;
begin
  select * into v_material from public.materials where id = p_material_id and user_id = p_user_id for update;
  if not found then raise exception 'MATERIAL_NOT_FOUND'; end if;
  perform public.require_material_permission_admin(p_user_id, p_material_id, p_permission_version);
  if p_source_version_id is null then raise exception 'SOURCE_REVISION_REQUIRED'; end if;
  if p_idempotency_key is null or jsonb_typeof(coalesce(p_params, 'null'::jsonb)) <> 'object'
    or coalesce(jsonb_typeof(p_params->'count'), '') <> 'number' then raise exception 'INVALID_GENERATION'; end if;
  if (p_params->>'count')::numeric not between 1 and 100 or (p_params->>'count')::numeric % 1 <> 0 then
    raise exception 'INVALID_GENERATION';
  end if;
  v_count := (p_params->>'count')::integer;
  v_params := p_params || jsonb_build_object('permissionVersion', p_permission_version,
    'sourceRevisionId', p_source_version_id);
  select * into v_job from public.processing_jobs where material_id = p_material_id and type = 'GERAR_QUESTOES'
    and idempotency_key = p_idempotency_key;
  if found then
    if v_job.params <> v_params or v_job.source_transcription_version_id is distinct from p_source_version_id then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return to_jsonb(v_job);
  end if;
  select * into v_transcription from public.transcriptions where material_id = p_material_id for update;
  if not found then raise exception 'TRANSCRIPTION_NOT_FOUND'; end if;
  if not exists (select 1 from public.transcription_versions where id = p_source_version_id
    and transcription_id = v_transcription.id and revision = v_transcription.current_revision) then
    raise exception 'REVISION_CONFLICT';
  end if;
  select id into v_confirmation from public.transcription_confirmations where material_id = p_material_id
    and user_id = p_user_id and transcription_version_id = p_source_version_id and consent_version = p_permission_version;
  if v_confirmation is null then raise exception 'TRANSCRIPTION_CONFIRMATION_REQUIRED'; end if;
  insert into public.processing_jobs(material_id, type, params, source_transcription_version_id, confirmation_id,
    idempotency_key, max_attempts)
  values (p_material_id, 'GERAR_QUESTOES', v_params, p_source_version_id, v_confirmation, p_idempotency_key,
    p_max_attempts) returning * into v_job;
  return to_jsonb(v_job);
end $$;

-- Lists may hold FEWER questions than requested: the generator prefers fewer meaningful items over
-- invented or redundant ones. The frozen source, job type and requested count are still enforced.
create function public.commit_question_list_admin(
  p_material_id uuid, p_job_id uuid, p_requested integer, p_questions jsonb, p_model text,
  p_prompt_version text, p_title text, p_config jsonb, p_coverage jsonb, p_provider text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_source jsonb; v_batch public.question_batches; v_question jsonb; v_position integer := 0;
begin
  perform 1 from public.materials where id = p_material_id for update;
  v_source := public.get_generation_source_admin(p_material_id, p_job_id);
  if not exists (select 1 from public.processing_jobs where id = p_job_id and type = 'GERAR_QUESTOES'
    and (params->>'count')::integer = p_requested) then raise exception 'INVALID_JOB_TYPE'; end if;
  select * into v_batch from public.question_batches where processing_job_id = p_job_id;
  if found then return to_jsonb(v_batch); end if;
  if p_requested is null or p_requested not between 1 and 100 or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_questions) not between 1 and p_requested
    or (p_config is not null and jsonb_typeof(p_config) <> 'object')
    or (p_coverage is not null and jsonb_typeof(p_coverage) <> 'object') then
    raise exception 'INVALID_GENERATION';
  end if;
  insert into public.question_batches(material_id, source_transcription_revision, source_transcription_version_id,
    processing_job_id, requested_count, generated_count, model, prompt_version, title, config, coverage, provider)
  values (p_material_id, (v_source->>'revision')::integer, (v_source->>'id')::uuid, p_job_id, p_requested,
    jsonb_array_length(p_questions), p_model, p_prompt_version, nullif(btrim(coalesce(p_title, '')), ''),
    coalesce(p_config, '{}'::jsonb), coalesce(p_coverage, '{}'::jsonb), nullif(btrim(coalesce(p_provider, '')), ''))
  returning * into v_batch;
  for v_question in select value from jsonb_array_elements(p_questions) loop
    if coalesce(btrim(v_question->>'statement'), '') = ''
      or jsonb_typeof(v_question->'options') <> 'array' or jsonb_array_length(v_question->'options') <> 4
      or (v_question->>'correctIndex') is null
      or (v_question ? 'metadata' and jsonb_typeof(v_question->'metadata') <> 'object') then
      raise exception 'INVALID_GENERATION';
    end if;
    insert into public.questions(batch_id, position, statement, options, correct_index, explanation, format, metadata)
    values (v_batch.id, v_position, v_question->>'statement', v_question->'options',
      (v_question->>'correctIndex')::smallint, v_question->>'explanation', 'single_choice',
      coalesce(v_question->'metadata', '{}'::jsonb));
    v_position := v_position + 1;
  end loop;
  return to_jsonb(v_batch);
end $$;

create function public.rename_question_list_admin(p_user_id uuid, p_material_id uuid, p_batch_id uuid, p_title text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_row public.question_batches;
begin
  if not exists (select 1 from public.materials where id = p_material_id and user_id = p_user_id) then
    raise exception 'AUTHORING_NOT_FOUND';
  end if;
  if coalesce(btrim(p_title), '') = '' or char_length(btrim(p_title)) > 160 then raise exception 'AUTHORING_INVALID_INPUT'; end if;
  update public.question_batches set title = btrim(p_title)
    where id = p_batch_id and material_id = p_material_id returning * into v_row;
  if not found then raise exception 'AUTHORING_NOT_FOUND'; end if;
  return to_jsonb(v_row);
end $$;

-- Read-only worksheet links. The snapshot is frozen at creation and never contains answers,
-- explanations, evidence quotes, transcript text or media references.
create table public.question_list_shares (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null,
  batch_id uuid not null references public.question_batches(id) on delete cascade,
  request_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expiry_days integer not null check (expiry_days in (1, 7, 30)),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and length(snapshot::text) <= 400000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  unique (user_id, request_id),
  foreign key (material_id, user_id) references public.materials(id, user_id) on delete cascade
);
create index question_list_shares_owner_idx on public.question_list_shares(user_id, batch_id, created_at desc);
alter table public.question_list_shares enable row level security;
revoke all on public.question_list_shares from public, anon, authenticated;
grant select, insert, update on public.question_list_shares to service_role;

create function public.create_question_list_share_admin(
  p_user_id uuid, p_id uuid, p_material_id uuid, p_batch_id uuid, p_request_id uuid, p_hash text,
  p_days integer, p_permission_version text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare m public.materials; b public.question_batches; r public.question_list_shares; snap jsonb;
begin
  select * into m from public.materials where id = p_material_id and user_id = p_user_id for update;
  if not found then raise exception 'AUTHORING_NOT_FOUND'; end if;
  select * into r from public.question_list_shares where user_id = p_user_id and request_id = p_request_id;
  if found then
    if r.material_id <> p_material_id or r.batch_id <> p_batch_id or r.token_hash <> p_hash or r.expiry_days <> p_days
      then raise exception 'AUTHORING_REQUEST_CONFLICT'; end if;
    return jsonb_build_object('id', r.id, 'expiresAt', r.expires_at);
  end if;
  if p_days is null or p_days not in (1, 7, 30) or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'AUTHORING_INVALID_INPUT';
  end if;
  select * into b from public.question_batches where id = p_batch_id and material_id = p_material_id;
  if not found then raise exception 'AUTHORING_NOT_FOUND'; end if;
  perform public.require_material_permission_admin(p_user_id, p_material_id, p_permission_version);
  if (select count(*) from public.question_list_shares where user_id = p_user_id and revoked_at is null
      and expires_at > clock_timestamp()) >= 100 then raise exception 'AUTHORING_SHARE_LIMIT'; end if;
  snap := jsonb_build_object(
    'kind', 'question_list',
    'title', coalesce(b.title, 'Lista de questões'),
    'materialTitle', m.title,
    'subject', m.subject,
    'revision', b.source_transcription_revision,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('number', q.position + 1, 'statement', q.statement,
      'options', q.options) order by q.position) from public.questions q where q.batch_id = b.id), '[]'::jsonb));
  insert into public.question_list_shares(id, user_id, material_id, batch_id, request_id, token_hash, expiry_days, snapshot, expires_at)
  values (p_id, p_user_id, p_material_id, p_batch_id, p_request_id, p_hash, p_days, snap,
    clock_timestamp() + make_interval(days => p_days)) returning * into r;
  return jsonb_build_object('id', r.id, 'expiresAt', r.expires_at);
end $$;

create function public.resolve_question_list_share_admin(p_hash text)
returns jsonb language sql security invoker set search_path = '' as $$
  select snapshot || jsonb_build_object('expiresAt', expires_at) from public.question_list_shares
  where token_hash = p_hash and revoked_at is null and expires_at > clock_timestamp()
$$;

revoke all on function
  public.commit_named_summary_admin(uuid,uuid,text,text,text,text,jsonb,text),
  public.enqueue_question_list_admin(uuid,uuid,jsonb,uuid,uuid,text,integer),
  public.rename_summary_admin(uuid,uuid,uuid,text),
  public.commit_question_list_admin(uuid,uuid,integer,jsonb,text,text,text,jsonb,jsonb,text),
  public.rename_question_list_admin(uuid,uuid,uuid,text),
  public.create_question_list_share_admin(uuid,uuid,uuid,uuid,uuid,text,integer,text),
  public.resolve_question_list_share_admin(text)
  from public, anon, authenticated;
grant execute on function
  public.commit_named_summary_admin(uuid,uuid,text,text,text,text,jsonb,text),
  public.enqueue_question_list_admin(uuid,uuid,jsonb,uuid,uuid,text,integer),
  public.rename_summary_admin(uuid,uuid,uuid,text),
  public.commit_question_list_admin(uuid,uuid,integer,jsonb,text,text,text,jsonb,jsonb,text),
  public.rename_question_list_admin(uuid,uuid,uuid,text),
  public.create_question_list_share_admin(uuid,uuid,uuid,uuid,uuid,text,integer,text),
  public.resolve_question_list_share_admin(text)
  to service_role;
commit;
