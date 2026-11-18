-- Profile storage deployed to audioestudo, 2026-11-18.
-- Owner-only state documents; no public profiles or rankings.
create table if not exists public.profile_state (
user_id uuid not null references auth.users(id) on delete cascade,
key text not null check(length(key) between 1 and 150),
data jsonb not null check(octet_length(data::text)<=2000000),
updated_at timestamptz not null default now(),
primary key(user_id,key));
alter table public.profile_state enable row level security;
grant select,insert,update on public.profile_state to authenticated;
create policy profile_state_read on public.profile_state for select to authenticated using ((select auth.uid())=user_id);
create policy profile_state_insert on public.profile_state for insert to authenticated with check ((select auth.uid())=user_id);
create policy profile_state_update on public.profile_state for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('profile-media','profile-media',false,8388608,array['image/png','image/jpeg','image/webp','image/gif']) on conflict(id) do nothing;
create policy profile_media_read on storage.objects for select to authenticated using(bucket_id='profile-media' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy profile_media_insert on storage.objects for insert to authenticated with check(bucket_id='profile-media' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy profile_media_update on storage.objects for update to authenticated using(bucket_id='profile-media' and (storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id='profile-media' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy profile_media_delete on storage.objects for delete to authenticated using(bucket_id='profile-media' and (storage.foldername(name))[1]=(select auth.uid())::text);
notify pgrst,'reload schema';
