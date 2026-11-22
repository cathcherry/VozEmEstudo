-- Journals (3.6, Milestone D: Diário de estudo) postflight: READ ONLY. Run after
-- 20261124090000_journals.sql; compare with the preflight. Expected: every boolean true, every
-- *_must_be_0 equal to 0.
begin read only;
select
  to_regclass('public.journals') is not null as has_journals,
  to_regclass('public.journal_pages') is not null as has_journal_pages,
  to_regprocedure('public.journal_list_admin(uuid)') is not null as has_list_fn,
  to_regprocedure('public.journal_get_admin(uuid,uuid)') is not null as has_get_fn,
  to_regprocedure('public.journal_link_options_admin(uuid)') is not null as has_link_options_fn,
  to_regprocedure('public.journal_save_admin(uuid,uuid,integer,uuid,jsonb)') is not null as has_save_fn,
  to_regprocedure('public.journal_page_save_admin(uuid,uuid,uuid,integer,uuid,jsonb)') is not null as has_page_save_fn;
-- Server only: RLS on and nothing visible or executable for browsers.
select c.relname,
  c.relrowsecurity as rls_enabled,
  not has_table_privilege('authenticated', c.oid, 'select') as hidden_from_browser,
  not has_table_privilege('anon', c.oid, 'select') as hidden_from_anon,
  has_table_privilege('service_role', c.oid, 'insert') as server_can_write
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('journals', 'journal_pages')
order by c.relname;
select p.proname,
  not has_function_privilege('authenticated', p.oid, 'execute') as server_only,
  not has_function_privilege('anon', p.oid, 'execute') as hidden_from_anon,
  p.prosecdef = false as security_invoker,
  coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%' as fixed_search_path
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'journal\_%'
order by p.proname;
-- Same counts as the preflight; the new tables start empty.
select
  (select count(*) from public.materials) as materials,
  (select count(*) from public.journals) as journals_must_be_0,
  (select count(*) from public.journal_pages) as journal_pages_must_be_0;
rollback;
