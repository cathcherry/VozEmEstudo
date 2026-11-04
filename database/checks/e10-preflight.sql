-- E10 preflight somente leitura: comparar totais e verificar E05 antes da aplicacao.
begin read only;
select current_database() as database_name,current_setting('server_version') as postgres_version;
select
 to_regclass('public.study_tasks') is not null as has_e05,
 to_regclass('public.question_batches') is not null as has_batches,
 to_regclass('public.questions') is not null as has_questions,
 to_regclass('public.quiz_sessions') is not null as has_e10_sessions,
 to_regclass('public.quiz_session_answers') is not null as has_e10_answers;
select conname from pg_constraint
where conrelid='public.materials'::regclass and conname='materials_id_user_planning_unique';
select (select count(*) from public.materials) as materials,
 (select count(*) from public.question_batches) as batches,
 (select count(*) from public.questions) as questions;
rollback;
