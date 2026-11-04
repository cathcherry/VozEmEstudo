-- E13 preflight: SOMENTE LEITURA. Nao mostra dados pessoais.
begin read only;
select current_database() as database_name,
       current_setting('server_version') as postgres_version;
select
  to_regclass('public.materials') is not null as has_materials,
  to_regclass('public.study_tasks') is not null as has_e05_planning,
  to_regclass('public.study_flashcards') is not null as e13_flashcards_exist,
  to_regclass('public.study_flashcard_reviews') is not null as e13_reviews_exist,
  to_regprocedure('public.study_review_flashcard_admin(uuid,uuid,integer,uuid)') is not null
    as e13_rpc_exists,
  to_regprocedure('public.set_updated_at()') is not null as timestamp_trigger_available;
select conname from pg_constraint
where conrelid = 'public.materials'::regclass
  and conname = 'materials_id_user_planning_unique';
select
  (select count(*) from public.materials) as materials,
  (select count(*) from public.study_tasks) as study_tasks;
rollback;
