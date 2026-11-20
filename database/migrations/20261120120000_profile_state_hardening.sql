-- profile_state hardening (least privilege and abuse limits).
-- CANDIDATE — NOT APPLIED. Apply only with explicit authorization, after
-- database/checks/profile-state-preflight.sql. Additive and idempotent; no data is changed.
--
-- Context: the browser reads and writes its own rows in public.profile_state directly (RLS:
-- user_id = auth.uid()). Supabase's default grants also gave anon/authenticated TRUNCATE,
-- TRIGGER and REFERENCES, which the app never uses (TRUNCATE ignores RLS). Keys and the number
-- of keys per account were unbounded.
begin;
set local lock_timeout = '5s';

do $guard$
begin
  if to_regclass('public.profile_state') is null then
    raise exception 'PROFILE_STATE_ABORT: tabela public.profile_state ausente';
  end if;
  if exists (select 1 from public.profile_state where key !~ '^[a-z0-9][a-z0-9._:-]{0,149}$') then
    raise exception 'PROFILE_STATE_ABORT: há chaves fora do formato; revisar antes';
  end if;
  if exists (select 1 from public.profile_state group by user_id having count(*) > 300) then
    raise exception 'PROFILE_STATE_ABORT: conta com mais de 300 chaves; revisar antes';
  end if;
end
$guard$;

-- Least privilege: the browser needs only SELECT, INSERT and UPDATE on its own rows.
revoke all on table public.profile_state from anon;
revoke truncate, trigger, references, delete on table public.profile_state from authenticated;
grant select, insert, update on table public.profile_state to authenticated;

-- Keys the app writes: preferences, study-history, milestones, profile-blocks, catalog-icons,
-- media-<slot> (slots include folder ids).
alter table public.profile_state drop constraint if exists profile_state_key_format;
alter table public.profile_state
  add constraint profile_state_key_format check (key ~ '^[a-z0-9][a-z0-9._:-]{0,149}$');

-- At most 300 keys per account (largest account had 9 on 2026-11-20).
create or replace function public.profile_state_limit_keys()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if (select count(*) from public.profile_state where user_id = new.user_id) >= 300 then
    raise exception 'PROFILE_STATE_LIMIT' using errcode = 'check_violation';
  end if;
  return new;
end
$function$;
revoke all on function public.profile_state_limit_keys() from public, anon, authenticated;

drop trigger if exists profile_state_limit_keys on public.profile_state;
create trigger profile_state_limit_keys
before insert on public.profile_state
for each row execute function public.profile_state_limit_keys();

commit;
