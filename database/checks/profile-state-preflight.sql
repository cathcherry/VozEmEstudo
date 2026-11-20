-- Read-only check before 20261120120000_profile_state_hardening.sql. Reports shapes and counts only.
begin read only;
select
  (to_regclass('public.profile_state') is not null) as table_exists,
  (select count(*) from public.profile_state where key !~ '^[a-z0-9][a-z0-9._:-]{0,149}$') as keys_out_of_format,
  (select coalesce(max(c), 0) from (select count(*) c from public.profile_state group by user_id) t) as max_keys_per_account,
  (select string_agg(privilege_type, ',' order by privilege_type)
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'profile_state' and grantee = 'authenticated') as authenticated_privileges,
  (select string_agg(policyname, ',' order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'profile_state') as policies;
rollback;
