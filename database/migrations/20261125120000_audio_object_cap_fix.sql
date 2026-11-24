-- Fix: the per-account cap of 40 objects in the `audios` bucket (public testing) was a policy on
-- storage.objects whose check counted storage.objects, which Postgres rejects at insert time with
-- "infinite recursion detected in policy for relation objects" (42P17): every audio upload failed
-- with 503 in production on 24/11/2026 until the policy was dropped (hotfix). The count now runs in
-- a SECURITY DEFINER function owned by postgres (BYPASSRLS on Supabase), outside the exposed API
-- schema, so evaluating the policy no longer re-enters it. Additive and idempotent.
begin;
set local lock_timeout = '5s';

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.audio_object_count_for_current_user()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
  from storage.objects o
  where o.bucket_id = 'audios'
    and o.owner_id = (select auth.uid())::text;
$$;
revoke all on function private.audio_object_count_for_current_user() from public, anon;
grant execute on function private.audio_object_count_for_current_user() to authenticated;

do $storage$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  drop policy if exists public_testing_audio_object_cap on storage.objects;
  execute $p$create policy public_testing_audio_object_cap on storage.objects as restrictive
    for insert to authenticated
    with check (bucket_id <> 'audios' or private.audio_object_count_for_current_user() < 40)$p$;
end
$storage$;

commit;
