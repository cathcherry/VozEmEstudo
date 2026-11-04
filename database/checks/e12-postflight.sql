-- E12 postflight: somente leitura, comparar totais anteriores.
begin read only;
select (select count(*) from public.quiz_sessions) as sessions,
  (select count(*) from public.quiz_session_answers) as answers,
  (select count(*) from public.questions) as questions,
  (select count(*) from public.quiz_session_items) as review_items;
select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='quiz_session_items';
select
  has_table_privilege('anon','public.quiz_session_items','SELECT') as anon_can_read_items,
  has_table_privilege('authenticated','public.quiz_session_items','SELECT') as client_can_read_items,
  has_function_privilege('anon','public.quiz_create_review_session_admin(uuid,uuid,text)','EXECUTE') as anon_can_create_review,
  has_function_privilege('authenticated','public.quiz_create_review_session_admin(uuid,uuid,text)','EXECUTE') as client_can_create_review,
  has_function_privilege('service_role','public.quiz_create_review_session_admin(uuid,uuid,text)','EXECUTE') as service_can_create_review;
select count(*) as cross_scope_items
from public.quiz_session_items i join public.quiz_sessions s on s.id=i.session_id
where i.user_id<>s.user_id or i.batch_id<>s.batch_id;
select count(*) as review_items_outside_batch
from public.quiz_session_items i join public.questions q on q.id=i.question_id
where i.batch_id<>q.batch_id;
rollback;
