-- Read-only inventory; no transcript text, user identifiers or credentials.
begin read only;
select current_setting('server_version') as postgres_version;
select table_name, column_name, data_type, is_nullable
from information_schema.columns where table_schema = 'public'
  and table_name in ('materials','audio_files','transcriptions','transcription_segments',
    'transcription_versions','summary_versions','question_batches','questions',
    'processing_jobs','processing_job_events','material_permissions','transcription_confirmations','content_warnings')
order by table_name, ordinal_position;
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' order by c.relname;
select tablename,policyname,roles,cmd from pg_policies where schemaname='public' order by tablename,policyname;
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer, md5(pg_get_functiondef(p.oid)) as definition_hash
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('apply_transcription_edits_admin','restore_transcription_revision_admin','claim_next_processing_job')
order by p.proname;
select (select count(*) from public.materials) as materials,
 (select count(*) from public.audio_files) as audio_files,
 (select count(*) from public.transcriptions) as transcriptions,
 (select count(*) from public.transcription_segments) as transcription_segments,
 (select count(*) from public.transcription_versions) as transcription_versions,
 (select count(*) from public.summary_versions) as summary_versions,
 (select count(*) from public.question_batches) as question_batches,
 (select count(*) from public.questions) as questions,
 (select count(*) from public.processing_jobs) as processing_jobs,
 (select count(*) from public.processing_job_events) as processing_job_events;
select count(*) as transcripts_missing_current_snapshot from public.transcriptions t
where not exists(select 1 from public.transcription_versions v where v.transcription_id=t.id and v.revision=t.current_revision);
select count(*) as duplicated_audio_groups from (select material_id from public.audio_files group by material_id having count(*)>1) s;
select count(*) as duplicated_revision_groups from (select transcription_id,revision from public.transcription_versions group by transcription_id,revision having count(*)>1) s;
select status,type,count(*) from public.processing_jobs group by status,type order by status,type;
rollback;
