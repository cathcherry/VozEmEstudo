-- Notes 3.0 preflight: READ ONLY. Run before 20261121130000_notes_3_0.sql and keep the output.
-- Expected: every prerequisite true, every Notes 3.0 structure false/NULL (not applied yet).
begin read only;
select current_database(), current_user, now();
select
  to_regclass('public.study_annotations') is not null as has_e14_annotations,
  to_regprocedure('public.study_save_annotation_admin(uuid,uuid,uuid,integer,uuid,jsonb)') is not null as has_e14_save,
  to_regprocedure('public.study_list_annotations_admin(uuid,uuid,text,integer)') is not null as has_e14_list,
  to_regclass('public.transcription_versions') is not null as has_revisions,
  to_regclass('public.transcription_confirmations') is not null as has_confirmations,
  exists (select 1 from pg_constraint where conrelid = 'public.materials'::regclass and contype = 'u'
    and pg_get_constraintdef(oid) ilike '%(id, user_id)%') as has_material_owner_unique;
select
  to_regclass('public.study_notebooks') as notebooks_must_be_null,
  exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'study_annotations' and column_name = 'end_segment_position') as range_column_must_be_false;
-- Counts to compare with the postflight (content must not change, only the backfilled column).
select
  count(*) as annotations,
  count(*) filter (where segment_position is not null) as anchored_annotations,
  count(*) filter (where deleted_at is not null) as deleted_annotations,
  count(distinct user_id) as annotation_owners
from public.study_annotations;
select count(*) as materials from public.materials;
rollback;
