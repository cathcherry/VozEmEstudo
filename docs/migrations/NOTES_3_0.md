# Migration Notes 3.0 — `20261121130000_notes_3_0.sql`

Milestone A do plano diretor (§7): destaques e comentários em vários trechos, caderno da aula
privado e salvamento automático confiável. **Aprovada pela responsável.**

Onde foi aplicada (21/11): PGlite nos testes, Postgres 16.15 local (cadeia completa, com concorrência real) e staging Supabase `voz-em-estudo-staging` (arquivo idêntico ao do commit `cbec226`, MD5 conferido; postflight ok). **Não foi aplicada em produção (`audioestudo`).** Detalhes em `docs/OVERNIGHT_PROGRESS.md`, seção 3.3.

## Dependências e ordem

1. E02 (`20261009101846_academic_review.sql`): `transcription_versions`, `transcription_confirmations`.
2. E03 (`20261104190000_catalog_units.sql`): unique `materials(id, user_id)`.
3. E14 (`20261105014000_annotations.sql`): `study_annotations` e as funções E14.
4. Aplicar **depois** de `20261120120000_profile_state_hardening.sql` (última migration aplicada).

O guard aborta com `NOTES_3_0_ABORT` se faltar algum pré-requisito ou se a migration já tiver
sido aplicada. Tudo roda numa transação (`begin … commit`), com `lock_timeout` de 5 s.

## O que muda (só acréscimos)

| Objeto | O quê |
| --- | --- |
| `study_annotations.end_segment_position` | Trecho onde o destaque termina (`end_offset` passa a ser lido dentro dele). Checagem: `segment_position ≤ fim ≤ segment_position + 49`. |
| `study_annotations.anchor_version` | `1` = gravado pela API E14 (um trecho); `2` = modelo de intervalo. |
| `study_annotations.visibility` | `'private'`, com constraint que só aceita `private`. |
| Trigger `study_annotations_fill_end_segment` | Linhas inseridas pela função E14 recebem `end_segment_position = segment_position`. |
| `study_save_annotation_range_admin(...)` | Nova função de gravação: âncora em até 50 trechos; citação conferida contra o `segments_snapshot`; destaque exige revisão confirmada pela conta; idempotência e versão como no E14. |
| Tabela `study_notebooks` | Um caderno por aula e conta (`unique(user_id, material_id)`), `doc jsonb` (blocos), `version`, `last_request_id`, `last_body_hash`, `visibility='private'`, `scope='material'`. FK para `materials(id,user_id)` com `on delete cascade`. |
| `study_get_notebook_admin(user, material)` | Caderno + destaques citados (inclusive excluídos) + revisão atual da aula. |
| `study_save_notebook_admin(user, material, version, request, body)` | Criação (versão 0) ou substituição com concorrência otimista; replay pelo mesmo `requestId`; valida forma, tipos de bloco, ausência de HTML, tamanho (≤ 300 blocos, ≤ 256 kB) e referências (dono, aula e revisão). |

Segurança: RLS ligada em `study_notebooks`; `revoke all` de `public, anon, authenticated`;
`grant` só para `service_role`; funções `security invoker`, `search_path=''`, executáveis só pelo
servidor. A política `select` própria só teria efeito se algum ambiente concedesse `SELECT` ao
navegador (esta migration não concede).

Nada é removido nem substituído: `study_save_annotation_admin` e `study_list_annotations_admin`
continuam iguais.

## Transformação dos dados existentes

Todo destaque existente é de um trecho só. O backfill explícito faz
`end_segment_position = segment_position` (somente onde `segment_position` não é nulo). Notas sem
âncora continuam com `null`. Nenhuma outra coluna existente é alterada (nem `updated_at`,
`version` ou `last_request_id`). Testado em `backend/tests/notes-3-0-migration.test.js` com linhas
criadas **antes** da migration pela função E14 (destaque, nota solta, destaque excluído): todas as
colunas antigas ficam idênticas, o backfill confere, e a API E14 continua editando e criando
linhas depois.

## Implantação

1. Backup restaurável conferido.
2. `database/checks/notes-3-0-preflight.sql` (somente leitura): pré-requisitos `true`, estruturas
   novas ausentes; guarde as contagens.
3. Aplicar a migration (sessão autorizada, ambiente correto).
4. `database/checks/notes-3-0-postflight.sql` (somente leitura): objetos presentes, RLS, nada
   exposto ao navegador, mesmas contagens, `legacy_rows_not_backfilled_must_be_0 = 0`,
   nada compartilhado.
5. Ligar `FEATURE_NOTEBOOKS=true` (exige `FEATURE_ANNOTATIONS=true`; o readiness acusa a
   combinação inválida e confere `study_notebooks` e as colunas novas).
6. Validação manual com contas reais (pendente): destacar dois trechos, comentar, citar no
   caderno, editar em dois aparelhos, conferir o conflito.

Com a flag ligada e a migration ausente, `/api/notebooks` responde `503 NOTEBOOK_SCHEMA_REQUIRED`
e `/api/annotations` responde `503 LEARNING_SCHEMA_REQUIRED`; o resto do app continua funcionando.

## Rollback

`database/rollback/notes-3-0-rollback.md`: primeiro desligar a flag (não destrutivo); só depois de
exportar cadernos e destaques em vários trechos remover os objetos novos. Reverter o schema não
restaura dados. O bloco SQL do rollback é executado no teste de migration.

## Compartilhamento (Milestone E — não implementado)

Cadernos e anotações são privados. O caminho previsto: uma tabela própria
(`study_note_shares`, por item, com destino — turma — e revogação) e uma migration que relaxe
explicitamente `study_notebooks_visibility_private` / `study_annotations_visibility_private`.
Compartilhar um caderno nunca incluirá comentários privados não selecionados.

## Limites conhecidos

- Sem medição em Postgres/Supabase real; concorrência testada em PGlite (uma conexão: as duas
  gravações são serializadas; no Postgres real a serialização vem do `for update` no material).
- O botão “Sincronizar agora” da página da conta não envia cadernos; a cópia pendente é enviada ao
  abrir a aula de novo (ela aparece como pendente e não é apagada sem aviso).
