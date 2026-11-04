-- E03 PRE-FLIGHT. SOMENTE LEITURA. Pode executar no Supabase SQL Editor.
-- Nunca copiar nomes de materias, IDs de usuarios ou credenciais para logs.
begin read only;

select current_database() as database_name,
       current_setting('server_version') as postgres_version,
       current_timestamp as checked_at_utc;

select to_regclass('public.materials') is not null as has_materials,
       to_regclass('public.material_permissions') is not null as has_e02_permissions,
       to_regprocedure('public.set_updated_at()') is not null as has_updated_at_function,
       to_regclass('public.study_subjects') is not null as e03_subjects_already_exists,
       to_regclass('public.study_units') is not null as e03_units_already_exists;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'materials'
  and column_name in ('id', 'user_id', 'subject', 'subject_id', 'unit_id')
order by column_name;

-- Inventario anonimo de quantidades antes da migration.
select
  (select count(*) from public.materials) as materials,
  (select count(*) from public.audio_files) as audio_files,
  (select count(*) from public.transcriptions) as transcriptions,
  (select count(*) from public.transcription_versions) as transcription_versions,
  (select count(*) from public.summary_versions) as summaries,
  (select count(*) from public.question_batches) as question_batches,
  (select count(*) from public.questions) as questions,
  (select count(*) from public.processing_jobs) as jobs;

-- Uma unica linha. Abortamos se overlong_labels > 0; NAO truncar titulos.
select
  count(*) filter (where subject is not null and char_length(
    btrim(regexp_replace(subject, '[[:space:]]+', ' ', 'g'))
  ) > 120) as overlong_labels,
  count(*) filter (where subject is null or nullif(
    btrim(regexp_replace(subject, '[[:space:]]+', ' ', 'g')), ''
  ) is null) as materials_without_subject,
  count(distinct (user_id, lower(btrim(regexp_replace(subject, '[[:space:]]+', ' ', 'g')))))
    filter (where nullif(btrim(regexp_replace(subject, '[[:space:]]+', ' ', 'g')), '') is not null)
    as expected_new_subjects
from public.materials;

-- A migration desativa temporariamente somente este trigger de timestamp
-- dentro de uma transacao + lock; bloquear se ele estiver ausente/inativo.
select t.tgname, t.tgenabled = 'O' as active
from pg_trigger t
where t.tgrelid = 'public.materials'::regclass
  and t.tgname = 'materials_set_updated_at';

-- Conferir se os marcadores de controle de revisao E02 existem.
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('materials','material_permissions','transcription_confirmations')
order by c.relname;

rollback;
