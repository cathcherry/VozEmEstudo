-- E05/E06: SOMENTE LEITURA apos migration autorizada e backup confirmado.
begin read only;

select
 (select count(*) from public.materials) as material_count,
 (select count(*) from public.transcriptions) as transcription_count,
 (select count(*) from public.summary_versions) as summary_count,
 (select count(*) from public.question_batches) as question_batch_count,
 (select count(*) from public.study_goals) as goal_count,
 (select count(*) from public.study_tasks) as task_count;

select count(*) as cross_account_goal_links
from public.study_tasks t join public.study_goals g on g.id = t.goal_id
where t.user_id <> g.user_id;

select count(*) as cross_account_material_links
from public.study_tasks t join public.materials m on m.id = t.material_id
where t.user_id <> m.user_id;

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relname in ('study_goals','study_tasks')
order by c.relname;

select
  has_table_privilege('anon','public.study_goals','SELECT') as anon_goals_read,
  has_table_privilege('authenticated','public.study_goals','SELECT') as authenticated_goals_read,
  has_table_privilege('anon','public.study_tasks','SELECT') as anon_tasks_read,
  has_table_privilege('authenticated','public.study_tasks','SELECT') as authenticated_tasks_read,
  (has_table_privilege('service_role','public.study_goals','SELECT')
    and has_table_privilege('service_role','public.study_goals','INSERT')
    and has_table_privilege('service_role','public.study_goals','UPDATE')
    and has_table_privilege('service_role','public.study_goals','DELETE')) as service_goals_crud,
  (has_table_privilege('service_role','public.study_tasks','SELECT')
    and has_table_privilege('service_role','public.study_tasks','INSERT')
    and has_table_privilege('service_role','public.study_tasks','UPDATE')
    and has_table_privilege('service_role','public.study_tasks','DELETE')) as service_tasks_crud;

rollback;
