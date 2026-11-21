-- Class contributions postflight: READ ONLY. Every boolean must be true; the counts must equal
-- the preflight ones (the migration changes no existing row).
select
  to_regclass('public.classroom_contributions') is not null as applied,
  (select c.relrowsecurity from pg_class c where c.oid = 'public.classroom_contributions'::regclass) as rls_enabled,
  (not has_table_privilege('anon', 'public.classroom_contributions', 'select')
    and not has_table_privilege('authenticated', 'public.classroom_contributions', 'select')) as no_browser_access,
  (select bool_and(not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'classroom\_%') as functions_server_only,
  exists (select 1 from pg_trigger where tgname = 'classroom_members_end_contributions'
    and tgrelid = 'public.classroom_members'::regclass) as membership_trigger,
  exists (select 1 from pg_trigger where tgname = 'classroom_shared_items_follow_contributions'
    and tgrelid = 'public.classroom_shared_items'::regclass) as shared_item_trigger,
  (select count(*) from public.classroom_shared_items) as shared_items_after,
  (select count(*) from public.multi_lesson_materials) as integrated_materials_after,
  (select count(*) from public.classroom_members) as members_after,
  (select count(*) from public.classroom_contributions) as contributions;
