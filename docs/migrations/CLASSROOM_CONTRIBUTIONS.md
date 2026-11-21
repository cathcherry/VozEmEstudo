# Contribuições nas turmas e materiais integrados compartilhados — migration `20261122090000_classroom_contributions.sql`

Status: **candidata, não aplicada** em nenhum banco real (staging ou produção). Testada só em
PGlite (`backend/tests/classroom-contributions-*.test.js` e a cadeia completa em
`scripts/tests/all-migrations-pglite.test.mjs`).
Flag: nenhuma nova. Faz parte de `FEATURE_CLASSROOMS`; é um **sub-recurso opcional**: sem a
migration, as turmas continuam funcionando como antes e só as rotas novas respondem
`503 CLASSROOM_CONTRIBUTIONS_SCHEMA_REQUIRED`.

Continua tudo privado aos membros da turma: nada de página pública, descoberta ou biblioteca
aberta. O que um membro oferece só aparece para a turma depois de aprovado (alunos) e some na
hora quando é revogado, quando o autor sai ou é removido.

## O que muda para as pessoas

| Quem              | Antes                                           | Com a migration                                                                                                                                            |
| ----------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aluno             | Compartilhava um conjunto de flashcards na hora | O conjunto vai para a **fila de revisão**; o aluno acompanha o status (aguardando revisão, compartilhado, recusado) e lê o recado ou o motivo do professor |
| Aluno             | —                                               | Pode oferecer um **material integrado pronto** (Marco C) próprio; também passa pela revisão                                                                |
| Professor/monitor | Compartilhava conjuntos próprios na hora        | Continua na hora (conjuntos e materiais integrados próprios)                                                                                               |
| Professor/monitor | —                                               | Fila de revisão em **Envios**: prévia só leitura, aprovar ou recusar com recado opcional                                                                   |
| Todos os membros  | —                                               | Leem os materiais integrados aprovados em **Aulas publicadas → Materiais integrados**, só leitura                                                          |

As gravações dos alunos (`classroom_submissions`) não mudam de esquema: o recado do professor já
existia (`decision_note`, gravado em toda decisão da gestão). A interface agora pede um recado
opcional também ao aprovar para processar e mostra ao aluno a etapa (1 a 5), o que ela significa e
o histórico completo ("Ver andamento").

## Por que uma tabela nova (e não ampliar `classroom_shared_items`)

`classroom_shared_items.item_kind` tem `check (item_kind in ('flashcard_set'))` e a restrição
`classroom_shared_items_ref` exige `flashcard_set_id`. Ampliar isso exigiria `drop constraint`, o
que as migrations aditivas não fazem. Além disso, as funções existentes
(`classroom_list_shared_flashcard_sets_admin` etc.) não podem ser substituídas
(`create or replace` é proibido) e listariam itens pendentes se eles estivessem nessa tabela.

Por isso:

- `classroom_contributions` guarda **o pedido e a decisão** (pendente, aprovado, recusado,
  retirado, revogado), para conjuntos de flashcards e materiais integrados;
- um conjunto **aprovado** ganha também uma linha em `classroom_shared_items` (a mesma que o
  compartilhamento direto cria), então leitura, cópia e "juntar baralhos" continuam iguais;
- materiais integrados vivem só na tabela nova e são lidos só pelas funções novas.

## Dependências e ordem de implantação

A migration recusa rodar (`CLASSROOM_CONTRIBUTIONS_ABORT: faltam pré-requisitos: …`) sem:

| Pré-requisito                                                                                                   | Migration                                   |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `classrooms`, `classroom_members`, `classroom_shared_items`, `classroom_require_admin`, `classroom_member_name` | `20261121140000_classrooms.sql`             |
| `multi_lesson_materials`                                                                                        | `20261121170000_multi_lesson.sql` (Marco C) |
| `study_flashcard_sets`                                                                                          | `20261119121000_flashcard_sets.sql`         |
| `set_updated_at`                                                                                                | `001_initial.sql`                           |

Ordem:

1. Backup do banco e autorização explícita.
2. `database/checks/classroom-contributions-preflight.sql` (somente leitura, só contagens):
   `prerequisites = true` e `already_applied = false`. Guardar as contagens. Se a consulta falhar
   com "relation does not exist", falta um pré-requisito (aplique antes as migrations acima).
3. Aplicar `database/migrations/20261122090000_classroom_contributions.sql` (uma transação;
   `lock_timeout` 5 s). Reaplicar é recusado
   (`CLASSROOM_CONTRIBUTIONS_ABORT: estruturas de contribuições ja existem`).
4. `database/checks/classroom-contributions-postflight.sql` (somente leitura): `applied`,
   `rls_enabled`, `no_browser_access`, `functions_server_only`, `membership_trigger` e
   `shared_item_trigger` iguais a `true`; `shared_items_after`, `integrated_materials_after` e
   `members_after` iguais às contagens do preflight.
5. Nada a ligar: com `FEATURE_CLASSROOMS=true` a API passa a usar as rotas novas. A verificação de
   prontidão (`backend/src/diagnostics/readiness.js`, `optionalSchema.classroom_contributions`)
   consulta `classroom_contributions` e, se faltar, imprime `[AVISO]` **sem bloquear** a
   inicialização. Compartilhar material integrado aparece para quem tem `FEATURE_MULTI_LESSON`.

## Objetos criados

Somente objetos novos. Nenhuma tabela, coluna, restrição, função ou linha existente é alterada.

- Tabela `classroom_contributions`: turma, dono, `item_kind` (`flashcard_set` |
  `integrated_material`), referência ao item (FK com `on delete cascade`: apagar o item apaga a
  contribuição), `status`, `note` (recado de quem oferece, até 1000), `feedback` (recado de quem
  revisa, até 1000), `reviewed_by/role/at`, `shared_item_id`, `ended_at/by`, `last_request_id`.
  Índices únicos impedem dois pedidos abertos (pendente ou aprovado) do mesmo item na turma.
- Gatilho `classroom_contributions_guard` (todas as escritas, até de `service_role`):
  `pending → approved | rejected | withdrawn`, `approved → revoked`; os demais são finais; dono,
  turma e item não mudam.
- Gatilho `classroom_members_end_contributions` em `classroom_members` (novo, só `after update of
status`): ao sair ou ser removido, pendentes viram `withdrawn` e aprovados `revoked`. Entrar de
  novo não traz nada de volta.
- Gatilho `classroom_shared_items_follow_contributions` em `classroom_shared_items` (novo, só
  `after update of revoked_at`): revogar o conjunto pela rota antiga revoga a contribuição.
- Funções (`security invoker`, `search_path = ''`, só `service_role`):
  `classroom_contribute_admin`, `classroom_review_contribution_admin`,
  `classroom_end_contribution_admin`, `classroom_list_contributions_admin`,
  `classroom_get_contribution_admin`, `classroom_list_integrated_materials_admin`,
  `classroom_get_integrated_material_admin`; auxiliares `classroom_contribution_row`,
  `classroom_integrated_content`, `classroom_integrated_citations`,
  `classroom_integrated_sources`.

## Regras de papel

| Ação                                                                          | Professor             | Monitor               | Aluno              | Não membro / ex-membro |
| ----------------------------------------------------------------------------- | --------------------- | --------------------- | ------------------ | ---------------------- |
| Oferecer conjunto ativo **próprio** / material integrado **pronto e próprio** | sim, já aprovado      | sim, já aprovado      | sim, fica pendente | `404`                  |
| Ver a lista de contribuições                                                  | todas                 | todas                 | só as suas         | `404`                  |
| Prévia do conteúdo (`GET /contributions/:id`)                                 | todas                 | todas                 | só as suas         | `404`                  |
| Aprovar / recusar (com recado opcional)                                       | sim (não as próprias) | sim (não as próprias) | `403`              | `404`                  |
| Retirar pendente                                                              | só as próprias        | só as próprias        | só as próprias     | `404`                  |
| Parar de compartilhar / ocultar aprovado                                      | qualquer              | qualquer              | só as suas         | `404`                  |
| Ler materiais integrados aprovados                                            | sim                   | sim                   | sim                | `404`                  |

Turma arquivada: nada novo é oferecido nem revisado (`409 CLASSROOM_ARCHIVED`), mas retirar e
parar de compartilhar continuam possíveis. A conta vem sempre do token.

## Fronteira de privacidade

- Um material integrado é lido só pelo **conteúdo gerado**, reconstruído campo a campo (lista
  permitida, não filtro): seções do resumo (`heading`, `text`), questões (`statement`, `options`,
  `correctIndex`, `explanation`), flashcards (`front`, `back`) e os trechos citados
  (`lessonTitle`, `position`, `quote`), além do título e dos títulos/revisões das aulas de origem.
  **Nunca**: ids de materiais ou revisões do autor, `startMs`, configurações (`settings`, foco),
  relatório da geração, modelo, versões de prompt, transcrições, anotações, progresso ou histórico.
  A interface não cria link para a aula de origem (ela é privada do autor).
- O registro em `multi_lesson_materials` continua privado em todo o resto do app: só o dono o lê
  em `/api/multi-lesson`; compartilhar não dá escrita nem acesso ao registro.
- O id do item privado só é devolvido ao próprio dono (`itemId`).
- Visível = aprovado, item ainda pronto/ativo e autor ainda membro ativo. Revogar, sair, ser
  removido, apagar o registro ou arquivar o conjunto escondem na hora.
- Nenhuma função nova lê `study_progress`, `study_sessions`, `study_time_credits`,
  `study_flashcard_reviews`, `study_annotations`, `study_notebooks`, tentativas de questões ou
  `transcription_segments` (um teste confere o texto da migration).

## API

Ver `docs/API.md` (seção Turmas): `GET/POST /:id/contributions`, `GET/DELETE
/:id/contributions/:cid`, `POST /:id/contributions/:cid/review`, `GET /:id/integrated-materials`,
`GET /:id/integrated-materials/:cid`. `POST /:id/flashcard-sets` usa a fila de revisão quando a
migration existe e volta ao compartilhamento direto quando não existe.

## Rollback

Ver `database/rollback/classroom-contributions-rollback.md`.

## Testes

- `backend/tests/classroom-contributions-migration.test.js` (PGlite): guarda e aditividade,
  pré/pós-checagem, papéis, fila e recado, conteúdo sem campos privados, revogação imediata,
  remoção/saída/reentrada, apagar o registro, sincronização com `classroom_shared_items`, grafo de
  estados imposto ao `service_role`, turma arquivada, RLS e permissões.
- `backend/tests/classroom-contributions-http.test.js`: rotas sobre o mesmo SQL (validação, conta
  do token, papéis, cabeçalhos privados, 404 sem oráculo).
- `backend/tests/classrooms-http.test.js`: sem a migration, `503
CLASSROOM_CONTRIBUTIONS_SCHEMA_REQUIRED` e compartilhamento direto preservado.
- `scripts/tests/readiness.test.mjs`: probe opcional que avisa e não bloqueia.
- `frontend/tests/classrooms-check.cjs`: jornada no navegador com API simulada (fila, recusa com
  motivo, aprovação com recado, leitura do material integrado, links diretos, sem a migration),
  axe, teclado, 390 px.
