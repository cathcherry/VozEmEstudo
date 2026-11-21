# Migration Descobertas — `20261123090000_discoveries.sql`

Marco 6 do ciclo 3.5: investigações, Arquivo de Descobertas, Gabinete (colecionáveis) e a mesa.
**Candidata, não aplicada em nenhum ambiente por este repositório. Somente staging até ser
validada.** Ela **não** entra no pacote `database/release/3.4/` (o teste
`scripts/tests/release-manifest.test.mjs` confere isso) e o script
`scripts/release/enable-3-4-features.mjs` mantém `FEATURE_DISCOVERIES=false`.

## Dependências e ordem

1. Base (`001_initial.sql`): `materials`, `transcriptions`, `transcription_versions`.
2. E02 (`20261009101846_academic_review.sql`): `transcription_confirmations`.
3. E03 (`20261104190000_catalog_units.sql`): unique `materials(id, user_id)`.
4. E14 (`20261105014000_annotations.sql`): `study_annotations` (ligações a destaques; a flag exige
   `FEATURE_ANNOTATIONS`).
5. Opcionais: E10 (`quiz_session_answers`), E13 (`study_flashcards`), Notes 3.0
   (`study_notebooks`). Sem elas, ligar esse tipo responde `409 DISCOVERY_LINK_UNAVAILABLE`.
6. Aplicar depois de `20261122090000_classroom_contributions.sql` (última da 3.4).

O guard aborta com `DISCOVERIES_ABORT` se faltar pré-requisito ou se já tiver sido aplicada.
Tudo roda numa transação, com `lock_timeout` de 5 s.

## O que cria (só acréscimos)

| Tabela | Papel |
| --- | --- |
| `investigations` | Pergunta sobre uma aula **da própria conta**, presa à revisão **confirmada** mais recente (`source_revision_id`); explicação, reflexão, `explored_at`, `explained_at`, `status open/completed`, `version`, `last_request_id`, `last_body_hash`. |
| `investigation_evidence` | Citações da revisão da investigação, nas mesmas coordenadas das âncoras do Notes 3.0 (trecho inicial/final, offsets em code points). Remover só marca `removed_at`. Um mesmo intervalo ativo uma vez por investigação; até 30. |
| `investigation_links` | Etapa Aplicar: `question` (respondida pela conta), `flashcard`, `annotation`, `notebook`, **por referência** (`ref_id`); o rótulo é lido ao vivo. |
| `discoveries` | Uma por investigação concluída (mesmo `id`); título, explicação, `subject_key`/`subject_label` (instantâneo da disciplina), `version`. |
| `discovery_versions` | Todas as versões do título e da explicação. |
| `discovery_reflections` | Reflexões ao longo do tempo. |
| `discovery_connections` | Ligação entre duas descobertas da conta (`a < b`, uma por par), com `created_from`. |
| `discovery_revisits` | Revisitas significativas: mudança na descoberta **≥ 1 dia** depois do registro; **uma por descoberta e dia UTC** (chave primária). Gravadas por gatilho. |
| `collection_unlocks` | Desbloqueios: chave `(user_id, collectible_id)`, evento de origem, linha que o comprovou, investigação/descoberta/aula, título da aula (instantâneo), `occurred_at`. Nunca atualizado (gatilho `COLLECTION_IMMUTABLE`), sem FK para as linhas de aprendizagem (sobrevive à exclusão da aula). |
| `desk_layouts` | Objetos colocados na mesa: `[{slot, objectId}]`, até 8, versão. |

Funções `*_admin` (todas `security invoker`, `search_path=''`, executáveis só pelo
`service_role`): `investigation_source_admin`, `investigation_get_admin`,
`investigation_save_admin`, `investigation_add_evidence_admin`,
`investigation_remove_evidence_admin`, `investigation_link_admin`,
`investigation_link_options_admin`, `investigation_complete_admin`, `discovery_get_admin`,
`discovery_list_admin`, `discovery_update_admin`, `discovery_add_reflection_admin`,
`discovery_connect_admin`, `collection_get_admin`, `desk_layout_save_admin`.

Gatilhos: `collection_award()` (concede) e `discovery_record_revisit()` (revisitas) disparam nas
linhas que comprovam o evento. **Nenhuma função concede item**; as funções de gatilho não têm
`EXECUTE` para ninguém.

## Regras (versão 1)

- **Verificação da evidência**: igual a `study_save_annotation_range_admin` — a citação precisa ser
  idêntica ao `segments_snapshot` da revisão entre os offsets (trechos unidos por `\n`); revisão
  ainda confirmada pela conta; senão `DISCOVERY_ANCHOR_CONFLICT` / `DISCOVERY_REVISION_UNCONFIRMED`.
- **Conclusão**: pergunta + ≥ 1 evidência ativa + explicação com ≥ 20 caracteres.
- **Idempotência**: `requestId` + hash do corpo (investigação, descoberta, mesa); id do registro
  (evidência, reflexão, conexão); par único (conexão); `on conflict do nothing` (desbloqueios).
  Conflito de versão → `DISCOVERY_VERSION_CONFLICT`.
- **Desbloqueios**: ver a tabela em `docs/RPG_GAMIFICATION_3_5.md`. Cada um guarda a n-ésima linha
  que o comprovou (ex.: a terceira investigação concluída para `object.magnifying-glass`).

## Segurança e privacidade

RLS ligada nas 10 tabelas; `revoke all` de `public, anon, authenticated`; grants só ao
`service_role` (em `collection_unlocks`, só `select, insert`). Toda função recebe `p_user_id` e
confere a posse; outra conta recebe `DISCOVERY_NOT_FOUND`. Excluir a aula remove investigações e
descobertas dela; os desbloqueios ficam (com o título da aula) até a conta ser excluída.

## Implantação (staging)

1. Backup restaurável conferido.
2. `database/checks/discoveries-preflight.sql` (somente leitura).
3. Aplicar a migration em sessão autorizada.
4. `database/checks/discoveries-postflight.sql`: objetos presentes, RLS, nada exposto ao
   navegador, funções `security invoker` com `search_path`, `award_not_callable = true`, contagens
   iguais.
5. `FEATURE_DISCOVERIES=true` (exige `FEATURE_ANNOTATIONS=true`; o readiness confere as tabelas).
6. Validação manual com contas reais (pendente).

Com a flag ligada e a migration ausente, `/api/investigations`, `/api/discoveries` e
`/api/collection` respondem `503 DISCOVERIES_SCHEMA_REQUIRED`; o resto continua.

## Rollback

`database/rollback/discoveries-rollback.md`: desligar a flag (não destrutivo); só depois de
exportar, remover os objetos novos. O bloco SQL é executado no teste da migration.

## Testes

- `backend/tests/discoveries-migration.test.js` (PGlite, SQL real): guard, aditividade, fonte
  confirmada, idempotência e versões, verificação de evidência (maiúsculas, separador, offsets,
  code points, revisão desconfirmada), conclusão, desbloqueios idempotentes e imutáveis, limiares,
  conexões entre disciplinas, revisitas (dia seguinte, uma por dia), ligações por referência,
  mesa, privacidade entre contas e papéis do navegador, duplicatas concorrentes (serializadas no
  PGlite), preflight/postflight e rollback.
- `backend/tests/discoveries-http.test.js`: a fatia completa pela API, com validação e isolamento.
- `scripts/tests/all-migrations-pglite.test.mjs` aplica todas as migrations juntas.

## Limites conhecidos

- Concorrência real só em PGlite (uma conexão); no Postgres a serialização vem do `for update`
  na aula/investigação/descoberta e da chave primária dos desbloqueios.
- "Dia" das revisitas é UTC.
- A disciplina das conexões é o texto `materials.subject` normalizado (minúsculas, sem espaços nas
  pontas) no momento do registro.
