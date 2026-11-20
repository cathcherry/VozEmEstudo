# Banco de dados (Supabase / Postgres)

Esquema, migrations, segurança e situação do banco de produção. Atualizado em 20/11/2026.

> **Regra de ouro:** migrations são aditivas e só são aplicadas em produção com autorização
> explícita, depois do pré-check (`database/checks/*-preflight.sql`), de um ensaio com `rollback` e
> de backup. Nunca reaplicar `001_initial.sql`.

## Como o acesso funciona

- **O navegador não escreve no banco.** Toda leitura e escrita de dados de estudo passa pela API
  Express, que usa a chave secreta e chama funções `*_admin` (RPC) passando o `user_id` do token.
  As funções conferem a posse no SQL.
- **RLS ligado em todas as tabelas.** Tabelas antigas têm políticas `select` só do dono; as novas
  (estudo, anotações, compartilhamentos, IA, vídeos) não têm política nenhuma e não têm permissões
  para `anon`/`authenticated`: são exclusivas do servidor.
- **Chaves compostas `(id, user_id)`** impedem ligar dados de contas diferentes (ex.: uma tarefa a
  uma aula de outra pessoa).
- **Funções `*_admin`**: `revoke all … from public, anon, authenticated` e `grant execute … to
service_role`. A única função executável por `authenticated` é `storage_owns_material(text)`,
  usada pelas políticas do bucket de vídeos.
- **Versões de transcrição são imutáveis**; resumos, listas e avisos apontam para a versão exata de
  origem (gatilhos `enforce_job_source` e `enforce_derived_source`).
- **Storage**: buckets privados; políticas por caminho (`temp/{sub}/…`, `original/{sub}/…`) e por
  dono.

## Migrations

Em ordem de arquivo (`database/migrations/`). "Produção" = banco `audioestudo`, conferido em
20/11/2026 pela existência das tabelas.

| Arquivo                                             | Nome                                        | O que adiciona                                                                                                                                                                                                                                                 | Pré-requisitos        | Produção                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `001_initial.sql`                                   | Base                                        | Tabelas `materials`, `audio_files`, `transcriptions`, `transcription_segments`, `transcription_versions`, `summary_versions`, `question_batches`, `questions`, `processing_jobs`, `processing_job_events`; enums; `claim_next_processing_job`; bucket `audios` | —                     | ✅                                                                                                                                         |
| `20261009101846_academic_review.sql`                | **E02** — revisão acadêmica                 | `material_permissions`, `transcription_confirmations`, `content_warnings`; origem fixa e idempotência em tarefas e gerações; RPCs de criação, revisão, confirmação, fila e gravação de resumos/questões                                                        | 001                   | ✅                                                                                                                                         |
| `20261104190000_catalog_units.sql`                  | **E03** — Biblioteca 2.0                    | `study_subjects`, `study_units`, `materials.subject_id/unit_id`                                                                                                                                                                                                | E02                   | ✅                                                                                                                                         |
| `20261104203000_study_planning.sql`                 | **E05/E06** — planejamento                  | `study_goals`, `study_subgoals`, `study_tasks`, `study_reorder_tasks`; chave `materials(id,user_id)`                                                                                                                                                           | E03                   | ❌                                                                                                                                         |
| `20261104223000_quiz_sessions.sql`                  | **E10** — tentativas                        | `quiz_sessions`, `quiz_session_answers`; RPCs de resposta e conclusão                                                                                                                                                                                          | E03, E05              | ❌                                                                                                                                         |
| `20261104233000_quiz_review.sql`                    | **E12** — revisão de erros                  | `quiz_session_items`, sessões de revisão                                                                                                                                                                                                                       | E10                   | ❌                                                                                                                                         |
| `20261104234500_flashcards.sql`                     | **E13** — flashcards                        | `study_flashcards`, `study_flashcard_reviews`, `study_review_flashcard_admin`                                                                                                                                                                                  | E03, E05              | ❌                                                                                                                                         |
| `20261105003500_player_video.sql`                   | **E07** — vídeo                             | `material_videos`, bucket `study-videos` e políticas                                                                                                                                                                                                           | E05                   | ⚠️ parcial: o bucket e as políticas existem; a tabela veio de `material_videos_table` e as políticas foram refeitas pela correção de 20/11 |
| `20261105011000_study_tracking.sql`                 | **E08/E09** — tempo de estudo               | `study_settings`, `study_progress`, `study_sessions`, `study_time_credits`                                                                                                                                                                                     | E05                   | ❌                                                                                                                                         |
| `20261105014000_annotations.sql`                    | **E14/E15** — anotações                     | `study_annotations`                                                                                                                                                                                                                                            | E02                   | ❌                                                                                                                                         |
| `20261105014500_calendar_sharing.sql`               | **E18/E19** — calendário e compartilhamento | `study_calendar_events`, `material_shares`                                                                                                                                                                                                                     | E05                   | ❌                                                                                                                                         |
| `20261119030000_ai_executions.sql`                  | Provedores de IA                            | `ai_job_executions`, `transcription_word_alignments`, `claim_next_processing_job(text,int)` com recuperação de tarefas travadas                                                                                                                                | E02                   | ✅ (aplicada fora do histórico de migrations)                                                                                              |
| `20261119120000_study_authoring.sql`                | Autoria de estudo                           | Nome/opções/provedor em resumos e listas; listas de 1 a 100; `questions.format/metadata`; `question_list_shares`; RPCs de listas e compartilhamento                                                                                                            | E02                   | ✅                                                                                                                                         |
| `20261119121000_flashcard_sets.sql`                 | Conjuntos de flashcards                     | `study_flashcard_sets` e colunas de origem/estilo nos cartões                                                                                                                                                                                                  | E02, E13              | ❌                                                                                                                                         |
| `20261119130000_security_hardening.sql`             | Correções do advisor                        | Revoga `rls_auto_enable()`; `search_path` fixo em `set_updated_at`                                                                                                                                                                                             | —                     | ✅                                                                                                                                         |
| `20261119140000_rls_performance.sql`                | Desempenho de RLS                           | Políticas com `(select auth.uid())`; índices para chaves estrangeiras                                                                                                                                                                                          | —                     | ❌ (candidata)                                                                                                                             |
| `20261119150000_material_videos_table.sql`          | Vídeos (complemento)                        | Chave `materials(id,user_id)` se faltar; tabela `material_videos`                                                                                                                                                                                              | E02                   | ✅                                                                                                                                         |
| `20261120090000_player_video_storage_owner_fix.sql` | Vídeos (políticas)                          | `storage_owns_material(text)`; políticas do bucket `study-videos` sem ler `materials` diretamente                                                                                                                                                              | bucket `study-videos` | ✅                                                                                                                                         |

Também presente em produção, fora de `migrations/`: `database/proposals/profile-gamification.sql`
(tabela `profile_state`, usada pelo perfil e pela sincronização de preferências).

Buckets em produção: `audios`, `study-videos`, `profile-media`.

### Próximas aplicações

Para liberar os recursos ainda indisponíveis, a ordem segura é: **E05 → E10 → E12**, **E05 → E13 →
flashcard_sets**, **E05 → E08/E09**, **E14/E15**, **E05 → E18/E19**. Cada uma tem pré-check e
pós-check em `database/checks/` e teste em PGlite. A E05 já foi ajustada para não recriar a chave
`materials(id,user_id)` criada pela migration de vídeos.

## Tabelas

| Tabela                                                                     | Para quê                                                                                                                                      |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `materials`                                                                | A aula: dono, título, disciplina (texto e `subject_id`), unidade, status, estado de revisão                                                   |
| `audio_files`                                                              | Metadados e caminho do áudio enviado; se foi guardado ou apagado                                                                              |
| `transcriptions` / `transcription_segments`                                | Transcrição atual e seus trechos com tempo                                                                                                    |
| `transcription_versions`                                                   | Versões imutáveis (inicial, edições, restaurações)                                                                                            |
| `transcription_word_alignments`                                            | Tempos por palavra (legendas palavra a palavra)                                                                                               |
| `transcription_confirmations`                                              | Qual versão a pessoa confirmou                                                                                                                |
| `material_permissions`                                                     | Declaração de permissão de uso, com versão do texto                                                                                           |
| `content_warnings`                                                         | Os três avisos de conteúdo por análise                                                                                                        |
| `summary_versions`                                                         | Resumos: versão de origem, opções, nome, provedor                                                                                             |
| `question_batches` / `questions`                                           | Listas (título, configuração, relatório de cobertura) e questões (formato, metadados com conceito, habilidade, dificuldade e trecho de apoio) |
| `question_list_shares`                                                     | Links de leitura de listas (hash do token, validade, revogação)                                                                               |
| `processing_jobs` / `processing_job_events`                                | Fila do worker e histórico de cada tarefa                                                                                                     |
| `ai_job_executions`                                                        | Provedor/modelo fixados por tarefa e estado da transcrição assíncrona                                                                         |
| `study_subjects` / `study_units`                                           | Pastas de disciplinas e unidades                                                                                                              |
| `material_videos`                                                          | MP4 original guardado e o recorte usado                                                                                                       |
| `profile_state`                                                            | Estado do perfil e preferências sincronizadas (chave/valor por pessoa)                                                                        |
| `study_goals`, `study_subgoals`, `study_tasks`                             | Planejamento (E05)                                                                                                                            |
| `quiz_sessions`, `quiz_session_answers`, `quiz_session_items`              | Tentativas e revisões (E10/E12)                                                                                                               |
| `study_flashcards`, `study_flashcard_reviews`, `study_flashcard_sets`      | Cartões, revisões espaçadas e conjuntos (E13)                                                                                                 |
| `study_settings`, `study_progress`, `study_sessions`, `study_time_credits` | Meta semanal, progresso e sessões de estudo (E08/E09)                                                                                         |
| `study_annotations`                                                        | Destaques e notas presos a uma versão (E14/E15)                                                                                               |
| `study_calendar_events`, `material_shares`                                 | Calendário e cópias de leitura de materiais (E18/E19)                                                                                         |

## Verificações

`database/checks/` tem pares `*-preflight.sql` / `*-postflight.sql` para cada etapa (somente
leitura; contam e conferem estruturas, sem ler dados pessoais), além de:

- `gates-access.sql`: papéis, permissões e quem ignora RLS.
- `first-test-inventory.sql` e `staging-backup-inventory.sql`: inventários.

## Testes do banco

As migrations são testadas em **PGlite** (Postgres em memória), sem tocar o Supabase:
`backend/tests/*-migration.test.js` (guardas, aditividade, permissões, posse entre duas contas) e
`scripts/tests/all-migrations-pglite.test.mjs` (todas juntas). Ver [TESTING.md](TESTING.md).
