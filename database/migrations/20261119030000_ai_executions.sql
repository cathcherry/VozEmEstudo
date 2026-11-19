-- AI providers / Phases B-C: durable AI execution records, word-level alignment storage and
-- stale-lease recovery. Additive only: no existing table, column or function is altered.
-- Candidate, NOT applied. Apply once, after reviewing docs/AI_PROVIDERS.md.
begin;

-- One row per processing job: the provider/model snapshot resolved at enqueue plus the state of an
-- external asynchronous transcription (upload, submission, polling). Server-only.
create table public.ai_job_executions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.processing_jobs(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  task text not null check (task in ('transcription','summary','questions','warnings','flashcards','cleanup')),
  provider text not null check (length(provider) between 1 and 60),
  requested_model text,
  actual_model text,
  settings jsonb not null default '{}'::jsonb,
  state text not null default 'pending'
    check (state in ('pending','uploaded','submitting','processing','completed','failed')),
  upload_ref text,
  external_job_id text,
  submit_count integer not null default 0 check (submit_count >= 0),
  poll_count integer not null default 0 check (poll_count >= 0),
  submitted_at timestamptz,
  deadline_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ai_job_executions_external_idx
  on public.ai_job_executions(provider, external_job_id) where external_job_id is not null;
create index ai_job_executions_material_idx on public.ai_job_executions(material_id);
alter table public.ai_job_executions enable row level security;
revoke all on public.ai_job_executions from public, anon, authenticated;
grant select, insert, update on public.ai_job_executions to service_role;

-- Canonical word timings for an ASR revision. Display segments are derived from these words; a
-- human edit creates a new revision without alignment, so stale timings are never reused.
create table public.transcription_word_alignments (
  transcription_version_id uuid primary key
    references public.transcription_versions(id) on delete cascade,
  provider text not null,
  model text,
  words jsonb not null check (jsonb_typeof(words) = 'array'),
  utterances jsonb not null default '[]'::jsonb check (jsonb_typeof(utterances) = 'array'),
  created_at timestamptz not null default now()
);
alter table public.transcription_word_alignments enable row level security;
revoke all on public.transcription_word_alignments from public, anon, authenticated;
grant select, insert on public.transcription_word_alignments to service_role;

-- Atomic persistence of an ASR result with its alignment. Reuses the existing idempotent RPC, so a
-- repeated completion returns the stored transcription and never duplicates rows. The alignment is
-- attached only to an untouched ASR revision 1 whose text equals this result.
create function public.create_initial_transcription_with_alignment_admin(p_material_id uuid, p_result jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_transcription jsonb; v_version public.transcription_versions;
begin
  v_transcription := public.create_initial_transcription_admin(p_material_id, p_result);
  if jsonb_array_length(coalesce(p_result->'words','[]'::jsonb)) = 0 then return v_transcription; end if;
  select * into v_version from public.transcription_versions
    where transcription_id = (v_transcription->>'id')::uuid and revision = 1 and origin = 'ASR';
  if v_version.id is null or v_version.full_text is distinct from p_result->>'text' then
    return v_transcription;
  end if;
  insert into public.transcription_word_alignments(transcription_version_id, provider, model, words, utterances)
  values (v_version.id, coalesce(p_result#>>'{metadata,provider}','unknown'),
    coalesce(p_result#>>'{metadata,actualModel}', p_result#>>'{metadata,requestedModel}'),
    p_result->'words', coalesce(p_result->'utterances','[]'::jsonb))
  on conflict (transcription_version_id) do nothing;
  return v_transcription;
end $$;
revoke all on function public.create_initial_transcription_with_alignment_admin(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.create_initial_transcription_with_alignment_admin(uuid,jsonb) to service_role;

-- Claim with lease recovery: a job left EM_EXECUCAO by a crashed worker becomes claimable after
-- p_stale_after_seconds. Jobs that already exhausted their attempts are failed instead of re-run.
-- The original one-argument function stays available and unchanged.
create function public.claim_next_processing_job(p_worker_id text, p_stale_after_seconds integer)
returns setof public.processing_jobs
language plpgsql security definer set search_path = public as $$
declare v_job_id uuid;
begin
  if p_stale_after_seconds is null or p_stale_after_seconds < 60 then raise exception 'INVALID_LEASE'; end if;
  with expired as (
    update public.processing_jobs
    set status = 'FALHOU', locked_at = null, locked_by = null, completed_at = now(),
        error_code = 'LEASE_EXPIRED',
        error_message = 'O processamento foi interrompido e esgotou as tentativas disponíveis.'
    where status = 'EM_EXECUCAO' and locked_at < now() - make_interval(secs => p_stale_after_seconds)
      and attempt_count >= max_attempts
    returning material_id
  )
  update public.materials m set status = case when exists
      (select 1 from public.transcriptions t where t.material_id = m.id) then 'PARCIAL' else 'FALHOU' end::public.material_status,
    current_stage = null, last_error_code = 'LEASE_EXPIRED',
    last_error_message = 'O processamento foi interrompido e esgotou as tentativas disponíveis.'
  where m.id in (select material_id from expired);

  select id into v_job_id from public.processing_jobs
  where (status in ('PENDENTE','AGUARDANDO_REPETICAO') and next_attempt_at <= now())
     or (status = 'EM_EXECUCAO' and locked_at < now() - make_interval(secs => p_stale_after_seconds))
  order by created_at
  for update skip locked
  limit 1;
  if v_job_id is null then return; end if;

  update public.processing_jobs
  set status = 'EM_EXECUCAO', locked_at = now(), locked_by = p_worker_id,
      started_at = coalesce(started_at, now()), attempt_count = attempt_count + 1
  where id = v_job_id;
  return query select * from public.processing_jobs where id = v_job_id;
end $$;
revoke all on function public.claim_next_processing_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_next_processing_job(text, integer) to service_role;

commit;
