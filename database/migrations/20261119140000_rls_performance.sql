-- Performance advisor follow-up. MIGRATION CANDIDATE, NOT APPLIED (left for review).
-- 1. RLS policies from 001_initial call auth.uid() once per row ("auth_rls_initplan"). ALTER POLICY
--    rewrites them to (select auth.uid()), evaluated once per query. Same rule, same roles, same
--    commands: no policy is dropped and nobody gains or loses access.
-- 2. Covering indexes for foreign keys flagged as unindexed ("unindexed_foreign_keys").
-- Every step is skipped when its table/policy/column does not exist, so it runs on any stage of
-- the migration history and can be re-run. CREATE INDEX (not CONCURRENTLY, which cannot run in a
-- transaction) briefly blocks writes on each table; the tables are small today.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $policies$
declare
  v_policy record;
begin
  for v_policy in
    select * from (values
      ('materials', 'materials_select_own', 'using ((select auth.uid()) = user_id)'),
      ('materials', 'materials_update_own',
        'using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)'),
      ('materials', 'materials_delete_own', 'using ((select auth.uid()) = user_id)'),
      ('materials', 'materials_insert_own', 'with check ((select auth.uid()) = user_id)'),
      ('audio_files', 'audio_files_select_own',
        'using (exists (select 1 from public.materials m where m.id = audio_files.material_id and m.user_id = (select auth.uid())))'),
      ('transcriptions', 'transcriptions_select_own',
        'using (exists (select 1 from public.materials m where m.id = transcriptions.material_id and m.user_id = (select auth.uid())))'),
      ('transcription_segments', 'transcription_segments_select_own',
        'using (exists (select 1 from public.transcriptions t join public.materials m on m.id = t.material_id where t.id = transcription_segments.transcription_id and m.user_id = (select auth.uid())))'),
      ('transcription_versions', 'transcription_versions_select_own',
        'using (exists (select 1 from public.transcriptions t join public.materials m on m.id = t.material_id where t.id = transcription_versions.transcription_id and m.user_id = (select auth.uid())))'),
      ('summary_versions', 'summary_versions_select_own',
        'using (exists (select 1 from public.materials m where m.id = summary_versions.material_id and m.user_id = (select auth.uid())))'),
      ('question_batches', 'question_batches_select_own',
        'using (exists (select 1 from public.materials m where m.id = question_batches.material_id and m.user_id = (select auth.uid())))'),
      ('questions', 'questions_select_own',
        'using (exists (select 1 from public.question_batches qb join public.materials m on m.id = qb.material_id where qb.id = questions.batch_id and m.user_id = (select auth.uid())))'),
      ('processing_jobs', 'processing_jobs_select_own',
        'using (exists (select 1 from public.materials m where m.id = processing_jobs.material_id and m.user_id = (select auth.uid())))'),
      ('processing_job_events', 'processing_job_events_select_own',
        'using (exists (select 1 from public.processing_jobs j join public.materials m on m.id = j.material_id where j.id = processing_job_events.job_id and m.user_id = (select auth.uid())))')
    ) as p(table_name, policy_name, clauses)
  loop
    if exists (select 1 from pg_policies where schemaname = 'public'
        and tablename = v_policy.table_name and policyname = v_policy.policy_name) then
      execute format('alter policy %I on public.%I %s', v_policy.policy_name, v_policy.table_name, v_policy.clauses);
    end if;
  end loop;
end
$policies$;

do $indexes$
declare
  v_index record;
begin
  for v_index in
    select * from (values
      ('content_warnings', 'content_warnings_revision_idx', array['revision_id']),
      ('material_permissions', 'material_permissions_user_idx', array['user_id']),
      ('materials', 'materials_subject_owner_idx', array['subject_id', 'user_id']),
      ('materials', 'materials_unit_owner_idx', array['unit_id', 'subject_id', 'user_id']),
      ('processing_jobs', 'processing_jobs_confirmation_idx', array['confirmation_id']),
      ('processing_jobs', 'processing_jobs_source_version_idx', array['source_transcription_version_id']),
      ('question_batches', 'question_batches_source_version_idx', array['source_transcription_version_id']),
      ('summary_versions', 'summary_versions_source_version_idx', array['source_transcription_version_id']),
      ('question_list_shares', 'question_list_shares_batch_idx', array['batch_id']),
      ('question_list_shares', 'question_list_shares_material_idx', array['material_id']),
      ('study_units', 'study_units_subject_owner_idx', array['subject_id', 'user_id']),
      ('study_units', 'study_units_user_idx', array['user_id']),
      ('transcription_confirmations', 'transcription_confirmations_user_idx', array['user_id'])
    ) as i(table_name, index_name, columns)
  loop
    -- Only when the table and every column exist (some belong to later, optional migrations).
    if to_regclass('public.' || v_index.table_name) is not null and (
      select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = v_index.table_name and column_name = any(v_index.columns)
    ) = cardinality(v_index.columns) then
      execute format('create index if not exists %I on public.%I (%s)', v_index.index_name, v_index.table_name,
        (select string_agg(quote_ident(c), ', ') from unnest(v_index.columns) as c));
    end if;
  end loop;
end
$indexes$;
commit;
