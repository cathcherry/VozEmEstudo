-- Voz em Estudo 3.3 / Gerações de IA reutilizáveis — MIGRACAO CANDIDATA (nao aplicada em producao).
-- Depende de: 001_initial (processing_jobs, transcription_versions) e 20261009101846_academic_review
-- (transcription_confirmations). Aditiva: nada existente e removido ou substituido; nenhum dado
-- existente e transformado (a tabela nova comeca vazia).
-- Liga a chave canonica de geracao (backend/src/domain/generation-key.js) aos jobs:
--   * single flight persistente: um job vivo por chave (indice unico parcial + lock por chave);
--   * reutilizacao de um resultado equivalente e autorizado;
--   * invalidacao por versao: a chave inclui revisoes de origem, versao do prompt e familia do modelo;
--   * orcamento diario por conta (so pedidos que iniciam uma chamada contam; reutilizar e gratis);
--   * falha honesta: uma geracao que falhou libera a chave; um job perdido e reconciliado.
-- Escopo de turma ('classroom'): previsto no esquema; a verificacao de membro e acrescentada pela
-- integracao com Turmas (ver docs/migrations/GENERATION_REUSE.md).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
begin
  if to_regclass('public.processing_jobs') is null or to_regclass('public.transcription_confirmations') is null then
    raise exception 'GENERATION_REUSE_ABORT: aplicar 001_initial e academic_review antes';
  end if;
  if to_regclass('public.ai_generations') is not null then
    raise exception 'GENERATION_REUSE_ABORT: ai_generations ja existe; nao reaplicar';
  end if;
end
$guard$;

create table public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  generation_key text not null check (generation_key ~ '^[0-9a-f]{64}$'),
  scope_kind text not null check (scope_kind in ('user', 'classroom')),
  scope_id uuid not null,
  kind text not null check (kind in ('summary', 'questions', 'flashcards', 'multi_lesson')),
  source_revision_ids uuid[] not null check (cardinality(source_revision_ids) between 1 and 200),
  prompt_version text not null check (char_length(prompt_version) between 1 and 60),
  model_family text not null check (char_length(model_family) between 1 and 80),
  material_id uuid references public.materials(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'ready', 'failed', 'superseded')),
  job_id uuid references public.processing_jobs(id) on delete set null,
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  requested_by uuid not null references auth.users(id) on delete cascade,
  reuse_count integer not null default 0 check (reuse_count >= 0),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
-- One live generation per key: a second equivalent request joins it or reuses it.
create unique index ai_generations_live_key on public.ai_generations(generation_key)
  where status in ('pending', 'running', 'ready');
create index ai_generations_budget_idx on public.ai_generations(requested_by, created_at desc);
create index ai_generations_job_idx on public.ai_generations(job_id) where job_id is not null;

alter table public.ai_generations enable row level security;
revoke all on table public.ai_generations from public, anon, authenticated;
grant select, insert, update on table public.ai_generations to service_role;

-- Decides what a request does: 'reuse' an equivalent ready result, 'join' the equivalent job that
-- is running, or 'start' a new one (counted against the daily budget). Concurrent calls for the
-- same key are serialised, so two clicks never start two paid jobs.
create function public.begin_generation_admin(
  p_user_id uuid, p_key text, p_scope_kind text, p_scope_id uuid, p_kind text, p_sources uuid[],
  p_prompt_version text, p_model_family text, p_material_id uuid, p_allow_reuse boolean, p_daily_limit integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_gen public.ai_generations; v_job public.processing_jobs; v_used integer;
begin
  if p_scope_kind = 'user' and p_scope_id <> p_user_id then raise exception 'GENERATION_SCOPE_FORBIDDEN'; end if;
  if p_scope_kind <> 'user' then raise exception 'GENERATION_SCOPE_FORBIDDEN'; end if;
  -- Every source must be a revision of the caller's own material that the caller confirmed.
  if exists (
    select 1 from unnest(p_sources) s(id)
    where not exists (
      select 1 from public.transcription_versions tv
      join public.transcriptions t on t.id = tv.transcription_id
      join public.materials m on m.id = t.material_id and m.user_id = p_user_id
      join public.transcription_confirmations tc on tc.transcription_version_id = tv.id and tc.user_id = p_user_id
      where tv.id = s.id)) then
    raise exception 'GENERATION_SOURCE_FORBIDDEN';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));
  select * into v_gen from public.ai_generations
    where generation_key = p_key and status in ('pending', 'running', 'ready') for update;
  if found then
    -- A live row whose job ended without bookkeeping (worker lost) is reconciled first.
    if v_gen.status in ('pending', 'running') and v_gen.job_id is not null then
      select * into v_job from public.processing_jobs where id = v_gen.job_id;
      if v_job.status = 'FALHOU' then
        update public.ai_generations set status = 'failed', error_code = coalesce(v_job.error_code, 'JOB_FAILED'),
          updated_at = now(), completed_at = now() where id = v_gen.id;
        v_gen := null;
      elsif v_job.status = 'CONCLUIDA' then
        update public.ai_generations set status = 'ready', result = coalesce(result, jsonb_build_object('jobId', v_job.id)),
          updated_at = now(), completed_at = now() where id = v_gen.id returning * into v_gen;
      end if;
    elsif v_gen.status = 'pending' and v_gen.job_id is null and v_gen.created_at < now() - interval '10 minutes' then
      -- Started but never attached to a job (the request died): free the key.
      update public.ai_generations set status = 'failed', error_code = 'GENERATION_ABANDONED', updated_at = now()
        where id = v_gen.id;
      v_gen := null;
    end if;
  end if;
  if v_gen.id is not null then
    if v_gen.status in ('pending', 'running') then
      return jsonb_build_object('decision', 'join', 'generation', to_jsonb(v_gen));
    end if;
    if p_allow_reuse then
      update public.ai_generations set reuse_count = reuse_count + 1, updated_at = now() where id = v_gen.id
        returning * into v_gen;
      return jsonb_build_object('decision', 'reuse', 'generation', to_jsonb(v_gen));
    end if;
    -- The student asked for a fresh version: the old result stays, but no longer answers the key.
    update public.ai_generations set status = 'superseded', updated_at = now() where id = v_gen.id;
  end if;
  -- Every generation that started an AI call counts (superseded and failed ones included);
  -- reusing or joining creates no row and is free.
  select count(*) into v_used from public.ai_generations
    where requested_by = p_user_id and created_at > now() - interval '1 day';
  if p_daily_limit is not null and v_used >= p_daily_limit then raise exception 'GENERATION_BUDGET_EXCEEDED'; end if;
  insert into public.ai_generations(generation_key, scope_kind, scope_id, kind, source_revision_ids, prompt_version,
    model_family, material_id, requested_by)
  values (p_key, p_scope_kind, p_scope_id, p_kind, p_sources, p_prompt_version, p_model_family, p_material_id, p_user_id)
  returning * into v_gen;
  return jsonb_build_object('decision', 'start', 'generation', to_jsonb(v_gen), 'used', v_used + 1);
end $$;

create function public.attach_generation_job_admin(p_generation_id uuid, p_job_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_gen public.ai_generations;
begin
  update public.ai_generations set job_id = p_job_id, status = 'running', updated_at = now()
    where id = p_generation_id and status = 'pending' returning * into v_gen;
  if not found then raise exception 'GENERATION_NOT_FOUND'; end if;
  return to_jsonb(v_gen);
end $$;

create function public.complete_generation_admin(p_generation_id uuid, p_result jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_gen public.ai_generations;
begin
  update public.ai_generations set status = 'ready', result = coalesce(p_result, '{}'::jsonb), error_code = null,
    updated_at = now(), completed_at = now()
    where id = p_generation_id and status in ('pending', 'running') returning * into v_gen;
  if not found then
    select * into v_gen from public.ai_generations where id = p_generation_id;
    if not found then raise exception 'GENERATION_NOT_FOUND'; end if;
  end if;
  return to_jsonb(v_gen);
end $$;

-- A failure frees the key: the next equivalent request starts again (no silent reuse of errors).
create function public.fail_generation_admin(p_generation_id uuid, p_error_code text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_gen public.ai_generations;
begin
  update public.ai_generations set status = 'failed', error_code = left(coalesce(p_error_code, 'JOB_FAILED'), 80),
    updated_at = now(), completed_at = now()
    where id = p_generation_id and status in ('pending', 'running') returning * into v_gen;
  if not found then
    select * into v_gen from public.ai_generations where id = p_generation_id;
    if not found then raise exception 'GENERATION_NOT_FOUND'; end if;
  end if;
  return to_jsonb(v_gen);
end $$;

revoke all on function public.begin_generation_admin(uuid, text, text, uuid, text, uuid[], text, text, uuid, boolean, integer),
  public.attach_generation_job_admin(uuid, uuid),
  public.complete_generation_admin(uuid, jsonb),
  public.fail_generation_admin(uuid, text)
  from public, anon, authenticated;
grant execute on function public.begin_generation_admin(uuid, text, text, uuid, text, uuid[], text, text, uuid, boolean, integer),
  public.attach_generation_job_admin(uuid, uuid),
  public.complete_generation_admin(uuid, jsonb),
  public.fail_generation_admin(uuid, text)
  to service_role;
commit;
