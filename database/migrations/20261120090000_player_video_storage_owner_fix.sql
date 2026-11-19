-- E07 fix: the original study-videos storage policies read public.materials as the
-- "authenticated" role. In production that role has no SELECT privilege on materials (all reads
-- go through the API), so uploads failed with "permission denied for table materials".
-- Ownership is now checked by a narrow SECURITY DEFINER function that only answers "is this
-- material mine?" — it grants no table access and reveals nothing about other users' materials
-- (another user's id and a non-existent id both return false).
-- Idempotent and additive: safe on databases where E07 is fully, partially or freshly applied.
begin;

create or replace function public.storage_owns_material(p_material_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.materials m
    where m.id::text = p_material_id and m.user_id = auth.uid()
  );
$$;
revoke all on function public.storage_owns_material(text) from public, anon;
grant execute on function public.storage_owns_material(text) to authenticated;

drop policy if exists study_video_upload_own on storage.objects;
drop policy if exists study_video_read_own on storage.objects;

create policy study_video_upload_own on storage.objects for insert to authenticated
with check (
  bucket_id = 'study-videos'
  and name ~ '^original/[0-9a-f-]{36}/[0-9a-f-]{36}/source[.]mp4$'
  and (storage.foldername(name))[2] = auth.uid()::text
  and public.storage_owns_material((storage.foldername(name))[3])
);
-- No browser UPDATE/DELETE policy: original bytes cannot be replaced after upload.
create policy study_video_read_own on storage.objects for select to authenticated
using (
  bucket_id = 'study-videos'
  and (storage.foldername(name))[2] = auth.uid()::text
  and public.storage_owns_material((storage.foldername(name))[3])
);

commit;
