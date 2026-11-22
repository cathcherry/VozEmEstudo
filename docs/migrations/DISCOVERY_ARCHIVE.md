# Migration Arquivo com estados — `20261124090000_discovery_archive.sql`

Ciclo 3.6, Marco E. **Pequena, aditiva e só de leitura**: troca uma função, nenhuma tabela.
Aplicar depois de `20261123090000_discoveries.sql` (o guard aborta com `DISCOVERY_ARCHIVE_ABORT`
sem ela). Reaplicar é seguro (`create or replace`).

## O que muda

`public.discovery_list_admin(uuid)` (mesma assinatura, `security invoker`, `search_path=''`,
mesmas permissões: só `service_role`) devolve tudo o que devolvia e mais:

| Campo | De onde vem | Uso |
| --- | --- | --- |
| `question` | `investigations.question` | pergunta no cartão |
| `reflectionCount` | `discovery_reflections` | marca "carimbado" |
| `connections` | `discovery_connections` (os dois lados), `[{otherId, acrossSubjects, createdAt}]` | marca "costurado", vista Ligações |
| `firstRevisitAt` | `discovery_revisits` | data da "flor prensada" |

Nenhuma regra de desbloqueio, gatilho ou tabela muda.

## Sem a migration

O frontend continua funcionando: os cartões usam `evidenceCount`, `connectionCount`,
`revisitCount` e os selos (o selo "Primeira reflexão" daquela descoberta conta como reflexão) e a
vista Ligações pede para abrir a descoberta. A página de cada descoberta já tinha tudo.

## Implantação

1. Backup conferido; sessão autorizada.
2. Aplicar o arquivo.
3. Conferir: `select has_function_privilege('authenticated','public.discovery_list_admin(uuid)','execute')`
   deve ser `false`.

Rollback: `database/rollback/discovery-archive-rollback.md` (recria a definição anterior; o teste
executa o bloco SQL).

## Testes

`backend/tests/discovery-archive-migration.test.js` (PGlite, SQL real): guard, só uma função
trocada, todos os campos antigos iguais, campos novos (reflexões, ligação nos dois cartões com
`acrossSubjects`, revisita pelo gatilho existente), reaplicação idempotente, outra conta vazia,
permissões e rollback.
