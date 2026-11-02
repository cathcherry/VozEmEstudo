-- Read-only checks after an explicitly authorized migration.
begin read only;
select public.current_permission_version() as declaration_version;
select (select count(*) from public.materials) as materials,
 (select count(*) from public.audio_files) as audio_files,
 (select count(*) from public.transcriptions) as transcriptions,
 (select count(*) from public.transcription_segments) as transcription_segments,
 (select count(*) from public.transcription_versions) as transcription_versions,
 (select count(*) from public.summary_versions) as summary_versions,
 (select count(*) from public.question_batches) as question_batches,
 (select count(*) from public.questions) as questions,
 (select count(*) from public.processing_jobs) as processing_jobs,
 (select count(*) from public.processing_job_events) as processing_job_events,
 (select count(*) from public.material_permissions) as permissions,
 (select count(*) from public.transcription_confirmations) as confirmations,
 (select count(*) from public.content_warnings) as warnings;
select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('material_permissions','transcription_confirmations','content_warnings');
select grantee,table_name,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name in ('material_permissions','transcription_confirmations','content_warnings')
order by table_name,grantee,privilege_type;
select count(*) as server_rpcs_executable_by_authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('declare_material_permission_admin','confirm_transcription_admin','enqueue_processing_job_admin',
'create_material_with_permission_admin','commit_summary_admin','commit_question_batch_admin','save_content_warnings_admin')
and has_function_privilege('authenticated',p.oid,'execute');
select count(*) as confirmed_wrong_owner_or_material from public.transcription_confirmations c
join public.materials m on m.id=c.material_id join public.transcription_versions v on v.id=c.transcription_version_id
join public.transcriptions t on t.id=v.transcription_id where c.user_id<>m.user_id or t.material_id<>m.id;
select count(*) as incomplete_traced_batches from public.question_batches b where b.processing_job_id is not null
and (b.generated_count<>b.requested_count or (select count(*) from public.questions q where q.batch_id=b.id)<>b.generated_count);
select count(*) as duplicate_current_summary_groups from (select material_id from public.summary_versions where is_current group by material_id having count(*)>1) s;
select count(*) as incomplete_warning_analyses from (select analysis_id from public.content_warnings group by analysis_id having count(*)<>3) s;
rollback;
