-- Study authoring postflight: READ ONLY. Compare counts with the preflight output.
begin read only;
select
  to_regclass('public.question_list_shares') is not null as has_list_shares,
  to_regprocedure('public.commit_question_list_admin(uuid,uuid,integer,jsonb,text,text,text,jsonb,jsonb,text)') is not null as has_list_commit,
  to_regprocedure('public.enqueue_question_list_admin(uuid,uuid,jsonb,uuid,uuid,text,integer)') is not null as has_list_enqueue,
  to_regprocedure('public.commit_named_summary_admin(uuid,uuid,text,text,text,text,jsonb,text)') is not null as has_named_summary,
  (select relrowsecurity from pg_class where oid = 'public.question_list_shares'::regclass) as shares_rls_enabled,
  not has_table_privilege('authenticated', 'public.question_list_shares', 'select') as shares_hidden_from_browser,
  not has_function_privilege('authenticated', 'public.resolve_question_list_share_admin(text)', 'execute') as resolve_server_only;
select
  (select count(*) from public.materials) as materials,
  (select count(*) from public.summary_versions) as summaries,
  (select count(*) from public.summary_versions where label is not null or options <> '{}'::jsonb) as named_summaries,
  (select count(*) from public.question_batches) as question_batches,
  (select count(*) from public.questions) as questions,
  (select count(*) from public.questions where format <> 'single_choice') as unexpected_formats;
select
  to_regclass('public.study_flashcard_sets') is not null as has_flashcard_sets,
  (select relrowsecurity from pg_class where oid = to_regclass('public.study_flashcard_sets')) as sets_rls_enabled;
rollback;
