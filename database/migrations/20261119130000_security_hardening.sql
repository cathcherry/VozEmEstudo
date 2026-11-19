-- Security advisor follow-up (2026-11-19). Idempotent; changes privileges/settings only, no data.
-- 1. rls_auto_enable() is the platform's event-trigger function (event trigger "ensure_rls"). It is
--    never called through the API, so anon/authenticated need no EXECUTE on it.
-- 2. set_updated_at() is a plain trigger function; a fixed empty search_path removes the
--    "role mutable search_path" warning (it only calls now(), which lives in pg_catalog).
-- storage_owns_material(text) keeps EXECUTE for authenticated on purpose: the study-videos
-- storage policies call it as that role, and it only answers "is this material mine?".
begin;
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
  if to_regprocedure('public.set_updated_at()') is not null then
    alter function public.set_updated_at() set search_path = '';
  end if;
end
$$;
commit;
