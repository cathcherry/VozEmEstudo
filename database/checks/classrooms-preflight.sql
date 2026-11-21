-- Private classrooms preflight: READ ONLY. Shows no personal data.
-- Run before 20261121140000_classrooms.sql. Every "has_" column must be true and
-- "classrooms_already_applied" false; otherwise the migration refuses to run.
begin read only;
select current_database() as database_name, current_setting('server_version') as postgres_version;
select
  to_regclass('public.materials') is not null as has_materials,
  to_regclass('public.transcription_versions') is not null as has_revisions,
  to_regclass('public.transcription_confirmations') is not null as has_e02_confirmations,
  to_regprocedure('public.require_material_permission_admin(uuid,uuid,text)') is not null as has_e02_permission_check,
  exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'question_batches' and column_name = 'title') as has_authoring_lists,
  to_regclass('public.study_flashcards') is not null as has_e13_flashcards,
  to_regclass('public.study_flashcard_sets') is not null as has_flashcard_sets,
  to_regclass('public.classrooms') is not null as classrooms_already_applied;
-- Counts to compare after applying: the migration must not change any of them.
select
  (select count(*) from public.materials) as materials,
  (select count(*) from public.transcription_versions) as revisions,
  (select count(*) from public.summary_versions) as summaries,
  (select count(*) from public.question_batches) as question_batches;
rollback;
