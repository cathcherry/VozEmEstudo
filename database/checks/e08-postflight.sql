-- Somente leitura. Contagens legadas devem corresponder ao preflight.
select count(*) as materials_after from public.materials;
select count(*) as transcripts_after from public.transcriptions;
select count(*) as summaries_after from public.summary_versions;
select count(*) as batches_after from public.question_batches;
select relname,relrowsecurity from pg_class where oid in
 ('public.study_settings'::regclass,'public.study_progress'::regclass,'public.study_sessions'::regclass,'public.study_time_credits'::regclass);
select has_table_privilege('authenticated','public.study_progress','SELECT') browser_read,
 has_function_privilege('anon','public.study_tick_session_admin(uuid,uuid,integer,boolean,boolean)','EXECUTE') anon_tick,
 has_function_privilege('service_role','public.study_save_progress_admin(uuid,uuid,integer,uuid,jsonb)','EXECUTE') server_write;
-- Esperado: false,false,true.
select count(*) as foreign_progress from public.study_progress p join public.materials m on m.id=p.material_id where m.user_id<>p.user_id;
select count(*) as foreign_sessions from public.study_sessions s join public.materials m on m.id=s.material_id where m.user_id<>s.user_id;
select user_id,count(*) from public.study_sessions where ended_at is null group by user_id having count(*)>1;
select s.id,s.total_seconds,coalesce(sum(c.seconds),0) as credited_seconds from public.study_sessions s
left join public.study_time_credits c on c.session_id=s.id group by s.id having s.total_seconds<>coalesce(sum(c.seconds),0);
-- Esperado: zero inconsistencias e nenhuma linha nas duas ultimas consultas.
