# Rollback — Arquivo com estados (`20261124090000_discovery_archive.sql`)

Esta migration só troca a função de leitura `public.discovery_list_admin(uuid)`. Não há dados a
exportar: nenhuma tabela, linha, gatilho ou regra de desbloqueio muda.

## 1. Sem tocar no banco

O frontend funciona sem os campos novos: os cartões do Arquivo calculam o estado com as contagens
antigas (evidências, conexões, revisitas, selos) e não desenham os fios entre cartões. A página de
cada descoberta continua completa. Desligar `FEATURE_DISCOVERIES` desliga tudo, como antes.

## 2. Voltar à função anterior

Em sessão autorizada. O bloco abaixo é exatamente a definição de `20261123090000_discoveries.sql`
(o teste `backend/tests/discovery-archive-migration.test.js` executa este bloco):

```sql
begin;
set local lock_timeout = '5s';
create or replace function public.discovery_list_admin(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'subject', d.subject_label,
      'materialId', d.material_id, 'lessonTitle', m.title, 'createdAt', d.created_at, 'updatedAt', d.updated_at,
      'version', d.version,
      'evidenceCount', (select count(*) from public.investigation_evidence e where e.investigation_id = d.id and e.removed_at is null),
      'connectionCount', (select count(*) from public.discovery_connections c where c.discovery_a = d.id or c.discovery_b = d.id),
      'revisitCount', (select count(*) from public.discovery_revisits r where r.discovery_id = d.id),
      'stamps', coalesce((select jsonb_agg(u.collectible_id order by u.occurred_at) from public.collection_unlocks u
        where u.user_id = p_user_id and coalesce(u.discovery_id, u.investigation_id) = d.id), '[]'::jsonb))
      order by d.updated_at desc, d.id), '[]'::jsonb)
  from (select * from public.discoveries x where x.user_id = p_user_id order by x.updated_at desc limit 500) d
  join public.materials m on m.id = d.material_id
$$;
revoke all on function public.discovery_list_admin(uuid) from public, anon, authenticated;
grant execute on function public.discovery_list_admin(uuid) to service_role;
commit;
```
