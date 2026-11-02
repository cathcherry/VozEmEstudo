-- E02 additive only. Apply to approved development/staging after preflight and backup.
begin;

create function public.current_permission_version()
returns text language sql immutable set search_path = ''
as $$ select 'permission-v1:9664c4ae83373a49'::text $$;

alter table public.materials add column review_state text not null default 'pending_transcription'
  check (review_state in ('pending_transcription','awaiting_review','ready_to_generate'));
-- Existing transcripts are not retroactively confirmed.
update public.materials m set review_state = 'awaiting_review'
where exists (select 1 from public.transcriptions t where t.material_id = m.id);

create table public.material_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  declaration_version text not null,
  declaration_text text not null,
  declared_at timestamptz not null default now(),
  unique (material_id, user_id, declaration_version)
);
create table public.transcription_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  transcription_version_id uuid not null references public.transcription_versions(id) on delete cascade,
  consent_version text not null,
  confirmed_at timestamptz not null default now(),
  unique (transcription_version_id, user_id, consent_version)
);
create table public.content_warnings (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  revision_id uuid not null references public.transcription_versions(id) on delete cascade,
  analysis_id uuid not null,
  type text not null check (type in ('educational','topic_alignment','factual_suspicion')),
  state text not null check (state in ('warning','insufficient','error','no_warning')),
  explanation text not null,
  guidance text not null,
  segment_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(segment_refs) = 'array'),
  context_subject text,
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (analysis_id, type)
);
create index content_warnings_material_created_idx on public.content_warnings(material_id, created_at desc);
create index transcription_confirmations_material_idx on public.transcription_confirmations(material_id);

alter table public.processing_jobs
  add column source_transcription_version_id uuid references public.transcription_versions(id),
  add column confirmation_id uuid references public.transcription_confirmations(id),
  add column idempotency_key uuid;
create unique index processing_jobs_idempotency_idx
  on public.processing_jobs(material_id, type, idempotency_key) where idempotency_key is not null;
alter table public.summary_versions
  add column source_transcription_version_id uuid references public.transcription_versions(id),
  add column processing_job_id uuid references public.processing_jobs(id);
alter table public.question_batches
  add column source_transcription_version_id uuid references public.transcription_versions(id),
  add column processing_job_id uuid references public.processing_jobs(id);
create unique index summary_versions_job_idx on public.summary_versions(processing_job_id) where processing_job_id is not null;
create unique index question_batches_job_idx on public.question_batches(processing_job_id) where processing_job_id is not null;

alter table public.material_permissions enable row level security;
alter table public.transcription_confirmations enable row level security;
alter table public.content_warnings enable row level security;
create policy material_permissions_select_own on public.material_permissions for select to authenticated
using (user_id = (select auth.uid()) and exists (select 1 from public.materials m where m.id = material_id and m.user_id = (select auth.uid())));
create policy transcription_confirmations_select_own on public.transcription_confirmations for select to authenticated
using (user_id = (select auth.uid()) and exists (select 1 from public.materials m where m.id = material_id and m.user_id = (select auth.uid())));
create policy content_warnings_select_own on public.content_warnings for select to authenticated
using (exists (select 1 from public.materials m where m.id = material_id and m.user_id = (select auth.uid())));
revoke all on public.material_permissions, public.transcription_confirmations, public.content_warnings from public, anon, authenticated;
grant select on public.material_permissions, public.transcription_confirmations, public.content_warnings to authenticated;
grant select, insert, update, delete on public.material_permissions, public.transcription_confirmations, public.content_warnings to service_role;

create function public.require_material_permission_admin(p_user_id uuid, p_material_id uuid, p_permission_version text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.materials where id = p_material_id and user_id = p_user_id) then
    raise exception 'MATERIAL_NOT_FOUND';
  end if;
  if p_permission_version is distinct from public.current_permission_version() then
    raise exception 'POLICY_VERSION_MISMATCH';
  end if;
  if not exists (select 1 from public.material_permissions where material_id = p_material_id
    and user_id = p_user_id and declaration_version = p_permission_version) then
    raise exception 'PERMISSION_REQUIRED';
  end if;
end $$;

create function public.declare_material_permission_admin(p_user_id uuid, p_material_id uuid, p_permission_version text, p_permission_text text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_permission public.material_permissions;
begin
  perform 1 from public.materials where id = p_material_id and user_id = p_user_id for update;
  if not found then raise exception 'MATERIAL_NOT_FOUND'; end if;
  if p_permission_version is distinct from public.current_permission_version()
    or p_permission_text is distinct from 'Declaro que possuo permissão para utilizar esta gravação no Voz em Estudo e enviá-la para transcrição e geração dos materiais de revisão' then
    raise exception 'POLICY_VERSION_MISMATCH';
  end if;
  insert into public.material_permissions(user_id, material_id, declaration_version, declaration_text)
  values (p_user_id, p_material_id, p_permission_version, p_permission_text)
  on conflict (material_id, user_id, declaration_version) do nothing;
  select * into v_permission from public.material_permissions
    where material_id = p_material_id and user_id = p_user_id and declaration_version = p_permission_version;
  return to_jsonb(v_permission);
end $$;

create function public.create_material_with_permission_admin(p_user_id uuid, p_data jsonb, p_permission_version text, p_permission_text text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_material public.materials; v_audio public.audio_files; v_id uuid := (p_data->>'id')::uuid;
begin
  -- Serializes the first insert as well as retries with the same UUID.
  perform pg_advisory_xact_lock(hashtextextended(v_id::text, 0));
  select * into v_material from public.materials where id = v_id for update;
  if found then
    if v_material.user_id <> p_user_id then raise exception 'MATERIAL_NOT_FOUND'; end if;
    select * into v_audio from public.audio_files where material_id = v_id;
    if v_material.title is distinct from p_data->>'title'
      or coalesce(v_material.subject,'') is distinct from coalesce(p_data->>'subject','')
      or v_material.initial_question_count <> (p_data->>'questionCount')::integer
      or v_audio.storage_path is distinct from p_data->>'storagePath'
      or v_audio.retain_original is distinct from (p_data->>'retainAudio')::boolean then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
  else
    insert into public.materials(id,user_id,title,subject,initial_question_count)
    values(v_id,p_user_id,p_data->>'title',nullif(p_data->>'subject',''),(p_data->>'questionCount')::smallint)
    returning * into v_material;
    insert into public.audio_files(material_id,original_name,mime_type,extension,size_bytes,duration_ms,retain_original,storage_path)
    values(v_id,p_data->>'originalFilename',p_data->>'mimeType',p_data->>'extension',
      (p_data->>'sizeBytes')::bigint,(p_data->>'durationMs')::bigint,(p_data->>'retainAudio')::boolean,p_data->>'storagePath');
  end if;
  perform public.declare_material_permission_admin(p_user_id,v_id,p_permission_version,p_permission_text);
  return to_jsonb(v_material);
end $$;

create function public.enforce_new_material_permission()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Deferred so material + audio + permission can be recorded in the same transaction.
  if exists(select 1 from public.materials where id = new.id) and not exists (
    select 1 from public.material_permissions where material_id = new.id and user_id = new.user_id
      and declaration_version = public.current_permission_version()) then raise exception 'PERMISSION_REQUIRED'; end if;
  return new;
end $$;
create constraint trigger materials_require_permission after insert on public.materials
deferrable initially deferred for each row execute function public.enforce_new_material_permission();

create function public.freeze_transcription_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin raise exception 'IMMUTABLE_REVISION'; end $$;
create trigger transcription_versions_immutable before update on public.transcription_versions
for each row execute function public.freeze_transcription_version();
create function public.mark_transcription_awaiting_review()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  update public.materials m set review_state = 'awaiting_review'
  from public.transcriptions t where t.id = new.transcription_id and m.id = t.material_id;
  return new;
end $$;
create trigger transcription_version_requires_review after insert on public.transcription_versions
for each row execute function public.mark_transcription_awaiting_review();

create function public.create_initial_transcription_admin(p_material_id uuid, p_result jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_transcription public.transcriptions; v_material public.materials; v_segment jsonb; v_position integer := 0; v_snapshot jsonb;
begin
  select * into v_material from public.materials where id = p_material_id for update;
  if not found then raise exception 'MATERIAL_NOT_FOUND'; end if;
  perform public.require_material_permission_admin(v_material.user_id,p_material_id,public.current_permission_version());
  select * into v_transcription from public.transcriptions where material_id = p_material_id;
  if found then return to_jsonb(v_transcription); end if;
  if coalesce(trim(p_result->>'text'),'') = '' then raise exception 'INVALID_GENERATION'; end if;
  insert into public.transcriptions(material_id,language,current_revision,current_text)
  values(p_material_id,coalesce(p_result->>'language','pt'),1,p_result->>'text') returning * into v_transcription;
  for v_segment in select value from jsonb_array_elements(
    case when jsonb_array_length(coalesce(p_result->'segments','[]')) > 0 then p_result->'segments'
      else jsonb_build_array(jsonb_build_object('text',p_result->>'text','startMs',0,'endMs',0)) end)
  loop
    insert into public.transcription_segments(transcription_id,position,start_ms,end_ms,original_text,current_text)
    values(v_transcription.id,v_position,coalesce((v_segment->>'startMs')::bigint,0),
      coalesce((v_segment->>'endMs')::bigint,0),v_segment->>'text',v_segment->>'text');
    v_position := v_position + 1;
  end loop;
  select jsonb_agg(jsonb_build_object('id',id,'position',position,'startMs',start_ms,'endMs',end_ms,'text',current_text) order by position)
  into v_snapshot from public.transcription_segments where transcription_id = v_transcription.id;
  insert into public.transcription_versions(transcription_id,revision,origin,full_text,segments_snapshot)
  values(v_transcription.id,1,'ASR',p_result->>'text',coalesce(v_snapshot,'[]'));
  return to_jsonb(v_transcription);
end $$;

create function public.get_transcription_review_admin(p_user_id uuid,p_material_id uuid,p_permission_version text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_version public.transcription_versions; v_confirmation public.transcription_confirmations; v_permitted boolean;
begin
  perform 1 from public.materials where id = p_material_id and user_id = p_user_id;
  if not found then raise exception 'MATERIAL_NOT_FOUND'; end if;
  select exists(select 1 from public.material_permissions where material_id = p_material_id and user_id = p_user_id
    and declaration_version = p_permission_version and p_permission_version = public.current_permission_version()) into v_permitted;
  select tv.* into v_version from public.transcription_versions tv join public.transcriptions t on t.id = tv.transcription_id
    where t.material_id = p_material_id and tv.revision = t.current_revision;
  if v_version.id is not null then
    select * into v_confirmation from public.transcription_confirmations where transcription_version_id = v_version.id
      and user_id = p_user_id and material_id = p_material_id and consent_version = p_permission_version;
  end if;
  return jsonb_build_object('state',case when v_version.id is null then 'pending_transcription'
    when v_confirmation.id is null or not v_permitted then 'awaiting_review' else 'ready_to_generate' end,
    'sourceRevisionId',v_version.id,'revision',v_version.revision,'permissionRequired',not v_permitted,
    'confirmation',case when v_permitted then to_jsonb(v_confirmation) else null end);
end $$;

create function public.confirm_transcription_admin(p_user_id uuid,p_material_id uuid,p_source_version_id uuid,p_permission_version text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_transcription public.transcriptions; v_confirmation public.transcription_confirmations;
begin
  perform 1 from public.materials where id = p_material_id and user_id = p_user_id for update;
  if not found then raise exception 'MATERIAL_NOT_FOUND'; end if;
  perform public.require_material_permission_admin(p_user_id,p_material_id,p_permission_version);
  select * into v_transcription from public.transcriptions where material_id = p_material_id for update;
  if not found then raise exception 'TRANSCRIPTION_NOT_FOUND'; end if;
  if not exists(select 1 from public.transcription_versions where id = p_source_version_id
    and transcription_id = v_transcription.id and revision = v_transcription.current_revision) then
    raise exception 'REVISION_CONFLICT';
  end if;
  insert into public.transcription_confirmations(user_id,material_id,transcription_version_id,consent_version)
    values(p_user_id,p_material_id,p_source_version_id,p_permission_version)
    on conflict(transcription_version_id,user_id,consent_version) do nothing;
  select * into v_confirmation from public.transcription_confirmations where transcription_version_id = p_source_version_id
    and user_id = p_user_id and consent_version = p_permission_version;
  update public.materials set review_state = 'ready_to_generate' where id = p_material_id;
  return to_jsonb(v_confirmation);
end $$;

create function public.enqueue_processing_job_admin(p_user_id uuid,p_material_id uuid,p_type public.job_type,
  p_params jsonb,p_source_version_id uuid,p_idempotency_key uuid,p_permission_version text,p_max_attempts integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_material public.materials; v_job public.processing_jobs; v_confirmation uuid; v_transcription public.transcriptions; v_params jsonb;
begin
  select * into v_material from public.materials where id = p_material_id and user_id = p_user_id for update;
  if not found then raise exception 'MATERIAL_NOT_FOUND'; end if;
  perform public.require_material_permission_admin(p_user_id,p_material_id,p_permission_version);
  if p_type not in ('PROCESSAMENTO_INICIAL','REGERAR_RESUMO','GERAR_QUESTOES') then raise exception 'INVALID_JOB_TYPE'; end if;
  v_params := coalesce(p_params,'{}') || jsonb_build_object('permissionVersion',p_permission_version);
  if p_type <> 'PROCESSAMENTO_INICIAL' then
    if p_source_version_id is null then raise exception 'SOURCE_REVISION_REQUIRED'; end if;
    v_params := v_params || jsonb_build_object('sourceRevisionId',p_source_version_id);
  end if;
  -- Retry of an already queued operation keeps its original snapshot, even after an edit.
  select * into v_job from public.processing_jobs where material_id = p_material_id and type = p_type and idempotency_key = p_idempotency_key;
  if found then
    if v_job.params <> v_params or v_job.source_transcription_version_id is distinct from p_source_version_id then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return to_jsonb(v_job);
  end if;
  if p_type = 'PROCESSAMENTO_INICIAL' then
    select * into v_job from public.processing_jobs where material_id = p_material_id and type = p_type
      and status in ('PENDENTE','EM_EXECUCAO','AGUARDANDO_REPETICAO') order by created_at limit 1;
    if found then return to_jsonb(v_job); end if;
    if v_material.status not in ('PENDENTE','FALHOU','PARCIAL') then raise exception 'MATERIAL_ALREADY_PROCESSED'; end if;
  else
    select * into v_transcription from public.transcriptions where material_id = p_material_id for update;
    if not found then raise exception 'TRANSCRIPTION_NOT_FOUND'; end if;
    if not exists(select 1 from public.transcription_versions where id = p_source_version_id
      and transcription_id = v_transcription.id and revision = v_transcription.current_revision) then raise exception 'REVISION_CONFLICT'; end if;
    select id into v_confirmation from public.transcription_confirmations where material_id = p_material_id
      and user_id = p_user_id and transcription_version_id = p_source_version_id and consent_version = p_permission_version;
    if v_confirmation is null then raise exception 'TRANSCRIPTION_CONFIRMATION_REQUIRED'; end if;
    if p_type = 'GERAR_QUESTOES' and coalesce((p_params->>'count')::integer,0) not in (3,5,10,20) then raise exception 'INVALID_GENERATION'; end if;
  end if;
  insert into public.processing_jobs(material_id,type,params,source_transcription_version_id,confirmation_id,idempotency_key,max_attempts)
  values(p_material_id,p_type,v_params,p_source_version_id,v_confirmation,p_idempotency_key,p_max_attempts) returning * into v_job;
  return to_jsonb(v_job);
end $$;

create function public.get_generation_source_admin(p_material_id uuid,p_job_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_job public.processing_jobs; v_version public.transcription_versions; v_owner uuid;
begin
  select user_id into v_owner from public.materials where id = p_material_id;
  if v_owner is null then raise exception 'MATERIAL_NOT_FOUND'; end if;
  perform public.require_material_permission_admin(v_owner,p_material_id,public.current_permission_version());
  select * into v_job from public.processing_jobs where id = p_job_id and material_id = p_material_id;
  if not found or v_job.type not in ('REGERAR_RESUMO','GERAR_QUESTOES') then raise exception 'SOURCE_REVISION_MISMATCH'; end if;
  if v_job.source_transcription_version_id is null then raise exception 'SOURCE_REVISION_REQUIRED'; end if;
  if v_job.params->>'sourceRevisionId' is distinct from v_job.source_transcription_version_id::text
    or v_job.params->>'permissionVersion' is distinct from public.current_permission_version() then raise exception 'SOURCE_REVISION_MISMATCH'; end if;
  select tv.* into v_version from public.transcription_versions tv join public.transcriptions t on t.id = tv.transcription_id
    where tv.id = v_job.source_transcription_version_id and t.material_id = p_material_id;
  if v_version.id is null then raise exception 'SOURCE_REVISION_MISMATCH'; end if;
  if not exists(select 1 from public.transcription_confirmations where id = v_job.confirmation_id
    and material_id = p_material_id and user_id = v_owner and transcription_version_id = v_version.id
    and consent_version = public.current_permission_version()) then raise exception 'TRANSCRIPTION_CONFIRMATION_REQUIRED'; end if;
  return to_jsonb(v_version);
end $$;

create function public.enforce_job_source()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_owner uuid;
begin
  if tg_op = 'UPDATE' then
    if new.material_id <> old.material_id or new.type <> old.type or new.params <> old.params
      or new.source_transcription_version_id is distinct from old.source_transcription_version_id
      or new.confirmation_id is distinct from old.confirmation_id or new.idempotency_key is distinct from old.idempotency_key then
      raise exception 'SOURCE_REVISION_MISMATCH';
    end if;
  else
    select user_id into v_owner from public.materials where id = new.material_id;
    perform public.require_material_permission_admin(v_owner,new.material_id,public.current_permission_version());
    if new.type in ('REGERAR_RESUMO','GERAR_QUESTOES') and not exists (
      select 1 from public.transcription_confirmations tc join public.transcription_versions tv on tv.id = tc.transcription_version_id
      join public.transcriptions t on t.id = tv.transcription_id
      where tc.id = new.confirmation_id and tc.material_id = new.material_id and tc.user_id = v_owner
      and tc.transcription_version_id = new.source_transcription_version_id and t.material_id = new.material_id
      and tc.consent_version = public.current_permission_version()
      and new.params->>'sourceRevisionId' = tv.id::text and new.params->>'permissionVersion' = tc.consent_version) then
      raise exception 'TRANSCRIPTION_CONFIRMATION_REQUIRED';
    end if;
  end if;
  return new;
end $$;
create trigger processing_jobs_immutable_source before insert or update on public.processing_jobs
for each row execute function public.enforce_job_source();

create function public.commit_summary_admin(p_material_id uuid,p_job_id uuid,p_text text,p_model text,p_prompt_version text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_source jsonb; v_summary public.summary_versions; v_number integer;
begin
  perform 1 from public.materials where id = p_material_id for update;
  v_source := public.get_generation_source_admin(p_material_id,p_job_id);
  if not exists(select 1 from public.processing_jobs where id = p_job_id and type = 'REGERAR_RESUMO') then raise exception 'INVALID_JOB_TYPE'; end if;
  select * into v_summary from public.summary_versions where processing_job_id = p_job_id;
  if found then return to_jsonb(v_summary); end if;
  if coalesce(trim(p_text),'') = '' then raise exception 'INVALID_GENERATION'; end if;
  select coalesce(max(version),0)+1 into v_number from public.summary_versions where material_id = p_material_id;
  update public.summary_versions set is_current = false where material_id = p_material_id and is_current;
  insert into public.summary_versions(material_id,version,text,source_transcription_revision,source_transcription_version_id,processing_job_id,model,prompt_version)
  values(p_material_id,v_number,p_text,(v_source->>'revision')::integer,(v_source->>'id')::uuid,p_job_id,p_model,p_prompt_version)
    returning * into v_summary;
  return to_jsonb(v_summary);
end $$;

create function public.commit_question_batch_admin(p_material_id uuid,p_job_id uuid,p_count integer,p_questions jsonb,p_model text,p_prompt_version text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_source jsonb; v_batch public.question_batches; v_question jsonb; v_position integer := 0;
begin
  perform 1 from public.materials where id = p_material_id for update;
  v_source := public.get_generation_source_admin(p_material_id,p_job_id);
  if not exists(select 1 from public.processing_jobs where id = p_job_id and type = 'GERAR_QUESTOES'
    and (params->>'count')::integer = p_count) then raise exception 'INVALID_JOB_TYPE'; end if;
  select * into v_batch from public.question_batches where processing_job_id = p_job_id;
  if found then return to_jsonb(v_batch); end if;
  if p_count not in (3,5,10,20) or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) <> p_count then
    raise exception 'INVALID_GENERATION';
  end if;
  insert into public.question_batches(material_id,source_transcription_revision,source_transcription_version_id,processing_job_id,requested_count,generated_count,model,prompt_version)
  values(p_material_id,(v_source->>'revision')::integer,(v_source->>'id')::uuid,p_job_id,p_count,p_count,p_model,p_prompt_version)
  returning * into v_batch;
  for v_question in select value from jsonb_array_elements(p_questions) loop
    if coalesce(trim(v_question->>'statement'),'') = '' then raise exception 'INVALID_GENERATION'; end if;
    insert into public.questions(batch_id,position,statement,options,correct_index,explanation)
    values(v_batch.id,v_position,v_question->>'statement',v_question->'options',(v_question->>'correctIndex')::smallint,v_question->>'explanation');
    v_position := v_position + 1;
  end loop;
  return to_jsonb(v_batch);
end $$;

create function public.enforce_derived_source()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_source jsonb;
begin
  if new.processing_job_id is null or new.source_transcription_version_id is null then raise exception 'SOURCE_REVISION_REQUIRED'; end if;
  v_source := public.get_generation_source_admin(new.material_id,new.processing_job_id);
  if new.source_transcription_version_id is distinct from (v_source->>'id')::uuid
    or new.source_transcription_revision <> (v_source->>'revision')::integer then raise exception 'SOURCE_REVISION_MISMATCH'; end if;
  return new;
end $$;
create trigger summary_versions_require_source before insert on public.summary_versions
for each row execute function public.enforce_derived_source();
create trigger question_batches_require_source before insert on public.question_batches
for each row execute function public.enforce_derived_source();

create function public.save_content_warnings_admin(p_user_id uuid,p_material_id uuid,p_source_version_id uuid,p_analysis_id uuid,p_warnings jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_warning jsonb; v_results jsonb;
begin
  perform 1 from public.materials where id = p_material_id and user_id = p_user_id for update;
  if not found then raise exception 'MATERIAL_NOT_FOUND'; end if;
  if not exists(select 1 from public.transcription_versions tv join public.transcriptions t on t.id = tv.transcription_id
    where tv.id = p_source_version_id and t.material_id = p_material_id) then raise exception 'REVISION_NOT_FOUND'; end if;
  if p_analysis_id is null then raise exception 'INVALID_GENERATION'; end if;
  if exists(select 1 from public.content_warnings where analysis_id = p_analysis_id
    and (material_id <> p_material_id or revision_id <> p_source_version_id)) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if jsonb_typeof(p_warnings) <> 'array' or jsonb_array_length(p_warnings) <> 3
    or (select count(distinct value->>'type') from jsonb_array_elements(p_warnings)) <> 3 then raise exception 'INVALID_GENERATION'; end if;
  for v_warning in select value from jsonb_array_elements(p_warnings) loop
    insert into public.content_warnings(material_id,revision_id,analysis_id,type,state,explanation,guidance,segment_refs,model,prompt_version,context_subject)
    values(p_material_id,p_source_version_id,p_analysis_id,v_warning->>'type',v_warning->>'state',v_warning->>'explanation',
      v_warning->>'guidance',coalesce(v_warning->'segmentRefs','[]'),v_warning->>'model',v_warning->>'promptVersion',v_warning->>'subject')
    on conflict(analysis_id,type) do nothing;
  end loop;
  select jsonb_agg(to_jsonb(w) order by w.type) into v_results from public.content_warnings w
    where w.material_id = p_material_id and w.revision_id = p_source_version_id and w.analysis_id = p_analysis_id;
  return coalesce(v_results,'[]');
end $$;


-- Own-material lock order remains material -> transcription for edits, confirm and enqueue.
create function public.apply_transcription_edits_owned_admin(p_user_id uuid,p_material_id uuid,p_expected_revision integer,p_edits jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.materials where id = p_material_id and user_id = p_user_id for update;
  if not found then raise exception 'MATERIAL_NOT_FOUND'; end if;
  return public.apply_transcription_edits_admin(p_material_id,p_expected_revision,p_edits);
end $$;
create function public.restore_transcription_revision_owned_admin(p_user_id uuid,p_material_id uuid,p_revision integer)
returns integer language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.materials where id = p_material_id and user_id = p_user_id for update;
  if not found then raise exception 'MATERIAL_NOT_FOUND'; end if;
  return public.restore_transcription_revision_admin(p_material_id,p_revision);
end $$;

-- RPCs are server-only, invoker functions; no new SECURITY DEFINER bypass.
do $$ declare v_function record; begin
  for v_function in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = any(array[
    'current_permission_version','require_material_permission_admin','declare_material_permission_admin',
    'create_material_with_permission_admin','enforce_new_material_permission','freeze_transcription_version',
    'mark_transcription_awaiting_review','create_initial_transcription_admin','get_transcription_review_admin',
    'confirm_transcription_admin','enqueue_processing_job_admin','get_generation_source_admin','enforce_job_source',
    'commit_summary_admin','commit_question_batch_admin','enforce_derived_source','save_content_warnings_admin',
    'apply_transcription_edits_owned_admin','restore_transcription_revision_owned_admin'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated',v_function.signature);
    execute format('grant execute on function %s to service_role',v_function.signature);
  end loop;
end $$;
commit;
