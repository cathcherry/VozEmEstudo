-- Material integrado: questões tentáveis e conjunto de flashcards — preflight (somente leitura).
-- Esperado: prerequisites = true; already_applied = false. Anote batches_before, sets_before e
-- jobs_before para comparar no postflight.
select
  to_regclass('public.multi_lesson_materials') is not null
    and to_regprocedure('public.multi_lesson_get_admin(uuid,uuid)') is not null
    and to_regprocedure('public.commit_question_list_admin(uuid,uuid,integer,jsonb,text,text,text,jsonb,jsonb,text)') is not null
    and to_regprocedure('public.study_create_flashcard_deck_admin(uuid,uuid,jsonb)') is not null
    and to_regprocedure('public.current_permission_version()') is not null
    and to_regclass('public.processing_jobs') is not null as prerequisites,
  to_regclass('public.multi_lesson_exports') is not null as already_applied,
  (select count(*) from public.question_batches) as batches_before,
  (select count(*) from public.study_flashcard_sets) as sets_before,
  (select count(*) from public.processing_jobs) as jobs_before;
