-- Discoveries (3.5, Milestone 6) postflight: READ ONLY. Run after 20261123090000_discoveries.sql;
-- compare with the preflight. Expected: every boolean true, every *_must_be_0 equal to 0.
begin read only;
select
  to_regclass('public.investigations') is not null as has_investigations,
  to_regclass('public.investigation_evidence') is not null as has_evidence,
  to_regclass('public.investigation_links') is not null as has_links,
  to_regclass('public.discoveries') is not null as has_discoveries,
  to_regclass('public.discovery_versions') is not null as has_versions,
  to_regclass('public.discovery_reflections') is not null as has_reflections,
  to_regclass('public.discovery_connections') is not null as has_connections,
  to_regclass('public.discovery_revisits') is not null as has_revisits,
  to_regclass('public.collection_unlocks') is not null as has_unlocks,
  to_regclass('public.desk_layouts') is not null as has_layouts,
  to_regprocedure('public.investigation_add_evidence_admin(uuid,uuid,uuid,jsonb)') is not null as has_evidence_fn,
  to_regprocedure('public.investigation_complete_admin(uuid,uuid,uuid)') is not null as has_complete_fn,
  to_regprocedure('public.collection_get_admin(uuid)') is not null as has_collection_fn,
  to_regprocedure('public.desk_layout_save_admin(uuid,integer,uuid,jsonb)') is not null as has_layout_fn;
-- Server only: RLS on and nothing visible or executable for browsers.
select c.relname,
  c.relrowsecurity as rls_enabled,
  not has_table_privilege('authenticated', c.oid, 'select') as hidden_from_browser,
  not has_table_privilege('anon', c.oid, 'select') as hidden_from_anon,
  not has_table_privilege('service_role', c.oid, 'update') or c.relname <> 'collection_unlocks' as unlocks_not_updatable
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('investigations', 'investigation_evidence', 'investigation_links',
  'discoveries', 'discovery_versions', 'discovery_reflections', 'discovery_connections', 'discovery_revisits',
  'collection_unlocks', 'desk_layouts')
order by c.relname;
select p.proname,
  not has_function_privilege('authenticated', p.oid, 'execute') as server_only,
  not has_function_privilege('anon', p.oid, 'execute') as hidden_from_anon,
  p.prosecdef = false as security_invoker,
  coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%' as fixed_search_path
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (p.proname like 'investigation\_%' or p.proname like 'discovery\_%'
  or p.proname like 'collection\_%' or p.proname like 'desk\_%')
order by p.proname;
-- The award trigger function cannot be called by the server role.
select not has_function_privilege('service_role', 'public.collection_award()', 'execute') as award_not_callable;
-- Same counts as the preflight; the new tables start empty.
select
  (select count(*) from public.materials) as materials,
  (select count(*) from public.transcription_confirmations) as confirmations,
  (select count(*) from public.study_annotations) as annotations,
  (select count(*) from public.investigations) as investigations_must_be_0,
  (select count(*) from public.collection_unlocks) as unlocks_must_be_0;
rollback;
