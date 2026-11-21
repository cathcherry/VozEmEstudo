-- Discoveries (3.5, Milestone 6) preflight: READ ONLY. Run before 20261123090000_discoveries.sql
-- and keep the output. Expected: every prerequisite true, every new structure NULL (not applied).
begin read only;
select current_database(), current_user, now();
select
  to_regclass('public.materials') is not null as has_materials,
  to_regclass('public.transcription_versions') is not null as has_revisions,
  to_regclass('public.transcription_confirmations') is not null as has_e02_confirmations,
  to_regclass('public.study_annotations') is not null as has_e14_annotations,
  exists (select 1 from pg_constraint where conrelid = 'public.materials'::regclass and contype = 'u'
    and pg_get_constraintdef(oid) ilike '%(id, user_id)%') as has_material_owner_unique,
  -- Optional: links to these kinds are refused (409) while their tables are absent.
  to_regclass('public.quiz_session_answers') is not null as optional_quiz_answers,
  to_regclass('public.study_flashcards') is not null as optional_flashcards,
  to_regclass('public.study_notebooks') is not null as optional_notebooks;
select
  to_regclass('public.investigations') as investigations_must_be_null,
  to_regclass('public.investigation_evidence') as evidence_must_be_null,
  to_regclass('public.discoveries') as discoveries_must_be_null,
  to_regclass('public.collection_unlocks') as unlocks_must_be_null,
  to_regclass('public.desk_layouts') as layouts_must_be_null;
-- Counts to compare with the postflight (nothing existing may change).
select
  (select count(*) from public.materials) as materials,
  (select count(*) from public.transcription_confirmations) as confirmations,
  (select count(*) from public.study_annotations) as annotations;
rollback;
