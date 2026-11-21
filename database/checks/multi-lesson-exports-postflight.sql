-- Material integrado: questões tentáveis e conjunto de flashcards — postflight (somente leitura).
-- Esperado logo após aplicar: batches_after = batches_before; sets_after = sets_before;
-- jobs_after = jobs_before; exports = 0; rls_enabled = true; no_browser_access = true;
-- functions_server_only = true.
select
  (select count(*) from public.question_batches) as batches_after,
  (select count(*) from public.study_flashcard_sets) as sets_after,
  (select count(*) from public.processing_jobs) as jobs_after,
  (select count(*) from public.multi_lesson_exports) as exports,
  (select relrowsecurity from pg_class where oid = 'public.multi_lesson_exports'::regclass) as rls_enabled,
  not has_table_privilege('authenticated', 'public.multi_lesson_exports', 'select')
    and not has_table_privilege('anon', 'public.multi_lesson_exports', 'select') as no_browser_access,
  not has_function_privilege('authenticated', 'public.multi_lesson_export_questions_admin(uuid,uuid,uuid,text)', 'execute')
    and not has_function_privilege('anon', 'public.multi_lesson_export_questions_admin(uuid,uuid,uuid,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.multi_lesson_export_flashcards_admin(uuid,uuid,uuid,text)', 'execute')
    and not has_function_privilege('anon', 'public.multi_lesson_export_flashcards_admin(uuid,uuid,uuid,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.multi_lesson_exports_admin(uuid,uuid)', 'execute') as functions_server_only;
