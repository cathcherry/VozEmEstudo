-- E07 completion for databases where the study-videos bucket and storage policies already exist
-- (created separately; see 20261120090000_player_video_storage_owner_fix.sql) but the
-- material_videos table could not be created because E05's composite key was missing.
-- Applied to the Supabase project "audioestudo" on 2026-11-19 (history name: material_videos_table).
--
-- Idempotent and additive:
-- 1. materials (id, user_id) unique key, under the same name E05 uses. id is already the primary
--    key, so every existing row satisfies it. E05 now skips this step when the key exists.
-- 2. material_videos exactly as defined in 20261105003500_player_video.sql (if it is missing).
-- The bucket and its policies are not touched here.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $key$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.materials'::regclass and conname = 'materials_id_user_planning_unique'
  ) then
    alter table public.materials
      add constraint materials_id_user_planning_unique unique (id, user_id);
  end if;
end
$key$;

create table if not exists public.material_videos (
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
create index if not exists material_videos_user_idx on public.material_videos(user_id);
alter table public.material_videos enable row level security;
revoke all on public.material_videos from public, anon, authenticated;
grant select, insert, delete on public.material_videos to service_role;
commit;
