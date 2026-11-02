-- Read-only catalog audit; no UUIDs, tokens, recordings, passwords or signed URLs.
begin read only;
select current_setting('server_version') as postgres_version;
select rolname,rolsuper,rolbypassrls from pg_roles
where rolname in ('anon','authenticated','service_role') order by rolname;
select c.relname as table_name,c.relrowsecurity as rls_enabled,r.role_name,
  has_table_privilege(r.role_name,c.oid,'select') as can_select,
  has_table_privilege(r.role_name,c.oid,'insert') as can_insert,
  has_table_privilege(r.role_name,c.oid,'update') as can_update,
  has_table_privilege(r.role_name,c.oid,'delete') as can_delete,
  has_table_privilege(r.role_name,c.oid,'truncate') as can_truncate,
  has_table_privilege(r.role_name,c.oid,'references') as can_reference,
  has_table_privilege(r.role_name,c.oid,'trigger') as can_create_trigger
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join (values('anon'),('authenticated'),('service_role')) r(role_name)
where n.nspname='public' and c.relkind='r' order by c.relname,r.role_name;
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname in ('public','storage') order by schemaname,tablename,policyname;
select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,p.prosecdef,
  has_function_privilege('anon',p.oid,'execute') as anon_execute,
  has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'execute') as server_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and (p.proname like '%_admin' or p.proname='claim_next_processing_job')
order by p.proname;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='audios';
select e.extname,e.extversion from pg_extension e order by e.extname;
select to_regclass('supabase_migrations.schema_migrations') is not null as migration_ledger_exists;
rollback;
