-- Voz em Estudo — public testing program (controlled release for ~30–100 participants).
-- Additive only: new tables and functions, one RESTRICTIVE storage policy. No existing table,
-- column, constraint, function, policy or row is changed. Applying it changes nothing for anyone
-- until the program is switched on in public.public_testing_config (enabled = false by default).
--
-- What it adds (all server-only: RLS on, nothing granted to browsers; the API calls the *_admin
-- functions with the service role):
--   app_admins             explicit allowlist of developer accounts (by auth user id); revocable.
--   public_testing_config  one row: registration window, per-role limits, global caps, costs.
--   demo_access_grants     who may open the shared demonstration lessons (persisted at first check).
--   usage_ledger           every expensive action, reserved atomically before it runs; idempotent
--                          per (user, kind, ref); released when the work never reached a provider.
--   demo_lessons           canonical demonstration lessons (one audio file, one verified transcript,
--                          one set of materials) and demo_lesson_copies (a participant's own
--                          lightweight copy of the text rows, so attempts, notes, cards and progress
--                          stay private under the existing ownership constraints; media is never
--                          duplicated and no AI runs).
-- Rollback: database/rollback/public-testing-rollback.sql (drops only what this file creates).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
declare v_missing text[] := '{}';
begin
  if to_regclass('public.materials') is null then v_missing := array_append(v_missing, 'materials'); end if;
  if to_regclass('public.transcription_versions') is null then v_missing := array_append(v_missing, 'transcription_versions (E02)'); end if;
  if to_regclass('public.material_permissions') is null then v_missing := array_append(v_missing, 'material_permissions (E02)'); end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'question_batches' and column_name = 'title') then
    v_missing := array_append(v_missing, 'question_batches.title (study_authoring)');
  end if;
  if to_regprocedure('public.current_permission_version()') is null then
    v_missing := array_append(v_missing, 'current_permission_version()');
  end if;
  if cardinality(v_missing) > 0 then
    raise exception 'PUBLIC_TESTING_ABORT: faltam pré-requisitos: %', array_to_string(v_missing, '; ');
  end if;
  if to_regclass('public.usage_ledger') is not null or to_regclass('public.app_admins') is not null then
    raise exception 'PUBLIC_TESTING_ABORT: estruturas do programa de testes ja existem; nao reaplicar';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by text not null check (char_length(granted_by) between 1 and 120),
  note text check (note is null or char_length(note) <= 300),
  revoked_at timestamptz
);

create table public.public_testing_config (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  registration_starts_at timestamptz,
  registration_ends_at timestamptz,
  demo_access_enabled boolean not null default true,
  -- Limits per role for the whole program (cumulative, never renewed). Missing kind = no personal
  -- limit (still counted globally); 0 = not allowed.
  tester_limits jsonb not null default '{"transcription_seconds":300,"summary":2,"questions":2,"flashcards":1,"flashcard_replace":5,"warnings":1,"multi_lesson":0}'::jsonb,
  admin_limits jsonb not null default '{"transcription_seconds":7200,"summary":30,"questions":30,"flashcards":20,"flashcard_replace":60,"warnings":20,"multi_lesson":10}'::jsonb,
  -- Aggregate caps for everyone (admins included). Seconds of audio; LLM requests and estimated
  -- tokens are derived from kind_costs. null = no cap for that window.
  global_limits jsonb not null default '{"transcription_seconds":{"total":54000,"day":18000,"hour":5400},"llm_requests":{"total":null,"day":900,"hour":300},"llm_tokens":{"total":null,"day":180000,"hour":60000},"concurrent_transcriptions":2}'::jsonb,
  -- Estimated provider load of one unit of each kind (requests and tokens incl. reasoning).
  kind_costs jsonb not null default '{"transcription_seconds":{"requests":0,"tokens":0},"processing_llm":{"requests":1,"tokens":6000},"summary":{"requests":1,"tokens":9000},"questions":{"requests":3,"tokens":22000},"flashcards":{"requests":1,"tokens":7000},"flashcard_replace":{"requests":1,"tokens":2500},"warnings":{"requests":1,"tokens":6000},"multi_lesson":{"requests":4,"tokens":40000}}'::jsonb,
  -- Accounts created before registration_starts_at keep the previous behaviour (legacy limits)
  -- unless this is true. Admins always use admin_limits.
  apply_to_existing_accounts boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint public_testing_window_check check (
    registration_ends_at is null or registration_starts_at is null or registration_ends_at > registration_starts_at)
);
insert into public.public_testing_config (id) values (1);

create table public.demo_access_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  source text not null check (source in ('cohort', 'admin', 'manual'))
);

create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('transcription_seconds', 'processing_llm', 'summary', 'questions',
    'flashcards', 'flashcard_replace', 'warnings', 'multi_lesson')),
  ref text not null check (char_length(ref) between 1 and 200),
  units integer not null check (units > 0),
  policy text not null check (policy in ('tester', 'admin', 'legacy', 'off')),
  status text not null default 'reserved' check (status in ('reserved', 'committed', 'released')),
  material_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint usage_ledger_ref_unique unique (user_id, kind, ref)
);
create index usage_ledger_user_kind_idx on public.usage_ledger(user_id, kind) where status <> 'released';
create index usage_ledger_kind_time_idx on public.usage_ledger(kind, created_at) where status <> 'released';

create table public.demo_lessons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  version integer not null default 1 check (version >= 1),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  subject text not null check (char_length(btrim(subject)) between 1 and 120),
  description text check (description is null or char_length(description) <= 400),
  language text not null default 'pt',
  cover jsonb not null default '{}'::jsonb,
  duration_ms integer not null check (duration_ms > 0 and duration_ms <= 3600000),
  audio_storage_path text not null check (audio_storage_path ~ '^demo/[a-z0-9-]+/[a-z0-9._-]+$'),
  audio_mime text not null,
  audio_size_bytes bigint not null check (audio_size_bytes > 0),
  video_storage_path text check (video_storage_path is null or video_storage_path ~ '^demo/[a-z0-9-]+/[a-z0-9._-]+$'),
  video_mime text,
  -- segments, words, summary, questions, flashcards, credits (see database/demo-lessons/*/lesson.json)
  content jsonb not null,
  published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint demo_lessons_content_check check (
    jsonb_typeof(content->'segments') = 'array' and jsonb_array_length(content->'segments') between 1 and 2000
    and jsonb_typeof(content->'summary') = 'object' and jsonb_typeof(content->'questions') = 'object')
);

create table public.demo_lesson_copies (
  user_id uuid not null references auth.users(id) on delete cascade,
  demo_lesson_id uuid not null references public.demo_lessons(id) on delete restrict,
  demo_version integer not null,
  material_id uuid not null unique,
  created_at timestamptz not null default now(),
  primary key (user_id, demo_lesson_id),
  constraint demo_lesson_copies_material_fk foreign key (material_id, user_id)
    references public.materials(id, user_id) on delete cascade
);

alter table public.app_admins enable row level security;
alter table public.public_testing_config enable row level security;
alter table public.demo_access_grants enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.demo_lessons enable row level security;
alter table public.demo_lesson_copies enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Policy resolution
-- ---------------------------------------------------------------------------------------------
create function public.testing_is_admin(p_user_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.app_admins where user_id = p_user_id and revoked_at is null)
$$;

-- The only definer function: service_role cannot read auth.users, and the cohort depends on when
-- the account was created. Returns that single timestamp for one id; executable by the server only.
create function public.testing_account_created_at(p_user_id uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select u.created_at from auth.users u where u.id = p_user_id
$$;

-- 'admin' | 'tester' | 'legacy' | 'off'
create function public.testing_policy(p_user_id uuid)
returns text language plpgsql stable security invoker set search_path = '' as $$
declare v_config public.public_testing_config; v_created timestamptz;
begin
  if public.testing_is_admin(p_user_id) then return 'admin'; end if;
  select * into v_config from public.public_testing_config where id = 1;
  if not found or not v_config.enabled then return 'off'; end if;
  if exists (select 1 from public.demo_access_grants where user_id = p_user_id and source = 'cohort') then
    return 'tester';
  end if;
  v_created := public.testing_account_created_at(p_user_id);
  if v_config.apply_to_existing_accounts
     or v_config.registration_starts_at is null
     or (v_created is not null and v_created >= v_config.registration_starts_at) then
    return 'tester';
  end if;
  return 'legacy';
end $$;

-- Demo access: admins always; a persisted grant; or a new account of the open cohort window
-- (the grant is then persisted, so access survives the end of the window).
create function public.testing_demo_access_admin(p_user_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_config public.public_testing_config; v_created timestamptz;
begin
  if p_user_id is null then return false; end if;
  select * into v_config from public.public_testing_config where id = 1;
  if exists (select 1 from public.demo_access_grants where user_id = p_user_id) then
    return coalesce(v_config.demo_access_enabled, false);
  end if;
  if public.testing_is_admin(p_user_id) then
    insert into public.demo_access_grants(user_id, source) values (p_user_id, 'admin') on conflict do nothing;
    return true;
  end if;
  if v_config.id is null or not v_config.enabled or not v_config.demo_access_enabled then return false; end if;
  v_created := public.testing_account_created_at(p_user_id);
  if v_created is null then return false; end if;
  if (v_config.registration_starts_at is null or v_created >= v_config.registration_starts_at)
     and (v_config.registration_ends_at is null or v_created < v_config.registration_ends_at) then
    insert into public.demo_access_grants(user_id, source) values (p_user_id, 'cohort') on conflict do nothing;
    return true;
  end if;
  return false;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Usage ledger
-- ---------------------------------------------------------------------------------------------
create function public.testing_kind_cost(p_config public.public_testing_config, p_kind text, p_field text)
returns integer language sql immutable security invoker set search_path = '' as $$
  select coalesce((p_config.kind_costs->p_kind->>p_field)::integer, 0)
$$;

-- Sum of estimated LLM requests or tokens since p_since (all users).
create function public.testing_llm_load(p_config public.public_testing_config, p_field text, p_since timestamptz)
returns bigint language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(l.units::bigint * public.testing_kind_cost(p_config, l.kind, p_field)), 0)
  from public.usage_ledger l
  where l.status <> 'released' and l.kind <> 'transcription_seconds'
    and (p_since is null or l.created_at >= p_since)
$$;

/**
 * Atomic, idempotent reservation of p_units of p_kind for p_user_id, identified by p_ref (a job id,
 * a request idempotency key…). Repeating the same ref never counts twice. Checks the personal
 * limit of the account's role and every global cap, under advisory locks, so concurrent requests
 * (several tabs, retries, many users) cannot overshoot. Returns
 * {ok, policy, reason?, limit, used, remaining, units, duplicate}.
 */
create function public.testing_reserve_admin(
  p_user_id uuid, p_kind text, p_ref text, p_units integer, p_material_id uuid default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_config public.public_testing_config;
  v_policy text;
  v_existing public.usage_ledger;
  v_limit integer;
  v_used bigint;
  v_global jsonb;
  v_window record;
  v_sum bigint;
  v_cap bigint;
  v_now timestamptz := now();
  v_had boolean;
begin
  if p_user_id is null or p_kind is null or p_ref is null or p_units is null or p_units <= 0 then
    raise exception 'USAGE_INVALID' using errcode = 'P0001';
  end if;
  -- One account at a time per kind; global caps under one program-wide lock.
  perform pg_advisory_xact_lock(hashtextextended('usage:' || p_user_id::text || ':' || p_kind, 0));
  perform pg_advisory_xact_lock(hashtextextended('usage:global', 0));

  select * into v_existing from public.usage_ledger where user_id = p_user_id and kind = p_kind and ref = p_ref;
  v_had := found;
  if v_had and v_existing.status <> 'released' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'policy', v_existing.policy, 'units', v_existing.units);
  end if;

  select * into v_config from public.public_testing_config where id = 1;
  v_policy := public.testing_policy(p_user_id);

  if v_policy in ('tester', 'admin') then
    v_limit := case when v_policy = 'admin' then (v_config.admin_limits->>p_kind)::integer
                    else (v_config.tester_limits->>p_kind)::integer end;
    select coalesce(sum(units), 0) into v_used from public.usage_ledger
      where user_id = p_user_id and kind = p_kind and status <> 'released';
    if v_limit is not null and v_used + p_units > v_limit then
      return jsonb_build_object('ok', false, 'reason', 'user_quota', 'policy', v_policy,
        'limit', v_limit, 'used', v_used, 'remaining', greatest(v_limit - v_used, 0), 'units', p_units);
    end if;
  end if;

  -- Global caps apply whenever the program is on (admins included).
  if v_config.enabled then
    v_global := v_config.global_limits;
    if p_kind = 'transcription_seconds' then
      for v_window in select * from (values ('total', null::timestamptz), ('day', v_now - interval '1 day'),
          ('hour', v_now - interval '1 hour')) as w(name, since) loop
        v_cap := (v_global->'transcription_seconds'->>v_window.name)::bigint;
        continue when v_cap is null;
        select coalesce(sum(units), 0) into v_sum from public.usage_ledger
          where kind = 'transcription_seconds' and status <> 'released'
            and (v_window.since is null or created_at >= v_window.since);
        if v_sum + p_units > v_cap then
          return jsonb_build_object('ok', false, 'reason', 'global_cap', 'window', v_window.name,
            'policy', v_policy, 'units', p_units);
        end if;
      end loop;
    else
      for v_window in select * from (values ('total', null::timestamptz), ('day', v_now - interval '1 day'),
          ('hour', v_now - interval '1 hour')) as w(name, since) loop
        v_cap := (v_global->'llm_requests'->>v_window.name)::bigint;
        if v_cap is not null and public.testing_llm_load(v_config, 'requests', v_window.since)
            + p_units::bigint * public.testing_kind_cost(v_config, p_kind, 'requests') > v_cap then
          return jsonb_build_object('ok', false, 'reason', 'global_cap', 'window', v_window.name,
            'policy', v_policy, 'units', p_units);
        end if;
        v_cap := (v_global->'llm_tokens'->>v_window.name)::bigint;
        if v_cap is not null and public.testing_llm_load(v_config, 'tokens', v_window.since)
            + p_units::bigint * public.testing_kind_cost(v_config, p_kind, 'tokens') > v_cap then
          return jsonb_build_object('ok', false, 'reason', 'global_cap', 'window', v_window.name,
            'policy', v_policy, 'units', p_units);
        end if;
      end loop;
    end if;
  end if;

  if v_had then
    update public.usage_ledger set status = 'reserved', units = p_units, policy = v_policy,
      material_id = coalesce(p_material_id, material_id), updated_at = v_now, created_at = v_now
      where id = v_existing.id;
  else
    insert into public.usage_ledger(user_id, kind, ref, units, policy, material_id)
      values (p_user_id, p_kind, p_ref, p_units, v_policy, p_material_id);
  end if;
  select coalesce(sum(units), 0) into v_used from public.usage_ledger
    where user_id = p_user_id and kind = p_kind and status <> 'released';
  return jsonb_build_object('ok', true, 'duplicate', false, 'policy', v_policy, 'units', p_units,
    'limit', v_limit, 'used', v_used,
    'remaining', case when v_limit is null then null else greatest(v_limit - v_used, 0) end);
end $$;

-- The work never reached a provider (validation error, enqueue failure, provider rejected before
-- processing): give the units back. Already released or missing refs are a no-op.
create function public.testing_release_admin(p_user_id uuid, p_kind text, p_ref text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.usage_ledger set status = 'released', updated_at = now()
    where user_id = p_user_id and kind = p_kind and ref = p_ref and status = 'reserved';
  return found;
end $$;

create function public.testing_commit_admin(p_user_id uuid, p_kind text, p_ref text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.usage_ledger set status = 'committed', updated_at = now()
    where user_id = p_user_id and kind = p_kind and ref = p_ref and status = 'reserved';
  return found;
end $$;

-- What an account sees in Conta: role, limits, use, remaining, demo access. No other user's data.
create function public.testing_usage_admin(p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_config public.public_testing_config; v_policy text; v_limits jsonb; v_used jsonb;
begin
  select * into v_config from public.public_testing_config where id = 1;
  v_policy := public.testing_policy(p_user_id);
  v_limits := case v_policy when 'admin' then v_config.admin_limits when 'tester' then v_config.tester_limits else '{}'::jsonb end;
  select coalesce(jsonb_object_agg(kind, used), '{}'::jsonb) into v_used from (
    select kind, sum(units) as used from public.usage_ledger
    where user_id = p_user_id and status <> 'released' group by kind) s;
  return jsonb_build_object(
    'policy', v_policy,
    'admin', v_policy = 'admin',
    'programEnabled', coalesce(v_config.enabled, false),
    'registrationEndsAt', v_config.registration_ends_at,
    'limits', v_limits,
    'used', v_used,
    'demoAccess', exists (select 1 from public.demo_access_grants where user_id = p_user_id)
      and coalesce(v_config.demo_access_enabled, false));
end $$;

-- Program-wide figures for administrators (no per-user identities).
create function public.testing_overview_admin()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_config public.public_testing_config; v_now timestamptz := now();
begin
  select * into v_config from public.public_testing_config where id = 1;
  return jsonb_build_object(
    'config', jsonb_build_object('enabled', v_config.enabled, 'registrationStartsAt', v_config.registration_starts_at,
      'registrationEndsAt', v_config.registration_ends_at, 'demoAccessEnabled', v_config.demo_access_enabled,
      'testerLimits', v_config.tester_limits, 'adminLimits', v_config.admin_limits,
      'globalLimits', v_config.global_limits, 'applyToExistingAccounts', v_config.apply_to_existing_accounts),
    'participants', (select count(*) from public.demo_access_grants where source = 'cohort'),
    'admins', (select count(*) from public.app_admins where revoked_at is null),
    'demoCopies', (select count(*) from public.demo_lesson_copies),
    'transcriptionSeconds', jsonb_build_object(
      'total', (select coalesce(sum(units), 0) from public.usage_ledger where kind = 'transcription_seconds' and status <> 'released'),
      'day', (select coalesce(sum(units), 0) from public.usage_ledger where kind = 'transcription_seconds' and status <> 'released' and created_at >= v_now - interval '1 day'),
      'hour', (select coalesce(sum(units), 0) from public.usage_ledger where kind = 'transcription_seconds' and status <> 'released' and created_at >= v_now - interval '1 hour')),
    'llmRequests', jsonb_build_object(
      'total', public.testing_llm_load(v_config, 'requests', null),
      'day', public.testing_llm_load(v_config, 'requests', v_now - interval '1 day'),
      'hour', public.testing_llm_load(v_config, 'requests', v_now - interval '1 hour')),
    'llmTokens', jsonb_build_object(
      'total', public.testing_llm_load(v_config, 'tokens', null),
      'day', public.testing_llm_load(v_config, 'tokens', v_now - interval '1 day'),
      'hour', public.testing_llm_load(v_config, 'tokens', v_now - interval '1 hour')),
    'byKind', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
      select kind, sum(units) n from public.usage_ledger where status <> 'released' group by kind) s),
    'queue', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
      select status::text, count(*) n from public.processing_jobs
      where status in ('PENDENTE', 'EM_EXECUCAO', 'AGUARDANDO_REPETICAO') group by status) q));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Demonstration lessons
-- ---------------------------------------------------------------------------------------------
create function public.demo_lessons_list_admin(p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if not public.testing_demo_access_admin(p_user_id) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'slug', d.slug, 'title', d.title, 'subject', d.subject, 'description', d.description,
      'cover', d.cover, 'durationMs', d.duration_ms, 'hasVideo', d.video_storage_path is not null,
      'questionCount', jsonb_array_length(coalesce(d.content->'questions'->'items', '[]'::jsonb)),
      'flashcardCount', jsonb_array_length(coalesce(d.content->'flashcards'->'cards', '[]'::jsonb)),
      'materialId', c.material_id) order by d.sort_order, d.title)
    from public.demo_lessons d
    left join public.demo_lesson_copies c on c.demo_lesson_id = d.id and c.user_id = p_user_id
      and exists (select 1 from public.materials m where m.id = c.material_id and m.user_id = p_user_id)
    where d.published), '[]'::jsonb);
end $$;

/**
 * A participant's own copy of a published demo lesson: material, audio row pointing to the ONE
 * canonical file, the verified transcript (current revision, confirmed), summary and question
 * list, with the same source references. Idempotent per (user, lesson). No AI, no media copy.
 * Flashcards are created by the API through the regular set service (validation reused).
 */
create function public.demo_lesson_materialize_admin(p_user_id uuid, p_demo_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_demo public.demo_lessons;
  v_copy public.demo_lesson_copies;
  v_material uuid := gen_random_uuid();
  v_transcription uuid;
  v_version uuid := gen_random_uuid();
  v_batch uuid := gen_random_uuid();
  v_full text;
  v_snapshot jsonb;
  v_segment jsonb;
  v_ids uuid[] := '{}';
  v_seg_id uuid;
  v_question jsonb;
  v_position integer := 0;
  v_confirmation uuid;
  v_summary_job uuid := gen_random_uuid();
  v_questions_job uuid := gen_random_uuid();
  v_params jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('demo:' || p_user_id::text || ':' || p_demo_id::text, 0));
  if not public.testing_demo_access_admin(p_user_id) then
    raise exception 'DEMO_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  select * into v_demo from public.demo_lessons where id = p_demo_id and published;
  if not found then raise exception 'DEMO_NOT_FOUND' using errcode = 'P0001'; end if;

  select * into v_copy from public.demo_lesson_copies where user_id = p_user_id and demo_lesson_id = p_demo_id;
  if found then
    if exists (select 1 from public.materials where id = v_copy.material_id and user_id = p_user_id) then
      return jsonb_build_object('materialId', v_copy.material_id, 'created', false, 'demoId', p_demo_id);
    end if;
    delete from public.demo_lesson_copies where user_id = p_user_id and demo_lesson_id = p_demo_id;
  end if;

  insert into public.materials(id, user_id, title, subject, status, review_state, initial_question_count, completed_at)
    values (v_material, p_user_id, v_demo.title, v_demo.subject, 'PRONTO', 'pending_transcription', 5, now());
  insert into public.material_permissions(user_id, material_id, declaration_version, declaration_text)
    values (p_user_id, v_material, public.current_permission_version(),
      'Aula de demonstração do Voz em Estudo: conteúdo original da equipe, licenciado para o programa de testes.');
  insert into public.audio_files(material_id, original_name, mime_type, extension, size_bytes, duration_ms, retain_original, storage_path)
    values (v_material, v_demo.slug || '.' || split_part(v_demo.audio_storage_path, '.', 2), v_demo.audio_mime,
      split_part(v_demo.audio_storage_path, '.', 2), v_demo.audio_size_bytes, v_demo.duration_ms, true, v_demo.audio_storage_path);

  select string_agg(s->>'text', ' ' order by (s->>'position')::int) into v_full
    from jsonb_array_elements(v_demo.content->'segments') s;
  insert into public.transcriptions(material_id, language, current_revision, current_text)
    values (v_material, v_demo.language, 1, v_full) returning id into v_transcription;
  for v_segment in select s from jsonb_array_elements(v_demo.content->'segments') s order by (s->>'position')::int loop
    insert into public.transcription_segments(transcription_id, position, start_ms, end_ms, original_text, current_text)
      values (v_transcription, (v_segment->>'position')::int, (v_segment->>'startMs')::bigint,
        (v_segment->>'endMs')::bigint, v_segment->>'text', v_segment->>'text')
      returning id into v_seg_id;
    v_ids := array_append(v_ids, v_seg_id);
  end loop;
  select jsonb_agg(jsonb_build_object('id', v_ids[o.n], 'position', (o.s->>'position')::int,
      'startMs', (o.s->>'startMs')::bigint, 'endMs', (o.s->>'endMs')::bigint, 'text', o.s->>'text') order by o.n)
    into v_snapshot
    from (select s, row_number() over (order by (s->>'position')::int) as n
          from jsonb_array_elements(v_demo.content->'segments') s) o;
  insert into public.transcription_versions(id, transcription_id, revision, origin, full_text, segments_snapshot)
    values (v_version, v_transcription, 1, 'ASR', v_full, v_snapshot);
  if jsonb_typeof(v_demo.content->'words') = 'array' and to_regclass('public.transcription_word_alignments') is not null then
    execute 'insert into public.transcription_word_alignments(transcription_version_id, provider, model, words) values ($1, $2, $3, $4)'
      using v_version, 'demo', 'demo-v' || v_demo.version, v_demo.content->'words';
  end if;
  insert into public.transcription_confirmations(user_id, material_id, transcription_version_id, consent_version)
    values (p_user_id, v_material, v_version, public.current_permission_version())
    returning id into v_confirmation;
  -- Derived content must point to a job bound to the confirmed revision (existing triggers). These
  -- jobs are recorded as already finished: nothing is queued, the worker never sees them, no AI runs.
  v_params := jsonb_build_object('sourceRevisionId', v_version::text,
    'permissionVersion', public.current_permission_version(), 'demoLessonId', p_demo_id::text);
  insert into public.processing_jobs(id, material_id, type, status, params, attempt_count, max_attempts,
      source_transcription_version_id, confirmation_id, idempotency_key, started_at, completed_at)
    values (v_summary_job, v_material, 'REGERAR_RESUMO', 'CONCLUIDA', v_params, 0, 1, v_version, v_confirmation,
      gen_random_uuid(), now(), now()),
      (v_questions_job, v_material, 'GERAR_QUESTOES', 'CONCLUIDA', v_params || '{"count":0}'::jsonb, 0, 1, v_version,
      v_confirmation, gen_random_uuid(), now(), now());

  insert into public.summary_versions(material_id, version, text, source_transcription_revision, model, prompt_version,
      is_current, source_transcription_version_id, processing_job_id, label, provider)
    values (v_material, 1, v_demo.content->'summary'->>'text', 1, 'demo-v' || v_demo.version, 'demo-lesson',
      true, v_version, v_summary_job, coalesce(v_demo.content->'summary'->>'label', 'Resumo da aula'), 'demo');

  insert into public.question_batches(id, material_id, source_transcription_revision, requested_count, generated_count,
      model, prompt_version, source_transcription_version_id, processing_job_id, title, provider, config)
    values (v_batch, v_material, 1,
      jsonb_array_length(v_demo.content->'questions'->'items'), jsonb_array_length(v_demo.content->'questions'->'items'),
      'demo-v' || v_demo.version, 'demo-lesson', v_version, v_questions_job,
      coalesce(v_demo.content->'questions'->>'title', 'Questões da aula'), 'demo', '{"demo":true}'::jsonb);
  for v_question in select q from jsonb_array_elements(v_demo.content->'questions'->'items') q loop
    insert into public.questions(batch_id, position, statement, options, correct_index, explanation, metadata)
      values (v_batch, v_position, v_question->>'statement', v_question->'options',
        (v_question->>'correctIndex')::smallint, v_question->>'explanation', coalesce(v_question->'metadata', '{}'::jsonb));
    v_position := v_position + 1;
  end loop;

  update public.materials set review_state = 'ready_to_generate', status = 'PRONTO' where id = v_material;
  insert into public.demo_lesson_copies(user_id, demo_lesson_id, demo_version, material_id)
    values (p_user_id, p_demo_id, v_demo.version, v_material);
  return jsonb_build_object('materialId', v_material, 'created', true, 'demoId', p_demo_id,
    'sourceRevisionId', v_version, 'flashcards', coalesce(v_demo.content->'flashcards', 'null'::jsonb));
end $$;

-- Is this material a demo copy (and which canonical files may it read)?
create function public.demo_copy_of_admin(p_user_id uuid, p_material_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('demoId', d.id, 'slug', d.slug, 'version', c.demo_version,
      'audioPath', d.audio_storage_path, 'videoPath', d.video_storage_path, 'videoMime', d.video_mime,
      'credits', d.content->>'credits')
  from public.demo_lesson_copies c join public.demo_lessons d on d.id = c.demo_lesson_id
  where c.user_id = p_user_id and c.material_id = p_material_id
$$;

-- ---------------------------------------------------------------------------------------------
-- Storage: at most 40 objects per account in the audio bucket (uploads bypass the API with TUS).
-- RESTRICTIVE, so it narrows the existing owner policies and never widens them.
-- ---------------------------------------------------------------------------------------------
do $storage$
begin
  if to_regclass('storage.objects') is not null and exists (
      select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id') then
    execute $p$create policy public_testing_audio_object_cap on storage.objects as restrictive for insert to authenticated
      with check (bucket_id <> 'audios' or (select count(*) from storage.objects o
        where o.bucket_id = 'audios' and o.owner_id = (select auth.uid())::text) < 40)$p$;
  end if;
end
$storage$;

-- ---------------------------------------------------------------------------------------------
-- Grants: server only
-- ---------------------------------------------------------------------------------------------
revoke all on table public.app_admins, public.public_testing_config, public.demo_access_grants,
  public.usage_ledger, public.demo_lessons, public.demo_lesson_copies from public, anon, authenticated;
grant select, insert, update, delete on table public.app_admins, public.public_testing_config,
  public.demo_access_grants, public.usage_ledger, public.demo_lessons, public.demo_lesson_copies to service_role;
revoke all on function public.testing_account_created_at(uuid) from public, anon, authenticated;
grant execute on function public.testing_account_created_at(uuid) to service_role;
revoke all on function
  public.testing_is_admin(uuid), public.testing_policy(uuid), public.testing_demo_access_admin(uuid),
  public.testing_kind_cost(public.public_testing_config, text, text),
  public.testing_llm_load(public.public_testing_config, text, timestamptz),
  public.testing_reserve_admin(uuid, text, text, integer, uuid), public.testing_release_admin(uuid, text, text),
  public.testing_commit_admin(uuid, text, text), public.testing_usage_admin(uuid), public.testing_overview_admin(),
  public.demo_lessons_list_admin(uuid), public.demo_lesson_materialize_admin(uuid, uuid),
  public.demo_copy_of_admin(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.testing_is_admin(uuid), public.testing_policy(uuid), public.testing_demo_access_admin(uuid),
  public.testing_kind_cost(public.public_testing_config, text, text),
  public.testing_llm_load(public.public_testing_config, text, timestamptz),
  public.testing_reserve_admin(uuid, text, text, integer, uuid), public.testing_release_admin(uuid, text, text),
  public.testing_commit_admin(uuid, text, text), public.testing_usage_admin(uuid), public.testing_overview_admin(),
  public.demo_lessons_list_admin(uuid), public.demo_lesson_materialize_admin(uuid, uuid),
  public.demo_copy_of_admin(uuid, uuid)
  to service_role;

commit;
