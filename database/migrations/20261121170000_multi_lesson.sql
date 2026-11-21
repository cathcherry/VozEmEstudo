-- Voz em Estudo 3.3 / Aprendizagem multiaula (Marco C) — MIGRACAO CANDIDATA (nao aplicada em producao).
-- Depende de: 001_initial, 20261009101846_academic_review (transcription_confirmations),
-- 20261104190000_catalog_units (study_subjects, study_units, materials.subject_id/unit_id) e
-- 20261121160000_generation_reuse (ai_generations e as funcoes *_generation_admin).
-- Aditiva: nada existente e removido ou substituido; nenhum dado existente e transformado
-- (as tabelas novas comecam vazias).
-- O que cria:
--   * multi_lesson_materials: o material integrado (resumo/questoes/flashcards) de varias aulas,
--     com a lista de fontes CONGELADA no momento do pedido (material, revisao, numero, titulo);
--   * multi_lesson_jobs: fila propria (processing_jobs exige um unico material_id), com lease,
--     tentativas, next_attempt_at e codigo de erro;
--   * funcoes server-only (*_admin) para resolver a selecao, registrar o pedido, consultar e
--     executar a fila. Tudo privado a conta: RLS ligado, nenhum grant ao navegador.
-- O cache de mapas de conhecimento fica em outra migration (20261121171000_knowledge_map_cache.sql):
-- nada aqui depende dele.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
begin
  if to_regclass('public.transcription_confirmations') is null
    or to_regclass('public.study_units') is null
    or to_regclass('public.study_subjects') is null
    or to_regclass('public.ai_generations') is null
    or to_regprocedure('public.begin_generation_admin(uuid,text,text,uuid,text,uuid[],text,text,uuid,boolean,integer)') is null
    or to_regprocedure('public.complete_generation_admin(uuid,jsonb)') is null
    or to_regprocedure('public.fail_generation_admin(uuid,text)') is null then
    raise exception 'MULTI_LESSON_ABORT: aplicar academic_review, catalog_units e generation_reuse antes';
  end if;
  if to_regclass('public.multi_lesson_materials') is not null or to_regclass('public.multi_lesson_jobs') is not null then
    raise exception 'MULTI_LESSON_ABORT: estruturas multiaula ja existem; nao reaplicar';
  end if;
end
$guard$;

-- 1. The integrated material ------------------------------------------------------------------
create table public.multi_lesson_materials (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Idempotency of the request (a retried POST returns the same record).
  request_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  selection_kind text not null check (selection_kind in ('lessons', 'unit', 'units', 'subject')),
  selection_ids uuid[] not null check (cardinality(selection_ids) between 1 and 50),
  outputs text[] not null check (cardinality(outputs) between 1 and 3
    and outputs <@ array['summary', 'questions', 'flashcards']::text[]),
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 4096),
  -- Snapshot of the resolved sources: [{materialId, revisionId, revision, title, subjectId, unitId}].
  -- Copied at request time; later edits, new revisions or renamed lessons never change it.
  sources jsonb not null check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) between 1 and 12),
  source_revision_ids uuid[] not null check (cardinality(source_revision_ids) between 1 and 12),
  -- Lessons of the selection left out, with the reason ('unconfirmed', 'not_transcribed').
  excluded jsonb not null default '[]'::jsonb check (jsonb_typeof(excluded) = 'array'),
  generation_id uuid references public.ai_generations(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'ready', 'failed')),
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 524288)),
  model text check (model is null or char_length(model) <= 120),
  prompt_version text check (prompt_version is null or char_length(prompt_version) <= 60),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint multi_lesson_materials_request_unique unique (user_id, request_id)
);
create index multi_lesson_materials_owner_idx on public.multi_lesson_materials(user_id, created_at desc);
create index multi_lesson_materials_generation_idx on public.multi_lesson_materials(generation_id)
  where generation_id is not null;

-- The source snapshot is part of the record's identity: it can never be rewritten.
create function public.multi_lesson_freeze_sources()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.sources is distinct from old.sources or new.source_revision_ids is distinct from old.source_revision_ids
    or new.user_id is distinct from old.user_id or new.selection_kind is distinct from old.selection_kind
    or new.selection_ids is distinct from old.selection_ids or new.excluded is distinct from old.excluded then
    raise exception 'MULTI_LESSON_SOURCES_IMMUTABLE';
  end if;
  return new;
end $$;
create trigger multi_lesson_materials_sources_immutable before update on public.multi_lesson_materials
for each row execute function public.multi_lesson_freeze_sources();

-- 2. Its own small queue (processing_jobs needs a single material_id) --------------------------
create table public.multi_lesson_jobs (
  id uuid primary key default gen_random_uuid(),
  multi_lesson_id uuid not null unique references public.multi_lesson_materials(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_id uuid references public.ai_generations(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'running', 'retry', 'done', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 2 check (max_attempts between 1 and 5),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text check (locked_by is null or char_length(locked_by) <= 120),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index multi_lesson_jobs_due_idx on public.multi_lesson_jobs(next_attempt_at)
  where status in ('pending', 'retry');
create index multi_lesson_jobs_lease_idx on public.multi_lesson_jobs(locked_at) where status = 'running';

alter table public.multi_lesson_materials enable row level security;
alter table public.multi_lesson_jobs enable row level security;
revoke all on table public.multi_lesson_materials, public.multi_lesson_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.multi_lesson_materials, public.multi_lesson_jobs to service_role;

-- 3. Source resolution (read only) --------------------------------------------------------------
-- A selection (lessons, one unit, several units, one subject) becomes the caller's own lessons
-- whose CURRENT transcript revision the caller confirmed. The others are listed with a reason.
-- Ids of lessons that are not the caller's are ignored and only counted ('missing'): nothing about
-- another account is revealed. A unit or subject that is not the caller's is "not found".
create function public.multi_lesson_resolve_admin(p_user_id uuid, p_kind text, p_ids uuid[])
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_ids uuid[]; v_found integer; v_materials uuid[]; v_result jsonb;
begin
  if p_user_id is null or p_ids is null or cardinality(p_ids) < 1 then raise exception 'MULTI_LESSON_INVALID_SELECTION'; end if;
  -- Duplicates removed, chosen order kept.
  v_ids := array(select x from unnest(p_ids) with ordinality u(x, n) where x is not null group by x order by min(n));
  if p_kind = 'lessons' then
    if cardinality(v_ids) > 50 then raise exception 'MULTI_LESSON_INVALID_SELECTION'; end if;
    v_materials := array(select m.id from public.materials m where m.user_id = p_user_id and m.id = any(v_ids));
  elsif p_kind in ('unit', 'units') then
    if (p_kind = 'unit' and cardinality(v_ids) <> 1) or cardinality(v_ids) > 20 then
      raise exception 'MULTI_LESSON_INVALID_SELECTION';
    end if;
    select count(*) into v_found from public.study_units u where u.user_id = p_user_id and u.id = any(v_ids);
    if v_found <> cardinality(v_ids) then raise exception 'MULTI_LESSON_NOT_FOUND'; end if;
    v_materials := array(select m.id from public.materials m where m.user_id = p_user_id and m.unit_id = any(v_ids));
  elsif p_kind = 'subject' then
    if cardinality(v_ids) <> 1 then raise exception 'MULTI_LESSON_INVALID_SELECTION'; end if;
    perform 1 from public.study_subjects s where s.user_id = p_user_id and s.id = v_ids[1];
    if not found then raise exception 'MULTI_LESSON_NOT_FOUND'; end if;
    v_materials := array(select m.id from public.materials m where m.user_id = p_user_id and m.subject_id = v_ids[1]);
  else
    raise exception 'MULTI_LESSON_INVALID_SELECTION';
  end if;

  with src as (
    select m.id as material_id, m.title, m.subject_id, m.unit_id, tv.id as revision_id, tv.revision,
      exists (select 1 from public.transcription_confirmations tc
        where tc.transcription_version_id = tv.id and tc.user_id = p_user_id and tc.material_id = m.id) as confirmed,
      -- Order: the chosen order for lessons; otherwise subject, unit, then recording date.
      case when p_kind = 'lessons' then array_position(v_ids, m.id) else 0 end as chosen,
      coalesce(s.sort_order, 2147483647) as subject_order, coalesce(u.sort_order, 2147483647) as unit_order,
      coalesce(u.title, '') as unit_title, m.created_at
    from public.materials m
    left join public.transcriptions t on t.material_id = m.id
    left join public.transcription_versions tv on tv.transcription_id = t.id and tv.revision = t.current_revision
    left join public.study_units u on u.id = m.unit_id
    left join public.study_subjects s on s.id = m.subject_id
    where m.id = any(v_materials)
  )
  select jsonb_build_object(
    'kind', p_kind,
    'included', coalesce((select jsonb_agg(jsonb_build_object('materialId', material_id, 'revisionId', revision_id,
        'revision', revision, 'title', title, 'subjectId', subject_id, 'unitId', unit_id)
        order by chosen, subject_order, unit_order, unit_title, created_at, material_id)
      from src where revision_id is not null and confirmed), '[]'::jsonb),
    'excluded', coalesce((select jsonb_agg(jsonb_build_object('materialId', material_id, 'title', title,
        'reason', case when revision_id is null then 'not_transcribed' else 'unconfirmed' end)
        order by chosen, subject_order, unit_order, unit_title, created_at, material_id)
      from src where revision_id is null or not confirmed), '[]'::jsonb),
    'missing', case when p_kind = 'lessons' then cardinality(v_ids) - cardinality(v_materials) else 0 end,
    'limit', 12)
  into v_result;
  return v_result;
end $$;

-- 4. Reading ------------------------------------------------------------------------------------
create function public.multi_lesson_get_admin(p_user_id uuid, p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_rec public.multi_lesson_materials; v_job public.multi_lesson_jobs;
begin
  select * into v_rec from public.multi_lesson_materials where id = p_id and user_id = p_user_id;
  if not found then raise exception 'MULTI_LESSON_NOT_FOUND'; end if;
  -- A record that joined a generation has no job of its own: show the job doing the work.
  select j.* into v_job from public.multi_lesson_jobs j
    where j.multi_lesson_id = v_rec.id or (v_rec.generation_id is not null and j.generation_id = v_rec.generation_id)
    order by (j.multi_lesson_id = v_rec.id) desc, j.created_at desc limit 1;
  return to_jsonb(v_rec) || jsonb_build_object('job', case when v_job.id is null then null else jsonb_build_object(
    'id', v_job.id, 'status', v_job.status, 'attemptCount', v_job.attempt_count, 'maxAttempts', v_job.max_attempts,
    'nextAttemptAt', v_job.next_attempt_at, 'errorCode', v_job.error_code) end);
end $$;

create function public.multi_lesson_list_admin(p_user_id uuid, p_limit integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'status', r.status,
      'selection_kind', r.selection_kind, 'outputs', r.outputs, 'source_count', jsonb_array_length(r.sources),
      'excluded_count', jsonb_array_length(r.excluded), 'error_code', r.error_code,
      'created_at', r.created_at, 'completed_at', r.completed_at) order by r.created_at desc), '[]'::jsonb)
  from (select * from public.multi_lesson_materials where user_id = p_user_id
    order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100)) r
$$;

-- 5. Registering a request, after begin_generation_admin decided start / join / reuse -----------
-- The sources are resolved again here and must be exactly the generation's revisions (what the
-- student saw in the preview). 'start' also queues the job and marks the generation running.
create function public.multi_lesson_attach_admin(
  p_user_id uuid, p_id uuid, p_request_id uuid, p_title text, p_kind text, p_ids uuid[], p_outputs text[],
  p_settings jsonb, p_generation_id uuid, p_decision text, p_max_attempts integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_gen public.ai_generations; v_rec public.multi_lesson_materials; v_resolved jsonb; v_revs uuid[];
begin
  if p_decision is null or p_decision not in ('start', 'join', 'reuse') or p_id is null or p_request_id is null then
    raise exception 'MULTI_LESSON_INVALID_INPUT';
  end if;
  select * into v_rec from public.multi_lesson_materials where user_id = p_user_id and request_id = p_request_id;
  if found then
    if v_rec.id <> p_id then raise exception 'MULTI_LESSON_REQUEST_CONFLICT'; end if;
    return public.multi_lesson_get_admin(p_user_id, v_rec.id) || jsonb_build_object('joined', false);
  end if;
  select * into v_gen from public.ai_generations
    where id = p_generation_id and kind = 'multi_lesson' and scope_kind = 'user' and scope_id = p_user_id
      and requested_by = p_user_id
    for update;
  if not found then raise exception 'MULTI_LESSON_GENERATION_NOT_FOUND'; end if;
  -- A record already answers this generation (double click, second tab, reuse): it is the answer.
  select * into v_rec from public.multi_lesson_materials where user_id = p_user_id and generation_id = v_gen.id
    order by created_at limit 1;
  if found then
    if p_decision = 'start' and v_gen.status in ('pending', 'running') and not exists (
        select 1 from public.multi_lesson_jobs where generation_id = v_gen.id and status not in ('done', 'failed')) then
      insert into public.multi_lesson_jobs(multi_lesson_id, user_id, generation_id, max_attempts)
        values (v_rec.id, p_user_id, v_gen.id, least(greatest(coalesce(p_max_attempts, 2), 1), 5))
        on conflict (multi_lesson_id) do nothing;
      update public.ai_generations set status = 'running', updated_at = now() where id = v_gen.id and status = 'pending';
    end if;
    return public.multi_lesson_get_admin(p_user_id, v_rec.id) || jsonb_build_object('joined', true);
  end if;
  if p_decision = 'reuse' then raise exception 'MULTI_LESSON_REUSE_UNAVAILABLE'; end if;
  if v_gen.status not in ('pending', 'running') then raise exception 'MULTI_LESSON_GENERATION_NOT_FOUND'; end if;
  v_resolved := public.multi_lesson_resolve_admin(p_user_id, p_kind, p_ids);
  v_revs := array(select (e->>'revisionId')::uuid from jsonb_array_elements(v_resolved->'included') e);
  if cardinality(v_revs) = 0 then raise exception 'MULTI_LESSON_NO_SOURCES'; end if;
  if cardinality(v_revs) > 12 then raise exception 'MULTI_LESSON_TOO_MANY_SOURCES'; end if;
  if not (v_revs @> v_gen.source_revision_ids and v_revs <@ v_gen.source_revision_ids) then
    raise exception 'MULTI_LESSON_SOURCES_CHANGED';
  end if;
  insert into public.multi_lesson_materials(id, user_id, request_id, title, selection_kind, selection_ids, outputs,
    settings, sources, source_revision_ids, excluded, generation_id, status, prompt_version)
  values (p_id, p_user_id, p_request_id, btrim(p_title), p_kind, array(select x from unnest(p_ids) with ordinality u(x, n) where x is not null group by x order by min(n)),
    p_outputs, coalesce(p_settings, '{}'::jsonb), v_resolved->'included', v_revs, v_resolved->'excluded',
    v_gen.id, 'queued', v_gen.prompt_version)
  returning * into v_rec;
  if p_decision = 'start' then
    insert into public.multi_lesson_jobs(multi_lesson_id, user_id, generation_id, max_attempts)
      values (v_rec.id, p_user_id, v_gen.id, least(greatest(coalesce(p_max_attempts, 2), 1), 5));
    update public.ai_generations set status = 'running', updated_at = now() where id = v_gen.id and status = 'pending';
  end if;
  return public.multi_lesson_get_admin(p_user_id, v_rec.id) || jsonb_build_object('joined', false);
end $$;

-- Deleting a record that is still being generated frees its generation key honestly.
create function public.multi_lesson_delete_admin(p_user_id uuid, p_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_rec public.multi_lesson_materials;
begin
  select * into v_rec from public.multi_lesson_materials where id = p_id and user_id = p_user_id for update;
  if not found then raise exception 'MULTI_LESSON_NOT_FOUND'; end if;
  if v_rec.generation_id is not null and v_rec.status in ('queued', 'running') and not exists (
      select 1 from public.multi_lesson_materials o where o.generation_id = v_rec.generation_id and o.id <> v_rec.id) then
    perform public.fail_generation_admin(v_rec.generation_id, 'MULTI_LESSON_DELETED');
  end if;
  delete from public.multi_lesson_materials where id = v_rec.id;
  return jsonb_build_object('id', v_rec.id, 'deleted', true);
end $$;

-- 6. The queue ----------------------------------------------------------------------------------
-- Claims the next due job. A running job whose lease expired is taken again (the worker died) if
-- attempts remain; one with no attempts left fails honestly and frees its generation key.
create function public.multi_lesson_claim_job_admin(p_worker_id text, p_stale_after_seconds integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_job public.multi_lesson_jobs; v_stale interval := make_interval(secs => greatest(coalesce(p_stale_after_seconds, 600), 30));
begin
  if p_worker_id is null or char_length(p_worker_id) not between 1 and 120 then raise exception 'MULTI_LESSON_INVALID_INPUT'; end if;
  for v_job in select * from public.multi_lesson_jobs
      where status = 'running' and locked_at < now() - v_stale and attempt_count >= max_attempts
      for update skip locked loop
    update public.multi_lesson_jobs set status = 'failed', error_code = 'WORKER_LEASE_EXPIRED', locked_at = null,
      locked_by = null, completed_at = now(), updated_at = now() where id = v_job.id;
    update public.multi_lesson_materials set status = 'failed', error_code = 'WORKER_LEASE_EXPIRED', updated_at = now()
      where (id = v_job.multi_lesson_id or (v_job.generation_id is not null and generation_id = v_job.generation_id))
        and status in ('queued', 'running');
    if v_job.generation_id is not null then perform public.fail_generation_admin(v_job.generation_id, 'WORKER_LEASE_EXPIRED'); end if;
  end loop;
  select * into v_job from public.multi_lesson_jobs
    where (status in ('pending', 'retry') and next_attempt_at <= now())
       or (status = 'running' and locked_at < now() - v_stale and attempt_count < max_attempts)
    order by next_attempt_at, created_at limit 1
    for update skip locked;
  if not found then return null; end if;
  update public.multi_lesson_jobs set status = 'running', attempt_count = attempt_count + 1, locked_at = now(),
    locked_by = p_worker_id, updated_at = now() where id = v_job.id returning * into v_job;
  update public.multi_lesson_materials set status = 'running', updated_at = now()
    where (id = v_job.multi_lesson_id or (v_job.generation_id is not null and generation_id = v_job.generation_id))
      and status = 'queued';
  return to_jsonb(v_job) || jsonb_build_object('multiLesson',
    (select to_jsonb(r) from public.multi_lesson_materials r where r.id = v_job.multi_lesson_id));
end $$;

create function public.multi_lesson_renew_lease_admin(p_job_id uuid, p_worker_id text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.multi_lesson_jobs set locked_at = now(), updated_at = now()
    where id = p_job_id and status = 'running' and locked_by = p_worker_id;
  return found;
end $$;

-- Success: the record(s) answering the generation become ready, the generation is completed.
create function public.multi_lesson_complete_job_admin(p_job_id uuid, p_worker_id text, p_result jsonb, p_model text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_job public.multi_lesson_jobs;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' then raise exception 'MULTI_LESSON_INVALID_INPUT'; end if;
  select * into v_job from public.multi_lesson_jobs where id = p_job_id for update;
  if not found then raise exception 'MULTI_LESSON_NOT_FOUND'; end if;
  if v_job.status <> 'running' or v_job.locked_by is distinct from p_worker_id then raise exception 'MULTI_LESSON_LEASE_LOST'; end if;
  update public.multi_lesson_jobs set status = 'done', error_code = null, locked_at = null, locked_by = null,
    completed_at = now(), updated_at = now() where id = v_job.id;
  update public.multi_lesson_materials set status = 'ready', result = p_result, model = left(p_model, 120),
    error_code = null, completed_at = now(), updated_at = now()
    where (id = v_job.multi_lesson_id or (v_job.generation_id is not null and generation_id = v_job.generation_id))
      and status in ('queued', 'running');
  if v_job.generation_id is not null then
    perform public.complete_generation_admin(v_job.generation_id, jsonb_build_object('multiLessonId', v_job.multi_lesson_id));
  end if;
  return public.multi_lesson_get_admin(v_job.user_id, v_job.multi_lesson_id);
end $$;

-- Failure: a retryable error with attempts left waits until p_retry_at; anything else is final,
-- marks the record(s) failed and frees the generation key (fail_generation_admin).
create function public.multi_lesson_fail_job_admin(p_job_id uuid, p_worker_id text, p_error_code text, p_retry_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_job public.multi_lesson_jobs; v_code text := left(coalesce(nullif(p_error_code, ''), 'JOB_FAILED'), 80);
begin
  select * into v_job from public.multi_lesson_jobs where id = p_job_id for update;
  if not found then raise exception 'MULTI_LESSON_NOT_FOUND'; end if;
  if v_job.status <> 'running' or v_job.locked_by is distinct from p_worker_id then raise exception 'MULTI_LESSON_LEASE_LOST'; end if;
  if p_retry_at is not null and v_job.attempt_count < v_job.max_attempts then
    update public.multi_lesson_jobs set status = 'retry', next_attempt_at = p_retry_at, error_code = v_code,
      locked_at = null, locked_by = null, updated_at = now() where id = v_job.id returning * into v_job;
    update public.multi_lesson_materials set status = 'queued', updated_at = now()
      where (id = v_job.multi_lesson_id or (v_job.generation_id is not null and generation_id = v_job.generation_id))
        and status = 'running';
    return to_jsonb(v_job) || jsonb_build_object('final', false);
  end if;
  update public.multi_lesson_jobs set status = 'failed', error_code = v_code, locked_at = null, locked_by = null,
    completed_at = now(), updated_at = now() where id = v_job.id returning * into v_job;
  update public.multi_lesson_materials set status = 'failed', error_code = v_code, updated_at = now()
    where (id = v_job.multi_lesson_id or (v_job.generation_id is not null and generation_id = v_job.generation_id))
      and status in ('queued', 'running');
  if v_job.generation_id is not null then perform public.fail_generation_admin(v_job.generation_id, v_code); end if;
  return to_jsonb(v_job) || jsonb_build_object('final', true);
end $$;

revoke all on function public.multi_lesson_freeze_sources(),
  public.multi_lesson_resolve_admin(uuid, text, uuid[]),
  public.multi_lesson_get_admin(uuid, uuid),
  public.multi_lesson_list_admin(uuid, integer),
  public.multi_lesson_attach_admin(uuid, uuid, uuid, text, text, uuid[], text[], jsonb, uuid, text, integer),
  public.multi_lesson_delete_admin(uuid, uuid),
  public.multi_lesson_claim_job_admin(text, integer),
  public.multi_lesson_renew_lease_admin(uuid, text),
  public.multi_lesson_complete_job_admin(uuid, text, jsonb, text),
  public.multi_lesson_fail_job_admin(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.multi_lesson_resolve_admin(uuid, text, uuid[]),
  public.multi_lesson_get_admin(uuid, uuid),
  public.multi_lesson_list_admin(uuid, integer),
  public.multi_lesson_attach_admin(uuid, uuid, uuid, text, text, uuid[], text[], jsonb, uuid, text, integer),
  public.multi_lesson_delete_admin(uuid, uuid),
  public.multi_lesson_claim_job_admin(text, integer),
  public.multi_lesson_renew_lease_admin(uuid, text),
  public.multi_lesson_complete_job_admin(uuid, text, jsonb, text),
  public.multi_lesson_fail_job_admin(uuid, text, text, timestamptz)
  to service_role;
commit;
