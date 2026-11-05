begin read only;
select count(*) materials_after from public.materials;
select count(*) transcripts_after from public.transcriptions;
select count(*) summaries_after from public.summary_versions;
select count(*) batches_after from public.question_batches;
select count(*) tasks_after from public.study_tasks;
select relname,relrowsecurity from pg_class where oid in
 ('public.study_annotations'::regclass,'public.study_calendar_events'::regclass,'public.material_shares'::regclass);
select has_table_privilege('authenticated','public.study_annotations','SELECT') browser_notes,
 has_table_privilege('anon','public.material_shares','SELECT') public_shares,
 has_function_privilege('anon','public.study_resolve_share_admin(text)','EXECUTE') public_rpc,
 has_function_privilege('service_role','public.study_resolve_share_admin(text)','EXECUTE') server_rpc;
-- Esperado: false,false,false,true.
select count(*) foreign_note_sources from public.study_annotations n join public.transcription_versions v on v.id=n.source_revision_id
 join public.transcriptions t on t.id=v.transcription_id join public.materials m on m.id=n.material_id
 where t.material_id<>n.material_id or m.user_id<>n.user_id;
select count(*) foreign_calendar_tasks from public.study_calendar_events e join public.study_tasks t on t.id=e.task_id where e.user_id<>t.user_id;
select count(*) foreign_shares from public.material_shares s join public.materials m on m.id=s.material_id where s.user_id<>m.user_id;
rollback;
