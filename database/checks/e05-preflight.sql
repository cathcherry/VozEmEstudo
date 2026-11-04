-- E05/E06: SOMENTE LEITURA no SQL Editor. Nao retorna dados pessoais.
begin read only;
select current_database() as database_name, current_setting('server_version') as postgres_version;

select to_regclass('public.materials') is not null as has_materials,
       to_regclass('public.study_subjects') is not null as has_e03_subjects,
       to_regclass('public.study_units') is not null as has_e03_units,
       to_regclass('public.material_permissions') is not null as has_e02_permissions,
       to_regclass('public.study_goals') is not null as goals_already_exist,
       to_regclass('public.study_tasks') is not null as tasks_already_exist,
       to_regprocedure('public.set_updated_at()') is not null as updated_at_function_exists;

select
 (select count(*) from public.materials) as material_count,
 (select count(*) from public.transcriptions) as transcription_count,
 (select count(*) from public.summary_versions) as summary_count,
 (select count(*) from public.question_batches) as question_batch_count,
 (select count(*) from public.study_subjects) as discipline_count,
 (select count(*) from public.study_units) as unit_count;

select conname
from pg_constraint
where conrelid = 'public.materials'::regclass
  and conname = 'materials_id_user_planning_unique';

rollback;
