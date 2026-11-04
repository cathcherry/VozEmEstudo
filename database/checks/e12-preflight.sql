-- E12 preflight: somente leitura. Aplicar E10 antes; guardar os totais.
begin read only;
select current_database() as database_name,current_setting('server_version') as postgres_version;
select to_regclass('public.quiz_sessions') is not null as has_e10_sessions,
  to_regclass('public.quiz_session_answers') is not null as has_e10_answers,
  to_regclass('public.quiz_session_items') is not null as e12_items_exist,
  to_regprocedure('public.quiz_submit_answer_admin(uuid,uuid,uuid,integer)') is not null as e10_submit_exists,
  to_regprocedure('public.quiz_finish_session_admin(uuid,uuid)') is not null as e10_finish_exists,
  to_regprocedure('public.quiz_create_review_session_admin(uuid,uuid,text)') is not null as e12_create_exists;
select column_name from information_schema.columns
where table_schema='public' and table_name='quiz_sessions'
and column_name in ('kind','source_session_id');
select (select count(*) from public.quiz_sessions) as sessions,
  (select count(*) from public.quiz_session_answers) as answers,
  (select count(*) from public.questions) as questions;
rollback;
