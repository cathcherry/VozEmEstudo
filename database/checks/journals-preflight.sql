-- Journals (3.6, Milestone D: Diário de estudo) preflight: READ ONLY. Run before
-- 20261124090000_journals.sql and keep the output. Expected: every prerequisite true, every new
-- structure NULL (not applied).
begin read only;
select current_database(), current_user, now();
select
  to_regclass('public.materials') is not null as has_materials,
  to_regclass('auth.users') is not null as has_auth_users,
  -- Optional: links to discoveries and stamp decorations need the 3.5 discoveries migration;
  -- without it they are refused (409) and everything else works.
  to_regclass('public.discoveries') is not null as optional_discoveries,
  to_regclass('public.collection_unlocks') is not null as optional_collection_unlocks;
select
  to_regclass('public.journals') as journals_must_be_null,
  to_regclass('public.journal_pages') as journal_pages_must_be_null;
-- Counts to compare with the postflight (nothing existing may change).
select (select count(*) from public.materials) as materials;
rollback;
