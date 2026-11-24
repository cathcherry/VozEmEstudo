-- Security hardening before the public test (docs/SECURITY_AUDIT_PUBLIC_TESTING.md).
-- MIGRATION CANDIDATE, NOT APPLIED. Additive and idempotent: every step checks that its object
-- exists, so it runs on production, staging or a fresh database and can be re-run.
--
-- 1. storage_owns_material moves out of the exposed API schema. The study-videos storage policies
--    keep calling it as "authenticated", but from a non-exposed schema ("private"), so it is no
--    longer reachable as /rest/v1/rpc/storage_owns_material (advisor 0029). Same rule, same answer.
-- 2. The 13 policies of 001_initial were created "to public": they now apply "to authenticated"
--    only. anon has no table privilege today, so nobody gains or loses access; this keeps it so if
--    a grant is ever added by mistake.
-- 3. anon/authenticated lose TRUNCATE, REFERENCES and TRIGGER on public tables (and on future
--    tables created by postgres). None is used by the app; TRUNCATE ignores RLS.
-- 4. set_updated_at() (a trigger function) is no longer executable by anon/authenticated.
-- No table, row or user data is changed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. Ownership helper outside the API schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.storage_owns_material(p_material_id text)
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
revoke all on function private.storage_owns_material(text) from public, anon;
grant execute on function private.storage_owns_material(text) to authenticated;

do $storage$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  drop policy if exists study_video_upload_own on storage.objects;
  drop policy if exists study_video_read_own on storage.objects;
  create policy study_video_upload_own on storage.objects for insert to authenticated
  with check (
    bucket_id = 'study-videos'
    and name ~ '^original/[0-9a-f-]{36}/[0-9a-f-]{36}/source[.]mp4$'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and private.storage_owns_material((storage.foldername(name))[3])
  );
  -- No browser UPDATE/DELETE policy: original bytes cannot be replaced after upload.
  create policy study_video_read_own on storage.objects for select to authenticated
  using (
    bucket_id = 'study-videos'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and private.storage_owns_material((storage.foldername(name))[3])
  );
end
$storage$;

-- Nothing depends on the public copy any more.
drop function if exists public.storage_owns_material(text);

-- 2. Policies of 001_initial: authenticated only.
do $roles$
declare
  v_policy record;
begin
  for v_policy in
    select p.tablename, p.policyname
    from pg_policies p
    where p.schemaname = 'public'
      and p.roles = array['public']::name[]
      and (p.tablename, p.policyname) in (
        ('materials', 'materials_select_own'),
        ('materials', 'materials_insert_own'),
        ('materials', 'materials_update_own'),
        ('materials', 'materials_delete_own'),
        ('audio_files', 'audio_files_select_own'),
        ('transcriptions', 'transcriptions_select_own'),
        ('transcription_segments', 'transcription_segments_select_own'),
        ('transcription_versions', 'transcription_versions_select_own'),
        ('summary_versions', 'summary_versions_select_own'),
        ('question_batches', 'question_batches_select_own'),
        ('questions', 'questions_select_own'),
        ('processing_jobs', 'processing_jobs_select_own'),
        ('processing_job_events', 'processing_job_events_select_own')
      )
  loop
    execute format('alter policy %I on public.%I to authenticated', v_policy.policyname, v_policy.tablename);
  end loop;
end
$roles$;

-- 3. Unused table privileges of the browser roles.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- 4. Trigger function: firing a trigger needs no EXECUTE privilege.
do $fn$
begin
  if to_regprocedure('public.set_updated_at()') is not null then
    revoke execute on function public.set_updated_at() from public, anon, authenticated;
  end if;
end
$fn$;

commit;
