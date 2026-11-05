-- Somente leitura. Conferir projeto, backup e resultados ANTES da candidata E07.
select current_database(), current_user, now();
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.materials'::regclass and contype = 'u';
-- Esperado: materials_id_user_planning_unique UNIQUE (id, user_id).
select to_regclass('public.material_videos') as existing_table;
-- Esperado: NULL e nenhuma linha no bucket abaixo. Se existirem, PARAR e inspecionar.
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'study-videos';
select policyname, cmd, roles from pg_policies where schemaname='storage' and tablename='objects';
-- Politicas permissivas genericas em storage.objects podem ampliar acesso ao novo bucket: revisar.
select count(*) as materials_before from public.materials;
select count(*) as transcripts_before from public.transcriptions;
select count(*) as summaries_before from public.summary_versions;
select count(*) as batches_before from public.question_batches;
