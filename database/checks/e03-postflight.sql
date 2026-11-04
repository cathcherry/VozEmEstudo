-- E03 POS-FLIGHT. SOMENTE LEITURA; usar APENAS depois de migration aprovada.
-- Comparar inventario com e03-preflight: todos os totais historicos iguais,
-- exceto por alteracoes de usuarios que ocorreram fora da janela de migration.
begin read only;

select
  (select count(*) from public.materials) as materials,
  (select count(*) from public.audio_files) as audio_files,
  (select count(*) from public.transcriptions) as transcriptions,
  (select count(*) from public.transcription_versions) as transcription_versions,
  (select count(*) from public.summary_versions) as summaries,
  (select count(*) from public.question_batches) as question_batches,
  (select count(*) from public.questions) as questions,
  (select count(*) from public.processing_jobs) as jobs,
  (select count(*) from public.study_subjects) as catalog_subjects,
  (select count(*) from public.study_units) as catalog_units,
  (select count(*) from public.materials where subject_id is not null) as materials_with_subject_id;

-- Todos os materiais com label legado nao vazio devem ter subject_id.
select count(*) as unlinked_existing_labeled_materials
from public.materials m
where nullif(btrim(regexp_replace(m.subject, '[[:space:]]+', ' ', 'g')), '') is not null
  and m.subject_id is null;

-- Devem retornar ZERO linhas/ocorrencias.
select count(*) as material_subject_owner_mismatch
from public.materials m
join public.study_subjects s on s.id = m.subject_id
where m.user_id <> s.user_id;

select count(*) as material_unit_scope_mismatch
from public.materials m
join public.study_units u on u.id = m.unit_id
where m.user_id <> u.user_id or m.subject_id is distinct from u.subject_id;

select count(*) as noncanonical_subjects from public.study_subjects
where normalized_name <> lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')));

select count(*) as noncanonical_units from public.study_units
where normalized_title <> lower(btrim(regexp_replace(title, '[[:space:]]+', ' ', 'g')));

select n.nspname as schema, c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('study_subjects','study_units')
order by c.relname;

select
  has_table_privilege('anon', 'public.study_subjects', 'SELECT') as anon_subject_read,
  has_table_privilege('authenticated', 'public.study_subjects', 'SELECT') as authenticated_subject_read,
  has_table_privilege('anon', 'public.study_units', 'SELECT') as anon_unit_read,
  has_table_privilege('authenticated', 'public.study_units', 'SELECT') as authenticated_unit_read,
  has_table_privilege('service_role', 'public.study_subjects', 'SELECT,INSERT,UPDATE,DELETE') as service_subject_crud,
  has_table_privilege('service_role', 'public.study_units', 'SELECT,INSERT,UPDATE,DELETE') as service_unit_crud;

-- A consulta verifica objetos e grants; NAO substitui teste com contas A/B reais.
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public' and tablename in ('study_subjects','study_units')
order by tablename, policyname;

rollback;
