# Material integrado: questões tentáveis e conjunto de flashcards — `20261121180000_multi_lesson_exports.sql`

**Situação:** versionada no Git. Aplicada só no PGlite dos testes automáticos. **Não aplicada** em
Postgres local, staging ou produção. Não foi validada com provedor de IA real (não chama IA: só
copia o que o material integrado já gerou).

## O que resolve

Até a 3.3, as questões e os flashcards de um material integrado só podiam ser lidos em
`integrado.html`. Agora, num material **pronto**:

- **"Transformar em lista de questões"** cria uma lista de questões comum, respondida pelo fluxo de
  sempre (`responder.html`: tentativa com feedback imediato ou no final, placar, revisão dos erros,
  diagnóstico). A lista aparece também na aba Questões da aula que a guarda.
- **"Salvar como conjunto de flashcards"** cria um conjunto pessoal em Revisar › Conjuntos, com a
  repetição espaçada de sempre. Cada cartão mostra "De: <aula>".

Os dois são idempotentes: o pedido leva um `requestId`, e cada material integrado vira **no máximo
uma** lista e **um** conjunto. Um segundo clique (ou outra aba) devolve o que já existe.

## Decisão: lista ancorada na primeira aula de origem

Uma lista (`question_batches`) pertence a **uma** aula, e o gatilho `question_batches_require_source`
(E02) exige uma tarefa `GERAR_QUESTOES` com fonte congelada e confirmada. Em vez de mudar esse
gatilho (a migration é aditiva), a lista integrada é:

- **ancorada** na primeira aula das fontes congeladas do material (na ordem do material) que ainda
  é do estudante, tem a declaração de permissão atual e uma confirmação (consentimento atual) da
  **revisão congelada** — se a primeira foi excluída, vale a seguinte; se nenhuma serve:
  `MULTI_LESSON_ANCHOR_UNAVAILABLE`;
- registrada por uma tarefa `GERAR_QUESTOES` **já concluída** (`CONCLUIDA`), com
  `params.origin = 'multi_lesson'` e `params.multiLessonId`. Nenhum worker a executa e nada é
  pago de novo;
- gravada pela função de sempre, `commit_question_list_admin` (mesmas validações: 4 alternativas,
  enunciado, quantidade, fonte).

Proveniência:

| Onde | O quê |
| --- | --- |
| `question_batches.title` | "Questões integradas: <título do material>" (ou o título enviado) |
| `question_batches.config.origin` | `{kind: 'multi_lesson', multiLessonId, title, sources:[{materialId, title, revision}]}` |
| `questions.metadata` | `{origin: 'multi_lesson', multiLessonId, citations:[...]}` — as citações de cada questão (aula, revisão, trecho, citação literal) |
| `questions.explanation` | a explicação gerada + "Fontes: <aula>, trecho N; ..." (aparece depois de responder) |
| `study_flashcard_sets.config.origin` | o mesmo objeto de origem |
| `study_flashcards` | `evidence` (citação), `source_segments` (citações), `origin_label` (título da aula) |
| `multi_lesson_exports` | o vínculo material integrado → lista/conjunto |

Consequências conhecidas: a lista aparece na aula âncora (com a etiqueta "revisão anterior" se a
aula foi editada depois). Excluir a aula âncora exclui a lista, como qualquer lista daquela aula;
excluir o conjunto o exclui. Nos dois casos o vínculo fica sem destino e o estudante pode criar de
novo. Excluir o material integrado **não** exclui a lista nem o conjunto (são cópias independentes).

## Objetos

| Objeto | Para quê |
| --- | --- |
| `multi_lesson_exports` | Um registro por (material integrado, tipo): `request_id` (idempotência), `material_id`, `batch_id`, `processing_job_id` (lista) ou `set_id` (conjunto), `item_count`. FKs com `on delete set null` para o destino. |
| `multi_lesson_exports_admin(user, id)` | O que já foi criado a partir de um material. |
| `multi_lesson_export_questions_admin(user, id, request, title)` | Questões → lista. |
| `multi_lesson_export_flashcards_admin(user, id, request, name)` | Flashcards → conjunto (`study_create_flashcard_deck_admin`). |

Regras comuns: só o dono (`p_user_id`; de outra conta → `MULTI_LESSON_NOT_FOUND`), só material
`ready` (`MULTI_LESSON_NOT_READY`), só se houver itens do tipo (`MULTI_LESSON_NOTHING_TO_EXPORT`),
`request_id` reutilizado para outro material ou tipo → `MULTI_LESSON_REQUEST_CONFLICT`. O registro
do material é travado (`for update`), então dois cliques simultâneos criam uma única lista.

Tudo privado à conta: RLS ligado, `revoke all` de `public`, `anon` e `authenticated`, grants só
para `service_role`, funções `security invoker set search_path = ''`.

## Dependências e ordem de implantação

1. `20261121170000_multi_lesson.sql` (e o que ela exige).
2. `20261119120000_study_authoring.sql` (listas nomeadas) e `20261121150000_flashcards_3_0.sql`
   (conjunto pessoal).
3. **`20261121180000_multi_lesson_exports.sql`** — preflight antes
   (`database/checks/multi-lesson-exports-preflight.sql`: `prerequisites = true`,
   `already_applied = false`), postflight depois (`multi-lesson-exports-postflight.sql`: contagens
   iguais, `exports = 0`, `rls_enabled`, `no_browser_access`, `functions_server_only`).
4. Nenhuma flag nova: vale com `FEATURE_MULTI_LESSON=true`. O botão de flashcards aparece só com
   `FEATURE_FLASHCARD_SETS=true` (a rota `POST /:id/flashcard-set` só existe com essa flag).
   O readiness **não** exige esta migration: sem ela, as rotas respondem
   `503 MULTI_LESSON_EXPORTS_SCHEMA_REQUIRED` e a página esconde os botões.

Reversão: `database/rollback/multi-lesson-exports-rollback.md`.

## O que foi validado e onde

| O quê | Onde |
| --- | --- |
| Guarda (pré-requisitos, reaplicação), aditividade, RLS, sem acesso do navegador, preflight/postflight | `backend/tests/multi-lesson-exports-migration.test.js` (PGlite) |
| Lista ancorada na 1ª aula, proveniência, citações, explicação com fontes, tarefa `CONCLUIDA` que nenhum worker pega | idem |
| Respondida por `quiz_sessions` + `quiz_submit_answer_admin` | idem |
| Idempotência (mesmo `requestId`, segundo clique), conflito de `requestId`, só o dono, só `ready` | idem e `multi-lesson-exports-http.test.js` |
| Âncora: revisão congelada após edição; próxima aula quando a 1ª foi excluída; recriar depois de excluída | `multi-lesson-exports-migration.test.js` |
| Conjunto pessoal: cartões com origem, repetido ignorado e informado, recriar depois de excluído, sobrevive à exclusão do material | idem |
| API HTTP (seleção `units`, 409 antes de pronto, lista respondida por `/api/questions/:id/answer`, conjunto, outra conta 404, 400) | `backend/tests/multi-lesson-exports-http.test.js` |
| 503 sem a migration (ou com execução revogada) | `backend/tests/multi-lesson-exports.test.js` |
| Interface (botões, foco, falha temporária, links, várias unidades, 409 `MULTI_LESSON_SOURCES_CHANGED`, 390 px, axe) | `frontend/tests/multi-lesson-check.cjs` (**API simulada**) |

**Não validado:** Postgres 16 real, Supabase real, concorrência real entre conexões (PGlite usa uma
conexão; a trava `for update` no registro é a garantia), a página de tentativa (`quiz_sessions`)
pela API HTTP (o fixture HTTP só espelha as tabelas legadas; a mesma lista é respondida por SQL).
