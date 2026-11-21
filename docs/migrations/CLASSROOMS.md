# Turmas privadas — migration `20261121140000_classrooms.sql`

Status: Onde foi aplicada (21/11): PGlite nos testes, Postgres 16.15 local (cadeia completa, com concorrência real) e staging Supabase `voz-em-estudo-staging` (arquivo idêntico ao do commit `cbec226`, MD5 conferido; postflight ok). **Não foi aplicada em produção (`audioestudo`).** Detalhes em `docs/OVERNIGHT_PROGRESS.md`, seção 3.3.
Flag: `FEATURE_CLASSROOMS` (padrão `false`).

Tudo é privado aos membros da turma. Não existe página pública, descoberta de turmas, biblioteca
indexável nem link que dê acesso sem conta: o link de convite só serve para uma conta entrar, e
cada leitura confere a participação na hora.

## Dependências e ordem de implantação

A migration recusa rodar (`CLASSROOMS_ABORT: faltam pré-requisitos: …`) sem:

| Pré-requisito                                         | Migration                                  |
| ----------------------------------------------------- | ------------------------------------------ |
| `materials`, `transcription_versions`, `set_updated_at` | `001_initial.sql`                          |
| `transcription_confirmations`, `require_material_permission_admin` | `20261009101846_academic_review.sql` (E02) |
| `question_batches.title`                              | `20261119120000_study_authoring.sql`       |
| `study_flashcards`                                    | `20261104234500_flashcards.sql` (E13)      |
| `study_flashcard_sets`                                | `20261119121000_flashcard_sets.sql`        |

Ordem:

1. Backup do banco e autorização explícita.
2. `database/checks/classrooms-preflight.sql` (somente leitura): todas as colunas `has_*` devem
   ser `true` e `classrooms_already_applied`, `false`. Guardar as contagens.
3. Aplicar `database/migrations/20261121140000_classrooms.sql` (uma transação; `lock_timeout` 5 s).
   Reaplicar é recusado (`CLASSROOMS_ABORT: estruturas de turmas ja existem`).
4. `database/checks/classrooms-postflight.sql` (somente leitura): todas as colunas da primeira linha
   `true`; contagens iguais às do preflight.
5. Ligar `FEATURE_FLASHCARDS`, `FEATURE_FLASHCARD_SETS` (se ainda não) e `FEATURE_CLASSROOMS`;
   reiniciar a API. A verificação de prontidão (`backend/src/diagnostics/readiness.js`) consulta as
   tabelas das turmas e recusa `FEATURE_CLASSROOMS` sem `FEATURE_FLASHCARD_SETS`. Com a flag ligada
   e o esquema ausente, `/api/classrooms` responde `503 CLASSROOMS_SCHEMA_REQUIRED` e o resto do
   app segue funcionando.

## Objetos criados

Somente objetos novos; nenhuma tabela, coluna, função ou linha existente é alterada.

| Tabela                        | Conteúdo                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `classrooms`                  | Turma: dono (professor), nome, descrição, `active`/`archived`                                                                      |
| `classroom_members`           | `(classroom_id, user_id)`, papel `teacher`/`assistant`/`student`, situação `active`/`left`/`removed`, nome de exibição escolhido    |
| `classroom_invites`           | `token_hash` (SHA-256, único), `max_uses` 1–500, `use_count` (restrição `use_count between 0 and max_uses`), `expires_at`, `revoked_at` |
| `classroom_submissions`       | Envio de um aluno: material próprio, `status` (máquina de estados), confirmação do professor separada, `last_request_id`           |
| `classroom_submission_events` | Histórico de cada transição: de, para, quem, papel, nota                                                                           |
| `classroom_lessons`           | Aula publicada: material, dono, `published_revision_id` (revisão fixada), resumo e listas escolhidos, `published`/`unpublished`    |
| `classroom_shared_items`      | Compartilhamento explícito (hoje `flashcard_set`): dono, turma, `shared_at`, `revoked_at`                                          |
| `classroom_resources`         | Links de apoio do professor (somente `https://`)                                                                                    |

Funções (todas `security invoker`, `search_path = ''`, executáveis só por `service_role`):

- `classroom_require_admin(user, classroom, action)` — **verificação central**, chamada por todas
  as outras. Ações: `read` (qualquer membro ativo), `leave` (membro ativo, inclusive em turma
  arquivada), `participate` (membro ativo, turma ativa), `submit` (aluno), `manage` (professor ou
  monitor), `own` (professor; também em turma arquivada). Quem não é membro ativo recebe
  `CLASSROOM_NOT_FOUND` (sem revelar se a turma existe).
- Turmas: `classroom_create_admin`, `classroom_update_admin`, `classroom_list_mine_admin`,
  `classroom_get_admin`.
- Convites e membros: `classroom_create_invite_admin`, `classroom_list_invites_admin`,
  `classroom_revoke_invite_admin`, `classroom_join_admin`, `classroom_list_members_admin`,
  `classroom_remove_member_admin`, `classroom_leave_admin`, `classroom_set_member_role_admin`.
- Aulas: `classroom_publish_lesson_admin`, `classroom_unpublish_lesson_admin`,
  `classroom_list_lessons_admin`, `classroom_get_lesson_admin`.
- Envios: `classroom_submit_admin`, `classroom_transition_submission_admin`,
  `classroom_list_submissions_admin`, `classroom_get_submission_admin`,
  `classroom_submission_transition_actor` (o grafo) e o gatilho `classroom_submissions_guard`.
- Compartilhamento: `classroom_share_item_admin`, `classroom_revoke_shared_item_admin`,
  `classroom_list_shared_flashcard_sets_admin`, `classroom_get_shared_flashcard_set_admin`.
- Apoio: `classroom_add_resource_admin`, `classroom_remove_resource_admin`,
  `classroom_list_resources_admin`; auxiliares internas (`classroom_summary`,
  `classroom_member_name`, `classroom_end_member_content`, `classroom_check_lesson_content`,
  `classroom_lesson_row`, `classroom_submission_row`, `classroom_shared_set_row`).

## Modelo de permissões

| Ação                                     | Professor | Monitor              | Aluno       | Não membro / ex-membro |
| ---------------------------------------- | --------- | -------------------- | ----------- | ---------------------- |
| Ver turma, membros, aulas, conjuntos, links | sim     | sim                  | sim         | `404`                  |
| Ver envios                               | todos     | todos                | só os seus  | `404`                  |
| Criar/listar/revogar convites            | sim       | sim                  | `403`       | `404`                  |
| Publicar/despublicar aula                | sim (material próprio) | sim (material próprio) | `403` | `404`               |
| Aprovar, recusar, confirmar transcrição, publicar envio | sim | sim           | `403`       | `404`                  |
| Enviar gravação, marcar processamento, retirar envio | `403` | `403`        | sim (só os seus) | `404`             |
| Compartilhar conjunto próprio            | sim       | sim                  | sim         | `404`                  |
| Parar de compartilhar                    | qualquer item | qualquer item    | só os seus  | `404`                  |
| Renomear, arquivar, mudar papéis, remover membro | sim | `403`             | `403`       | `404`                  |
| Sair da turma                            | não (arquivar) | sim             | sim         | `404`                  |

A conta é sempre a do token; nenhum corpo de requisição escolhe dono, papel de quem pede ou
`user_id`.

## Convites

- O navegador gera o código (12 caracteres sem ambíguos, ~60 bits, formato `XXXX-XXXX-XXXX`); o
  servidor normaliza e guarda só o SHA-256. A listagem nunca devolve código nem hash.
- O link é `turmas.html#convite=CÓDIGO`: o código fica no fragmento, que não vai a servidores nem a
  registros de acesso, e a página o retira da barra de endereço.
- Entrar trava a linha do convite (`for update`): entradas simultâneas são serializadas e nunca
  ultrapassam `max_uses` (a restrição da tabela é a segunda barreira). Entrar de novo estando
  ativo não consome uso. Código errado, expirado, revogado ou de turma arquivada recebem a mesma
  resposta (`CLASSROOM_INVITE_INVALID`). A API limita 30 tentativas por conta por hora.
- Quem foi removido só volta com um convite criado depois da remoção (`CLASSROOM_REMOVED`).

## Máquina de estados dos envios

```text
submitted ──(gestão)──▶ approved_for_processing ──(aluno)──▶ processing ──(gestão)──▶ transcription_confirmed ──(gestão)──▶ published
    │                        │                                   │                          │   ▲                                │
    └──(gestão)─▶ rejected ◀─┴───────────────────────────────────┴──────────────────────────┘   └────────(gestão: despublicar)────┘
qualquer estado não final ──(aluno)──▶ withdrawn            rejected e withdrawn são finais
```

- O grafo está em `classroom_submission_transition_actor` e é imposto pelo gatilho
  `classroom_submissions_guard` em **toda** escrita (até de `service_role`): um envio nasce
  `submitted` e só muda pelas arestas acima.
- `processing` exige que o pipeline existente tenha começado (transcrição ou tarefa de
  processamento do material do aluno). O processamento continua sendo do aluno, na conta dele.
- `transcription_confirmed` exige a revisão **atual** e que o aluno já a tenha confirmado
  (`transcription_confirmations`); a confirmação do professor fica em
  `teacher_confirmed_revision_id/by/at` e nunca é gravada como confirmação do aluno.
- `published` cria uma aula com a revisão confirmada pelo professor fixada. Despublicar volta o
  envio a `transcription_confirmed`; retirar um envio publicado também despublica a aula.
- Cada transição grava `classroom_submission_events`; repetir a mesma transição com o mesmo
  `requestId` devolve o resultado anterior (`replayed: true`).

## Fronteira de privacidade

- Nenhuma função das turmas lê `study_progress`, `study_sessions`, `study_time_credits`,
  `study_flashcard_reviews`, `study_annotations`, tentativas de questões (`quiz_session*`),
  calendário, objetivos ou cópias compartilhadas. Um teste verifica o texto da migration e outro
  grava anotação, progresso e revisões de um aluno e confere que nada disso aparece em nenhuma
  leitura do professor.
- Conjuntos compartilhados expõem só `front`, `back`, `style`, `difficulty`, `focus` e a autoria
  (nome escolhido na turma); nunca datas de revisão, intervalos, repetições, facilidade,
  evidências ou referências à transcrição do autor.
- Aulas publicadas expõem a transcrição da revisão fixada, o resumo e as listas escolhidos — nada
  de áudio, vídeo, anotações ou progresso do dono. Publicar não dá escrita no material.
- O professor só lê a transcrição de um aluno quando o aluno a **enviou** para a turma e o envio
  chegou a `processing`.
- Sair ou ser removido: o acesso acaba na hora, os itens compartilhados por essa pessoa são
  revogados, os envios abertos são retirados e as aulas dela são despublicadas. Arquivar a
  turma mantém a leitura e bloqueia escritas.
- Revogar um compartilhamento esconde o item da turma; uma cópia independente que alguém já tenha
  feito (recurso futuro) não volta.
- Tabelas com RLS ativa e sem permissão para `anon`/`authenticated`; funções sem `EXECUTE` para
  esses papéis. O navegador só chega às turmas pela API.

## Leitura para "juntar baralhos de colegas" (recurso futuro)

- `GET /api/classrooms/:id/flashcard-sets` → conjuntos visíveis com `sharedId`, `name`,
  `cardCount`, `author{userId, displayName}`.
- `GET /api/classrooms/:id/flashcard-sets/:sharedId` → `cards[{id, front, back, style,
  difficulty, focus}]`.

O recurso de mesclar deve criar um conjunto **novo** da própria pessoa (via funções existentes do
Flashcards 2.0) a partir desses cartões, com agenda própria.

## Rollback

Ver `database/rollback/classrooms-rollback.md`: primeiro desligar a flag (nada é apagado); depois,
se preciso, ocultar sem apagar; exportar antes de qualquer remoção; remover o esquema nunca
restaura dados.

## Testes

- `backend/tests/classrooms-migration.test.js` (PGlite): guarda e aditividade, convites (hash,
  validade, usos, revogação, repetição idempotente), entradas concorrentes, papéis, matriz de
  permissões (professor, monitor, aluno, não membro, removido) em todas as operações, aulas com
  revisão fixada e sem escrita no material, máquina de estados com transições ilegais e escrita
  direta recusadas, conjuntos compartilhados sem histórico, sair/remover, turma arquivada,
  privacidade, RLS e permissões.
- `backend/tests/classrooms-http.test.js`: as rotas sobre o mesmo SQL (autenticação, validação,
  cabeçalhos privados, papéis, erros).
- `backend/tests/flag-schema-readiness.test.js`, `feature-disabled-http.test.js`,
  `scripts/tests/readiness.test.mjs`: flag desligada não monta rotas; ligada sem esquema → 503.
- `frontend/tests/classrooms-check.cjs`: jornada no navegador com **API simulada**
  (`frontend/tests/support/mock-classrooms.cjs`), axe, teclado, foco, 390 px, inglês.

Limite conhecido: o PGlite tem uma conexão só, então a concorrência real de entradas é provada
pelo bloqueio da linha (`for update`) e pela restrição da tabela, não por duas conexões ao mesmo
tempo.
