-- Study authoring / Flashcards 2.0 preflight: READ ONLY. Shows no personal data.
-- Run before 20261119120000_study_authoring.sql (needs E02) and 20261119121000_flashcard_sets.sql (needs E13).
begin read only;
select current_database() as database_name, current_setting('server_version') as postgres_version;
select
  to_regclass('public.summary_versions') is not null as has_summaries,
  to_regclass('public.question_batches') is not null as has_question_batches,
  to_regprocedure('public.commit_summary_admin(uuid,uuid,text,text,text)') is not null as has_e02_commit,
  to_regprocedure('public.require_material_permission_admin(uuid,uuid,text)') is not null as has_e02_permission_check,
  to_regprocedure('public.get_generation_source_admin(uuid,uuid)') is not null as has_e02_generation_source,
  exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'question_batches' and column_name = 'processing_job_id') as has_e02_job_link,
  to_regclass('public.study_flashcards') is not null as has_e13_flashcards,
  to_regclass('public.question_list_shares') is not null as authoring_already_applied,
  to_regclass('public.study_flashcard_sets') is not null as flashcard_sets_already_applied;
-- The authoring migration widens this check; any other name must be reviewed manually first.
select conname, pg_get_constraintdef(oid) as definition from pg_constraint
where conrelid = 'public.question_batches'::regclass and contype = 'c'
  and pg_get_constraintdef(oid) ~ 'requested_count';
-- Counts to compare after applying: nothing may be lost or rewritten.
select
  (select count(*) from public.materials) as materials,
  (select count(*) from public.summary_versions) as summaries,
  (select count(*) from public.question_batches) as question_batches,
  (select count(*) from public.questions) as questions;
rollback;
