-- Gerações reutilizáveis — preflight (somente leitura). Esperado: prerequisites = true, already_applied = false.
select
  to_regclass('public.processing_jobs') is not null
    and to_regclass('public.transcription_confirmations') is not null
    and to_regclass('public.classroom_members') is not null
    and to_regclass('public.classroom_lessons') is not null as prerequisites,
  to_regclass('public.ai_generations') is not null as already_applied,
  (select count(*) from public.processing_jobs) as jobs_before;
