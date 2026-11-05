-- E07 / Etapa 6: MP4 original separado do WAV usado pelo ASR. Candidata, nao aplicada.
-- Dependencia: E05 (materials_id_user_planning_unique). Aplicar uma unica vez.
begin;

create table public.material_videos (
  material_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  original_name text not null check (length(original_name) between 1 and 255),
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes between 1 and 104857600),
  duration_ms bigint not null check (duration_ms between 1 and 7200000),
  clip_start_ms bigint not null check (clip_start_ms >= 0),
  clip_end_ms bigint not null,
  created_at timestamptz not null default now(),
  constraint material_videos_owner_fk foreign key(material_id,user_id)
    references public.materials(id,user_id) on delete cascade,
  constraint material_videos_range_check check (clip_end_ms > clip_start_ms and clip_end_ms <= duration_ms),
  constraint material_videos_path_check check
    (storage_path = 'original/' || user_id::text || '/' || material_id::text || '/source.mp4')
);
create index material_videos_user_idx on public.material_videos(user_id);
alter table public.material_videos enable row level security;
revoke all on public.material_videos from public, anon, authenticated;
grant select, insert, delete on public.material_videos to service_role;

-- Deliberately fail if a bucket with this name already exists: inspect its privacy/config first.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('study-videos','study-videos',false,104857600,array['video/mp4']);

create policy study_video_upload_own on storage.objects for insert to authenticated
with check (
  bucket_id = 'study-videos'
  and name ~ '^original/[0-9a-f-]{36}/[0-9a-f-]{36}/source[.]mp4$'
  and (storage.foldername(name))[2] = auth.uid()::text
  and exists (select 1 from public.materials m
    where m.id::text = (storage.foldername(name))[3] and m.user_id = auth.uid())
);
-- No browser UPDATE/DELETE policy: original bytes cannot be replaced after upload.
create policy study_video_read_own on storage.objects for select to authenticated
using (
  bucket_id = 'study-videos'
  and (storage.foldername(name))[2] = auth.uid()::text
  and exists (select 1 from public.materials m
    where m.id::text = (storage.foldername(name))[3] and m.user_id = auth.uid())
);
commit;
