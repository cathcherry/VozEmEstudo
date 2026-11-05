-- Somente leitura. Contagens legadas devem corresponder ao preflight.
select count(*) as materials_after from public.materials;
select count(*) as transcripts_after from public.transcriptions;
select count(*) as summaries_after from public.summary_versions;
select count(*) as batches_after from public.question_batches;
select relrowsecurity from pg_class where oid = 'public.material_videos'::regclass;
select has_table_privilege('anon','public.material_videos','SELECT') as anon_read,
  has_table_privilege('authenticated','public.material_videos','INSERT') as browser_write,
  has_table_privilege('service_role','public.material_videos','INSERT') as server_write;
-- Esperado: false, false, true.
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='study-videos';
select count(*) as foreign_links from public.material_videos v join public.materials m on m.id=v.material_id
where v.user_id <> m.user_id;
select policyname,cmd,roles from pg_policies where schemaname='storage' and tablename='objects'
and policyname in ('study_video_upload_own','study_video_read_own');
-- Objetos de uploads interrompidos/sem registro: inspecionar e remover SOMENTE pela API de Storage,
-- depois de confirmar ausencia de envio em andamento; nao apagar diretamente em storage.objects.
select o.name,o.created_at from storage.objects o left join public.material_videos v on v.storage_path=o.name
where o.bucket_id='study-videos' and v.material_id is null and o.created_at < now() - interval '24 hours';
