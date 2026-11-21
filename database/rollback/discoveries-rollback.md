# Rollback — Descobertas (`20261123090000_discoveries.sql`)

Rollback **não destrutivo primeiro**. Reverter o schema **não restaura dados**: investigações,
descobertas, selos, objetos e a mesa só existem nas estruturas novas.

## 1. Desligar a funcionalidade (sempre o primeiro passo)

1. `FEATURE_DISCOVERIES=false` no backend e reiniciar.
2. Resultado: `/api/investigations`, `/api/discoveries` e `/api/collection` deixam de existir (404).
   O botão “Investigar uma pergunta” some da aula; `investigar.html`, `descobertas.html` e
   `gabinete.html` explicam que o recurso não está ativo.
3. Nada é apagado. As tabelas ficam paradas e podem ser religadas depois, com tudo o que a pessoa
   já tinha (nada expira).

Isto basta para quase todo incidente. Só siga adiante se for preciso remover o schema.

## 2. Exportar antes de remover qualquer objeto

Em sessão autorizada, com backup restaurável conferido. São dados pessoais de estudo
(explicações e reflexões escritas pela pessoa): guarde os arquivos com o mesmo cuidado.

```sql
copy (select * from public.investigations) to stdout with csv header;
copy (select * from public.investigation_evidence) to stdout with csv header;
copy (select * from public.investigation_links) to stdout with csv header;
copy (select * from public.discoveries) to stdout with csv header;
copy (select * from public.discovery_versions) to stdout with csv header;
copy (select * from public.discovery_reflections) to stdout with csv header;
copy (select * from public.discovery_connections) to stdout with csv header;
copy (select * from public.discovery_revisits) to stdout with csv header;
copy (select * from public.collection_unlocks) to stdout with csv header;
copy (select * from public.desk_layouts) to stdout with csv header;
```

## 3. Remover os objetos novos (destrutivo — somente após o passo 2)

```sql
begin;
set local lock_timeout = '5s';
drop function if exists public.desk_layout_save_admin(uuid, integer, uuid, jsonb);
drop function if exists public.collection_get_admin(uuid);
drop function if exists public.discovery_connect_admin(uuid, uuid, uuid, uuid, text);
drop function if exists public.discovery_add_reflection_admin(uuid, uuid, uuid, text);
drop function if exists public.discovery_update_admin(uuid, uuid, integer, uuid, jsonb);
drop function if exists public.discovery_list_admin(uuid);
drop function if exists public.investigation_complete_admin(uuid, uuid, uuid);
drop function if exists public.discovery_get_admin(uuid, uuid);
drop function if exists public.investigation_link_options_admin(uuid, uuid);
drop function if exists public.investigation_link_admin(uuid, uuid, uuid, text, uuid, boolean);
drop function if exists public.investigation_remove_evidence_admin(uuid, uuid, uuid);
drop function if exists public.investigation_add_evidence_admin(uuid, uuid, uuid, jsonb);
drop function if exists public.investigation_save_admin(uuid, uuid, integer, uuid, jsonb);
drop function if exists public.investigation_source_admin(uuid, uuid);
drop function if exists public.investigation_get_admin(uuid, uuid);
drop function if exists public.investigation_links_of(uuid, uuid);
drop function if exists public.discovery_link_target(uuid, text, uuid);
drop function if exists public.collection_new_unlocks(uuid);
-- Tables (their triggers go with them), then the functions the tables' row types and triggers used.
drop table if exists public.desk_layouts;
drop table if exists public.discovery_revisits;
drop table if exists public.discovery_connections;
drop table if exists public.discovery_reflections;
drop table if exists public.discovery_versions;
drop table if exists public.discoveries;
drop table if exists public.investigation_links;
drop function if exists public.investigation_evidence_row(public.investigation_evidence);
drop table if exists public.investigation_evidence;
drop table if exists public.investigations;
drop function if exists public.collection_unlock_row(public.collection_unlocks);
drop table if exists public.collection_unlocks;
drop function if exists public.collection_unlocks_immutable();
drop function if exists public.discovery_record_revisit();
drop function if exists public.collection_award();
drop function if exists public.desk_slots();
drop function if exists public.collection_catalog();
commit;
```

Observações:

- Nenhum objeto existente foi alterado pela migration; remover os novos não afeta aulas,
  transcrições, anotações, cartões ou questões.
- Reaplicar depois de um rollback: o guard aborta se `investigations` ou `collection_unlocks`
  existirem. Remova tudo (após exportar) antes de reaplicar.
- Conferir com `database/checks/discoveries-preflight.sql` (deve voltar ao estado “não aplicado”).
- O bloco SQL acima é executado no teste `backend/tests/discoveries-migration.test.js`.
