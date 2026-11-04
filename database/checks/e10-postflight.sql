-- E10 postflight somente leitura, comparar totais antigos com preflight.
begin read only;
select (select count(*) from public.materials) as materials,
 (select count(*) from public.question_batches) as batches,
 (select count(*) from public.questions) as questions,
 (select count(*) from public.quiz_sessions) as sessions,
 (select count(*) from public.quiz_session_answers) as answers;
select c.relname,c.relrowsecurity from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('quiz_sessions','quiz_session_answers');
select
 has_table_privilege('anon','public.quiz_sessions','SELECT') as anon_session_select,
 has_table_privilege('authenticated','public.quiz_session_answers','SELECT') as authenticated_answers_select,
 has_function_privilege('anon','public.quiz_submit_answer_admin(uuid,uuid,uuid,integer)','EXECUTE') as anon_answer_rpc,
 has_function_privilege('authenticated','public.quiz_finish_session_admin(uuid,uuid)','EXECUTE') as authenticated_finish_rpc,
 has_function_privilege('service_role','public.quiz_submit_answer_admin(uuid,uuid,uuid,integer)','EXECUTE') as service_answer_rpc,
 has_function_privilege('service_role','public.quiz_finish_session_admin(uuid,uuid)','EXECUTE') as service_finish_rpc;
select count(*) as foreign_material_sessions from public.quiz_sessions s
join public.materials m on m.id=s.material_id where s.user_id<>m.user_id;
select count(*) as wrong_batch_answers from public.quiz_session_answers a
join public.quiz_sessions s on s.id=a.session_id
where a.user_id<>s.user_id or a.batch_id<>s.batch_id;
rollback;
