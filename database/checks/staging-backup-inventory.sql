-- Read-only inventory. Run only against the authorized staging project.
-- Contains catalog metadata and counts; no emails, passwords, tokens or media.
select jsonb_build_object(
  'captured_at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'postgres_version', current_setting('server_version'),
  'transaction_read_only', current_setting('transaction_read_only'),
  'public_tables', (
    select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  ),
  'auth_users', (select count(*) from auth.users),
  'auth_identities', (select count(*) from auth.identities),
  'auth_sessions', (select count(*) from auth.sessions),
  'auth_refresh_tokens', (select count(*) from auth.refresh_tokens),
  'storage_buckets', (select count(*) from storage.buckets),
  'storage_objects', (select count(*) from storage.objects),
  'migration_schema_exists', exists (
    select 1 from pg_namespace where nspname = 'supabase_migrations'
  ),
  'migration_ledger_exists', to_regclass('supabase_migrations.schema_migrations') is not null,
  'extensions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', e.extname, 'version', e.extversion, 'schema', n.nspname
    ) order by e.extname), '[]'::jsonb)
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  ),
  'columns', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'table', c.relname, 'column', a.attname,
      'position', a.attnum, 'type', format_type(a.atttypid, a.atttypmod),
      'not_null', a.attnotnull, 'identity', a.attidentity,
      'generated', a.attgenerated
    ) order by n.nspname, c.relname, a.attnum), '[]'::jsonb)
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'auth', 'storage', 'supabase_migrations')
      and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
  ),
  'relations', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', c.relname, 'kind', c.relkind,
      'owner', pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity,
      'force_rls', c.relforcerowsecurity, 'acl', c.relacl::text
    ) order by n.nspname, c.relname), '[]'::jsonb)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'auth', 'storage', 'supabase_migrations')
      and c.relkind in ('r', 'p', 'S', 'v', 'm')
  ),
  'schema_acl', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'owner', pg_get_userbyid(n.nspowner), 'acl', n.nspacl::text
    ) order by n.nspname), '[]'::jsonb)
    from pg_namespace n
    where n.nspname in ('public', 'auth', 'storage', 'supabase_migrations')
  ),
  'default_acl', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'owner', r.rolname, 'schema', n.nspname,
      'object_type', d.defaclobjtype, 'acl', d.defaclacl::text
    ) order by r.rolname, n.nspname, d.defaclobjtype), '[]'::jsonb)
    from pg_default_acl d join pg_roles r on r.oid = d.defaclrole
    left join pg_namespace n on n.oid = d.defaclnamespace
  ),
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', schemaname, 'table', tablename, 'name', policyname,
      'roles', roles, 'command', cmd, 'permissive', permissive,
      'using', qual, 'with_check', with_check
    ) order by schemaname, tablename, policyname), '[]'::jsonb)
    from pg_policies
    where schemaname in ('public', 'auth', 'storage', 'supabase_migrations')
  ),
  'functions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', p.proname,
      'arguments', pg_get_function_identity_arguments(p.oid),
      'owner', pg_get_userbyid(p.proowner), 'security_definer', p.prosecdef,
      'acl', p.proacl::text, 'definition_hash', md5(pg_get_functiondef(p.oid))
    ) order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'auth', 'storage', 'supabase_migrations')
      and p.prokind in ('f', 'p')
  ),
  'event_triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', e.evtname, 'event', e.evtevent, 'enabled', e.evtenabled,
      'tags', e.evttags, 'function', e.evtfoid::regprocedure::text,
      'owner', pg_get_userbyid(e.evtowner)
    ) order by e.evtname), '[]'::jsonb)
    from pg_event_trigger e
  )
) as backup_inventory;
