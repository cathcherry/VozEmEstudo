-- E05/E06: SOMENTE LEITURA apos migration autorizada e backup confirmado.
begin read only;

select
 (select count(*) from public.materials) as material_count,
 (select count(*) from public.transcriptions) as transcription_count,
 (select count(*) from public.summary_versions) as summary_count,
 (select count(*) from public.question_batches) as question_batch_count,
 (select count(*) from public.study_goals) as goal_count,
 (select count(*) from public.study_subgoals) as subgoal_count,
 (select count(*) from public.study_tasks) as task_count;

-- Checks for new task fields; no data disclosure.
select count(*) as task_rows_without_sort_order
from public.study_tasks where sort_order is null;
select count(*) as unsafe_reference_urls
from public.study_tasks
where reference_url is not null
and (char_length(reference_url) > 2048 or reference_url !~ '^https://[^[:space:]]+

select count(*) as cross_account_goal_links
from public.study_tasks t join public.study_goals g on g.id = t.goal_id
where t.user_id <> g.user_id;

select count(*) as cross_account_subgoal_links
from public.study_tasks t join public.study_subgoals s on s.id = t.subgoal_id
where t.user_id <> s.user_id or t.goal_id <> s.goal_id;

select count(*) as cross_account_material_links
from public.study_tasks t join public.materials m on m.id = t.material_id
where t.user_id <> m.user_id;

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relname in ('study_goals','study_subgoals','study_tasks')
order by c.relname;

select
  has_table_privilege('anon','public.study_goals','SELECT') as anon_goals_read,
  has_table_privilege('authenticated','public.study_goals','SELECT') as authenticated_goals_read,
  has_table_privilege('anon','public.study_subgoals','SELECT') as anon_subgoals_read,
  has_table_privilege('authenticated','public.study_subgoals','SELECT') as authenticated_subgoals_read,
  has_table_privilege('anon','public.study_tasks','SELECT') as anon_tasks_read,
  has_table_privilege('authenticated','public.study_tasks','SELECT') as authenticated_tasks_read,
  (has_table_privilege('service_role','public.study_goals','SELECT')
    and has_table_privilege('service_role','public.study_goals','INSERT')
    and has_table_privilege('service_role','public.study_goals','UPDATE')
    and has_table_privilege('service_role','public.study_goals','DELETE')) as service_goals_crud,
  (has_table_privilege('service_role','public.study_subgoals','SELECT')
    and has_table_privilege('service_role','public.study_subgoals','INSERT')
    and has_table_privilege('service_role','public.study_subgoals','UPDATE')
    and has_table_privilege('service_role','public.study_subgoals','DELETE')) as service_subgoals_crud,
  (has_table_privilege('service_role','public.study_tasks','SELECT')
    and has_table_privilege('service_role','public.study_tasks','INSERT')
    and has_table_privilege('service_role','public.study_tasks','UPDATE')
    and has_table_privilege('service_role','public.study_tasks','DELETE')) as service_tasks_crud;

rollback;
);

select has_function_privilege(
  'anon','public.study_reorder_tasks(uuid,uuid,uuid[])','EXECUTE'
) as anon_can_reorder,
has_function_privilege(
  'authenticated','public.study_reorder_tasks(uuid,uuid,uuid[])','EXECUTE'
) as authenticated_can_reorder,
has_function_privilege(
  'service_role','public.study_reorder_tasks(uuid,uuid,uuid[])','EXECUTE'
) as service_can_reorder;

select count(*) as cross_account_goal_links
from public.study_tasks t join public.study_goals g on g.id = t.goal_id
where t.user_id <> g.user_id;

select count(*) as cross_account_subgoal_links
from public.study_tasks t join public.study_subgoals s on s.id = t.subgoal_id
where t.user_id <> s.user_id or t.goal_id <> s.goal_id;

select count(*) as cross_account_material_links
from public.study_tasks t join public.materials m on m.id = t.material_id
where t.user_id <> m.user_id;

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relname in ('study_goals','study_subgoals','study_tasks')
order by c.relname;

select
  has_table_privilege('anon','public.study_goals','SELECT') as anon_goals_read,
  has_table_privilege('authenticated','public.study_goals','SELECT') as authenticated_goals_read,
  has_table_privilege('anon','public.study_subgoals','SELECT') as anon_subgoals_read,
  has_table_privilege('authenticated','public.study_subgoals','SELECT') as authenticated_subgoals_read,
  has_table_privilege('anon','public.study_tasks','SELECT') as anon_tasks_read,
  has_table_privilege('authenticated','public.study_tasks','SELECT') as authenticated_tasks_read,
  (has_table_privilege('service_role','public.study_goals','SELECT')
    and has_table_privilege('service_role','public.study_goals','INSERT')
    and has_table_privilege('service_role','public.study_goals','UPDATE')
    and has_table_privilege('service_role','public.study_goals','DELETE')) as service_goals_crud,
  (has_table_privilege('service_role','public.study_subgoals','SELECT')
    and has_table_privilege('service_role','public.study_subgoals','INSERT')
    and has_table_privilege('service_role','public.study_subgoals','UPDATE')
    and has_table_privilege('service_role','public.study_subgoals','DELETE')) as service_subgoals_crud,
  (has_table_privilege('service_role','public.study_tasks','SELECT')
    and has_table_privilege('service_role','public.study_tasks','INSERT')
    and has_table_privilege('service_role','public.study_tasks','UPDATE')
    and has_table_privilege('service_role','public.study_tasks','DELETE')) as service_tasks_crud;

rollback;
