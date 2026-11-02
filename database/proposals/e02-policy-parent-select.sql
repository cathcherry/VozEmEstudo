-- PROPOSAL ONLY. Not a migration; never applied automatically.
-- Requires review of the actual staging grants and explicit security authorization.
-- Do not apply if authenticated already has SELECT, or if the owner policy differs.
begin;
do $$ begin
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='materials' and c.relrowsecurity) then
    raise exception 'RLS_REVIEW_REQUIRED';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='materials'
    and policyname='materials_select_own' and cmd='SELECT') then
    raise exception 'OWNER_POLICY_REVIEW_REQUIRED';
  end if;
  if has_table_privilege('authenticated','public.materials','select') then
    raise exception 'PARENT_SELECT_ALREADY_AVAILABLE';
  end if;
end $$;
-- New E02 policies query this parent table under the authenticated role.
-- The existing owner SELECT policy continues to filter rows; anon gets no new grant.
grant select on public.materials to authenticated;
commit;
-- Rollback after an approved trial: REVOKE SELECT ON public.materials FROM authenticated;
-- Restore exactly the recorded prior grants; do not use the rollback if SELECT predated the trial.
