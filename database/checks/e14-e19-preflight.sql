begin read only;
select current_database(),current_user,now();
select to_regclass('public.study_annotations'),to_regclass('public.study_calendar_events'),to_regclass('public.material_shares');
-- Esperado: NULL nas tres novas estruturas. Conferir E02/E03/E05 e backup restauravel.
select table_name,column_name from information_schema.columns where table_schema='public'
  and ((table_name='study_tasks' and column_name in('sort_order','completed_at','reference_url'))
    or (table_name='summary_versions' and column_name='source_transcription_version_id'));
select conname,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.materials'::regclass and contype='u';
select count(*) materials_before from public.materials;
select count(*) transcripts_before from public.transcriptions;
select count(*) summaries_before from public.summary_versions;
select count(*) batches_before from public.question_batches;
select count(*) tasks_before from public.study_tasks;
rollback;
