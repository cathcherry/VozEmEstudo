-- Apply only to the intended Supabase project after reviewing and backing it up.
-- The existing audio_files record also represents a retained MP4 clip; no new
-- public access or RLS grants are introduced.
begin;
alter table public.audio_files drop constraint if exists audio_files_extension_check;
alter table public.audio_files add constraint audio_files_extension_check
  check (lower(extension) in ('mp3', 'wav', 'm4a', 'mp4'));
update storage.buckets
set allowed_mime_types = case when allowed_mime_types is null then null else
  array(select distinct unnest(allowed_mime_types || array['video/mp4'])) end
where id = 'audios';
commit;
