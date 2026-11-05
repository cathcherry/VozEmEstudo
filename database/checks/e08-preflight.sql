-- Somente leitura. Registrar projeto/backup e contagens antes de aplicar a candidata E08/E09.
select current_database(),current_user,now();
select conname,pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.materials'::regclass and contype='u';
-- Esperado: UNIQUE(id,user_id), criado na E05.
select to_regclass('public.study_settings'),to_regclass('public.study_progress'),
  to_regclass('public.study_sessions'),to_regclass('public.study_time_credits');
-- Esperado: todos NULL. Se existir algum, parar e conferir aplicacao anterior.
select proname from pg_proc where pronamespace='public'::regnamespace and proname in
 ('study_save_progress_admin','study_start_session_admin','study_tick_session_admin','study_save_settings_admin','study_overview_admin');
select name from pg_timezone_names where name in ('UTC','America/Sao_Paulo');
select count(*) as materials_before from public.materials;
select count(*) as transcripts_before from public.transcriptions;
select count(*) as summaries_before from public.summary_versions;
select count(*) as batches_before from public.question_batches;
