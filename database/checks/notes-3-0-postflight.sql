-- Notes 3.0 postflight: READ ONLY. Run after 20261121130000_notes_3_0.sql; compare with the preflight.
begin read only;
select
  to_regclass('public.study_notebooks') is not null as has_notebooks,
  to_regprocedure('public.study_save_annotation_range_admin(uuid,uuid,uuid,integer,uuid,jsonb)') is not null as has_range_save,
  to_regprocedure('public.study_get_notebook_admin(uuid,uuid)') is not null as has_notebook_get,
  to_regprocedure('public.study_save_notebook_admin(uuid,uuid,integer,uuid,jsonb)') is not null as has_notebook_save,
  to_regprocedure('public.study_save_annotation_admin(uuid,uuid,uuid,integer,uuid,jsonb)') is not null as e14_save_kept,
  (select relrowsecurity from pg_class where oid = 'public.study_notebooks'::regclass) as notebooks_rls_enabled,
  not has_table_privilege('authenticated', 'public.study_notebooks', 'select') as notebooks_hidden_from_browser,
  not has_table_privilege('anon', 'public.study_notebooks', 'select') as notebooks_hidden_from_anon,
  not has_function_privilege('authenticated', 'public.study_save_notebook_admin(uuid,uuid,integer,uuid,jsonb)', 'execute') as save_server_only,
  not has_function_privilege('authenticated', 'public.study_save_annotation_range_admin(uuid,uuid,uuid,integer,uuid,jsonb)', 'execute') as range_server_only;
-- Same counts as the preflight; every anchored row backfilled; nothing shared.
select
  count(*) as annotations,
  count(*) filter (where segment_position is not null) as anchored_annotations,
  count(*) filter (where deleted_at is not null) as deleted_annotations,
  count(distinct user_id) as annotation_owners,
  count(*) filter (where segment_position is not null and end_segment_position is distinct from segment_position
    and anchor_version = 1) as legacy_rows_not_backfilled_must_be_0,
  count(*) filter (where visibility <> 'private') as shared_annotations_must_be_0
from public.study_annotations;
select count(*) as notebooks, count(*) filter (where visibility <> 'private') as shared_notebooks_must_be_0
from public.study_notebooks;
rollback;
