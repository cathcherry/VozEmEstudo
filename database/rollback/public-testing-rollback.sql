-- Rollback of 20261125100000_public_testing.sql. Drops only what that migration created.
-- Participants' demo copies are ordinary lessons in public.materials and are NOT deleted here (they
-- keep working while the canonical audio under audios/demo/ exists). Usage history is lost:
-- export public.usage_ledger first if it matters (e.g. `copy (select …) to stdout`).
begin;
set local lock_timeout = '5s';
drop policy if exists public_testing_audio_object_cap on storage.objects;
drop function if exists public.demo_copy_of_admin(uuid, uuid);
drop function if exists public.demo_lesson_materialize_admin(uuid, uuid);
drop function if exists public.demo_lessons_list_admin(uuid);
drop function if exists public.testing_overview_admin();
drop function if exists public.testing_usage_admin(uuid);
drop function if exists public.testing_commit_admin(uuid, text, text);
drop function if exists public.testing_release_admin(uuid, text, text);
drop function if exists public.testing_reserve_admin(uuid, text, text, integer, uuid);
drop function if exists public.testing_llm_load(public.public_testing_config, text, timestamptz);
drop function if exists public.testing_kind_cost(public.public_testing_config, text, text);
drop function if exists public.testing_demo_access_admin(uuid);
drop function if exists public.testing_policy(uuid);
drop function if exists public.testing_account_created_at(uuid);
drop function if exists public.testing_is_admin(uuid);
drop table if exists public.demo_lesson_copies;
drop table if exists public.demo_lessons;
drop table if exists public.usage_ledger;
drop table if exists public.demo_access_grants;
drop table if exists public.public_testing_config;
drop table if exists public.app_admins;
commit;
