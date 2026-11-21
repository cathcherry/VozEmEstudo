-- Material integrado (Marco C) — preflight (somente leitura).
-- Esperado: prerequisites = true; already_applied = false; cache_already_applied = false.
select
  to_regclass('public.transcription_confirmations') is not null
    and to_regclass('public.study_subjects') is not null
    and to_regclass('public.study_units') is not null
    and to_regclass('public.ai_generations') is not null
    and to_regprocedure('public.begin_generation_admin(uuid,text,text,uuid,text,uuid[],text,text,uuid,boolean,integer)') is not null
    and to_regprocedure('public.complete_generation_admin(uuid,jsonb)') is not null
    and to_regprocedure('public.fail_generation_admin(uuid,text)') is not null as prerequisites,
  to_regclass('public.multi_lesson_materials') is not null
    or to_regclass('public.multi_lesson_jobs') is not null as already_applied,
  to_regclass('public.knowledge_maps') is not null as cache_already_applied,
  (select count(*) from public.ai_generations) as generations_before,
  (select count(*) from public.transcription_confirmations) as confirmations_before;
