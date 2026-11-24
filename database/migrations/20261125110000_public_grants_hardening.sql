-- Defense in depth before the public test: Supabase's default grants gave the browser roles (anon,
-- authenticated) TRUNCATE, TRIGGER and REFERENCES on most public tables. The app never uses them,
-- and TRUNCATE ignores RLS. PostgREST and pg_graphql cannot issue TRUNCATE, so this was not
-- reachable through the public API, but no browser role should hold it. profile_state was already
-- hardened this way (20261120120000). Additive and idempotent; SELECT/INSERT/UPDATE/DELETE grants
-- and RLS policies are untouched. Also stops new tables from receiving these privileges.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, trigger, references on table public.%I from anon, authenticated', t.relname);
  end loop;
end
$$;

alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;
