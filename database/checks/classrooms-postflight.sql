-- Private classrooms postflight: READ ONLY. Compare the counts with the preflight output.
-- Every column of the first result must be true.
begin read only;
select
  to_regclass('public.classrooms') is not null as has_classrooms,
  to_regprocedure('public.classroom_require_admin(uuid,uuid,text)') is not null as has_permission_check,
  to_regprocedure('public.classroom_submission_transition_actor(text,text)') is not null as has_state_machine,
  (select bool_and(c.relrowsecurity) from pg_class c where c.oid in (
    'public.classrooms'::regclass, 'public.classroom_members'::regclass, 'public.classroom_invites'::regclass,
    'public.classroom_submissions'::regclass, 'public.classroom_submission_events'::regclass,
    'public.classroom_lessons'::regclass, 'public.classroom_shared_items'::regclass,
    'public.classroom_resources'::regclass)) as all_rls_enabled,
  (select bool_and(not has_table_privilege('authenticated', c.oid, 'select')
      and not has_table_privilege('anon', c.oid, 'select'))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'classroom%') as hidden_from_browser,
  (select bool_and(not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'classroom\_%') as functions_server_only;
select
  (select count(*) from public.materials) as materials,
  (select count(*) from public.transcription_versions) as revisions,
  (select count(*) from public.summary_versions) as summaries,
  (select count(*) from public.question_batches) as question_batches,
  (select count(*) from public.classrooms) as classrooms;
rollback;
