-- Voz em Estudo 3.6, Milestone E: the Arquivo de Descobertas shows each discovery as a card that
-- changes with the student's own work (reflection, connections, revisits) and draws the existing
-- connections between cards. The list needs a few facts it did not return.
-- Guide: docs/migrations/DISCOVERY_ARCHIVE.md. Rollback: database/rollback/discovery-archive-rollback.md.
--
-- Additive and read only: it replaces ONE read function, public.discovery_list_admin(uuid), with
-- the same signature, the same security (invoker, empty search_path) and the same grants
-- (create or replace keeps them). Every field it returned before is returned unchanged; it adds:
--   question        the investigation's question (text the student wrote)
--   reflectionCount reflections written on the discovery
--   connections     [{otherId, acrossSubjects, createdAt}] of this discovery (both directions)
--   firstRevisitAt  first meaningful revisit (the revisit rules of 20261123090000 are unchanged)
-- No table, row, trigger, unlock rule or grant changes. Requires 20261123090000_discoveries.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $guard$
begin
  if to_regprocedure('public.discovery_list_admin(uuid)') is null
    or to_regclass('public.discovery_reflections') is null
    or to_regclass('public.discovery_connections') is null
    or to_regclass('public.discovery_revisits') is null then
    raise exception 'DISCOVERY_ARCHIVE_ABORT: faltam pré-requisitos: 20261123090000_discoveries.sql';
  end if;
end
$guard$;

create or replace function public.discovery_list_admin(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'subject', d.subject_label,
      'materialId', d.material_id, 'lessonTitle', m.title, 'createdAt', d.created_at, 'updatedAt', d.updated_at,
      'version', d.version,
      'question', i.question,
      'evidenceCount', (select count(*) from public.investigation_evidence e where e.investigation_id = d.id and e.removed_at is null),
      'connectionCount', (select count(*) from public.discovery_connections c where c.discovery_a = d.id or c.discovery_b = d.id),
      'revisitCount', (select count(*) from public.discovery_revisits r where r.discovery_id = d.id),
      'reflectionCount', (select count(*) from public.discovery_reflections f where f.discovery_id = d.id),
      'firstRevisitAt', (select min(r.created_at) from public.discovery_revisits r where r.discovery_id = d.id),
      'connections', coalesce((select jsonb_agg(jsonb_build_object(
          'otherId', o.id,
          'acrossSubjects', d.subject_key is not null and o.subject_key is not null and d.subject_key <> o.subject_key,
          'createdAt', c.created_at) order by c.created_at, o.id)
        from public.discovery_connections c
        join public.discoveries o on o.id = case when c.discovery_a = d.id then c.discovery_b else c.discovery_a end
        where (c.discovery_a = d.id or c.discovery_b = d.id) and o.user_id = p_user_id), '[]'::jsonb),
      'stamps', coalesce((select jsonb_agg(u.collectible_id order by u.occurred_at) from public.collection_unlocks u
        where u.user_id = p_user_id and coalesce(u.discovery_id, u.investigation_id) = d.id), '[]'::jsonb))
      order by d.updated_at desc, d.id), '[]'::jsonb)
  from (select * from public.discoveries x where x.user_id = p_user_id order by x.updated_at desc limit 500) d
  join public.materials m on m.id = d.material_id
  join public.investigations i on i.id = d.investigation_id
$$;

-- Same grants as before (create or replace keeps them); stated again so the file reads alone.
revoke all on function public.discovery_list_admin(uuid) from public, anon, authenticated;
grant execute on function public.discovery_list_admin(uuid) to service_role;
commit;
