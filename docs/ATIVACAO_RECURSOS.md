# Ativação de recursos

Situação de cada flag e roteiro para ligar o que falta em produção. Atualizado em 20/11/2026.

## Inventário de 20/11/2026 (21h, somente leitura)

Conferido diretamente no projeto `audioestudo` (Postgres 17.11), sem alterar nada:

- **Histórico de migrations do Supabase**: `study_authoring`, `security_hardening`,
  `material_videos_table`. Aplicadas fora do histórico (conferidas pelos objetos): base `001`, E02,
  E03, `ai_executions`, correção das políticas de vídeo, `profile_state` (proposta).
- **Tabelas existentes (20)**: base + E02 + E03 + `ai_job_executions`, `transcription_word_alignments`,
  `material_videos`, `question_list_shares`, `profile_state`. **Nenhuma** tabela de planejamento,
  tentativas, flashcards, tempo de estudo, anotações, calendário ou cópias de material.
- **Buckets**: `audios` (100 MB), `study-videos` (100 MB), `profile-media` (8 MB), todos privados, com
  políticas de dono.
- **Pré-requisitos das migrations pendentes**: todos atendidos (E03 presente; chave
  `materials(id,user_id)` já existe e a E05 a reaproveita; `set_updated_at`; tabelas de questões;
  `transcription_versions`/`confirmations`; chaves de `profile_state` no formato, máximo 9 por conta).
- **Riscos de dados**: nenhum (sem questões sem lista, listas sem aula, chaves duplicadas ou aulas sem
  dono).
- **Linha de base**: 22 aulas, 13 transcrições, 25 versões, 11 confirmações, 17 resumos, 19 listas,
  102 questões, 8 disciplinas, 3 unidades, 18 linhas de `profile_state`, 4 contas.
- **Ensaio**: as 10 migrations pendentes, em ordem, numa réplica do esquema de produção (PGlite),
  dentro de uma transação desfeita no fim: 16 tabelas novas, todas com RLS, sem escrita do navegador,
  **nenhuma linha existente alterada** (contagem e hash de conteúdo de cada tabela antes/depois). Em
  produção, cada migration terá o próprio ensaio com `rollback` imediatamente antes de ser aplicada.
- **Advisor de desempenho**: 13 políticas lentas (corrigidas por `rls_performance`) e 14 chaves
  estrangeiras sem índice (`rls_performance` cobre todas, inclusive `material_videos`, incluída em
  20/11).

### Plano de ativação (em ordem; cada passo só com aprovação)

| #   | Migration                                     | Libera a flag         | Depende de | Situação             |
| --- | --------------------------------------------- | --------------------- | ---------- | -------------------- |
| 1   | E05 `20261104203000_study_planning.sql`       | `planning`            | E03 ✅     | Aguardando aprovação |
| 2   | E10 `20261104223000_quiz_sessions.sql`        | `quiz_v2`             | E05        | Aguardando aprovação |
| 3   | E12 `20261104233000_quiz_review.sql`          | `quiz_review`         | E10        | Aguardando aprovação |
| 4   | E13 `20261104234500_flashcards.sql`           | `flashcards`          | E05        | Aguardando aprovação |
| 5   | `20261119121000_flashcard_sets.sql`           | `flashcard_sets`      | E13        | Aguardando aprovação |
| 6   | E08/E09 `20261105011000_study_tracking.sql`   | `study_tracking`      | E05        | Aguardando aprovação |
| 7   | E14/E15 `20261105014000_annotations.sql`      | `annotations`         | E02 ✅     | Aguardando aprovação |
| 8   | E18/E19 `20261105014500_calendar_sharing.sql` | `calendar`, `sharing` | E05        | Aguardando aprovação |
| 9   | `20261120120000_profile_state_hardening.sql`  | — (segurança)         | —          | Aguardando aprovação |
| 10  | `20261119140000_rls_performance.sql`          | — (desempenho)        | —          | Aguardando aprovação |

Para cada passo aprovado: ensaio com `rollback` em produção → aplicar → pós-check → conferir contagens
da linha de base → ligar só a flag correspondente no `backend/.env` → reiniciar o `INICIAR.cmd` → todos
os `[OK]` → teste manual da tabela "Ordem e testes manuais" abaixo.

**Backup**: o plano gratuito do Supabase não oferece backups automáticos baixáveis. Antes do primeiro
passo, faça um dump (`supabase db dump` ou `pg_dump` com a string de conexão do painel) e guarde fora do
repositório. As migrations só acrescentam objetos; desfazer um passo é remover os objetos novos.

## Como ler a matriz

"Pronto para produção" não é uma coisa só. Para cada flag separamos:

1. **Código**: a implementação existe no repositório.
2. **Migration**: o arquivo SQL existe em `database/migrations/`.
3. **Banco**: as tabelas foram conferidas no banco `audioestudo` (20/11/2026).
4. **Flag**: se está ligada no `backend/.env` de produção — **não é visível daqui**; confira o seu
   `.env` (o `INICIAR.cmd` lista os recursos ativos ao iniciar).
5. **Dependências**: outras flags, provedores ou buckets necessários.
6. **Ponta a ponta**: validado com testes automáticos (banco em memória + navegador simulado) e/ou
   manualmente em produção.
7. **Limitações** conhecidas.

| Flag                               | Código              | Migration                                                | Banco                   | Dependências                  | Ponta a ponta                                        | Limitações                                                                                        |
| ---------------------------------- | ------------------- | -------------------------------------------------------- | ----------------------- | ----------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `catalog_units`                    | ✅                  | E03                                                      | ✅                      | —                             | Automático ✅; manual ✅ (pastas usadas em produção) | Ícone de pasta salvo em `profile-media`                                                           |
| `mp4_retention`                    | ✅                  | E07 (`material_videos_table` + correção de políticas)    | ✅                      | bucket `study-videos`         | Automático ✅; manual parcial                        | MP4 até 100 MB                                                                                    |
| `study_authoring`                  | ✅                  | `study_authoring`                                        | ✅                      | —                             | Automático ✅; manual ✅ (listas geradas em 19/11)   | Só múltipla escolha                                                                               |
| `sharing`                          | ✅                  | E18/E19 (cópia de material) + `study_authoring` (listas) | ⚠️ só a parte de listas | `study_authoring` para listas | Automático ✅                                        | Ligar sem E18/E19: o `INICIAR.cmd` bloqueia a inicialização (a cópia de material não funcionaria) |
| `planning`                         | ✅                  | E05                                                      | ❌                      | —                             | Automático ✅                                        | —                                                                                                 |
| `quiz_v2`                          | ✅                  | E10                                                      | ❌                      | E05                           | Automático ✅                                        | —                                                                                                 |
| `quiz_review`                      | ✅                  | E12                                                      | ❌                      | `quiz_v2`, E10                | Automático ✅                                        | —                                                                                                 |
| `flashcards`                       | ✅                  | E13                                                      | ❌                      | E05                           | Automático ✅                                        | —                                                                                                 |
| `flashcard_sets`                   | ✅                  | `flashcard_sets`                                         | ❌                      | `flashcards`, E13             | Automático ✅                                        | Salvar cartões gerados exige revisão confirmada (desde 20/11)                                     |
| `study_tracking`                   | ✅                  | E08/E09                                                  | ❌                      | E05                           | Automático ✅                                        | Minutos medidos no navegador, com limites no servidor                                             |
| `annotations`                      | ✅                  | E14/E15                                                  | ❌                      | —                             | Automático ✅                                        | Anotação presa à versão da transcrição                                                            |
| `calendar`                         | ✅                  | E18/E19                                                  | ❌                      | E05                           | Automático ✅                                        | Janela de consulta de 62 dias                                                                     |
| `social_basic`                     | ❌ não implementada | —                                                        | —                       | —                             | —                                                    | O `INICIAR.cmd` recusa iniciar se estiver ligada                                                  |
| (config) `ASR_PROVIDER=assemblyai` | ✅                  | `ai_executions`                                          | ✅                      | `ASSEMBLYAI_API_KEY`          | Manual ✅ (transcrições de 19/11)                    | Custo por minuto de áudio                                                                         |

"Automático ✅" significa testes com Postgres em memória (PGlite) e/ou navegador com API simulada.
Não substitui teste manual com dados reais.

## O que acontece quando algo falta

| Situação                                                                                             | Comportamento                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flag desligada                                                                                       | Rotas do recurso não existem (`404`); a interface não mostra o recurso                                                                                                        |
| Flag ligada, migration ausente, iniciando pelo `INICIAR.cmd`                                         | A verificação de leitura (`backend/src/diagnostics/check-runtime.js`) lista o que falta e **bloqueia a inicialização**                                                        |
| Flag ligada, migration ausente, servidor iniciado de outro jeito                                     | Só as rotas daquele recurso respondem `503` com código `*_SCHEMA_REQUIRED`/`SCHEMA_UPGRADE_REQUIRED`; o resto do app funciona (teste `flag-schema-readiness.test.js`)         |
| Combinação inválida (`quiz_review` sem `quiz_v2`, `flashcard_sets` sem `flashcards`, `social_basic`) | O `INICIAR.cmd` recusa iniciar e explica                                                                                                                                      |
| Provedor de IA fora do ar                                                                            | A tarefa é repetida automaticamente (até `JOB_MAX_ATTEMPTS`); a tela de processamento mostra "Aguardando nova tentativa (tentativa n de 3)" e, se esgotar, a mensagem de erro |
| Worker parado no meio de uma tarefa                                                                  | A tarefa é retomada depois de `WORKER_STALE_LEASE_SECONDS` (padrão 600 s)                                                                                                     |

A verificação não expõe nada ao navegador: roda só no servidor e mostra apenas nomes de tabelas e
mensagens genéricas.

## Roteiro de ativação (para cada recurso)

Nenhuma migration é aplicada automaticamente. Para cada uma:

1. **Backup** do banco (Supabase › Database › Backups) e anotar a hora.
2. **Pré-check** de leitura no SQL Editor: o arquivo `database/checks/<etapa>-preflight.sql`.
3. **Ensaio**: colar a migration trocando o `commit;` final por `rollback;` e executar; tem que
   terminar sem erro.
4. **Aplicar** a migration original (com `commit;`).
5. **Pós-check**: `database/checks/<etapa>-postflight.sql`.
6. Ligar a flag no `backend/.env`, fechar e abrir o `INICIAR.cmd` e conferir os `[OK]`.
7. **Teste manual** do roteiro abaixo.

### Ordem e testes manuais

| Etapa                                 | Arquivo                                      | Checks                              | Depois de ligar, testar                                                            |
| ------------------------------------- | -------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| E05 planejamento                      | `20261104203000_study_planning.sql`          | `e05-*`                             | Criar objetivo, subobjetivo e tarefa ligada a uma aula; reordenar; concluir        |
| E10 tentativas                        | `20261104223000_quiz_sessions.sql`           | `e10-*`                             | Responder uma lista com feedback adiado; gabarito só depois de concluir            |
| E12 revisão de erros                  | `20261104233000_quiz_review.sql`             | `e12-*`                             | Refazer só as erradas de uma tentativa concluída                                   |
| E13 flashcards                        | `20261104234500_flashcards.sql`              | `e13-*`                             | Criar cartão; revisar com De novo/Difícil/Bom/Fácil; ver histórico                 |
| Conjuntos de flashcards               | `20261119121000_flashcard_sets.sql`          | (tabelas no pós-check do authoring) | "Criar flashcards" no Resumo de uma aula **confirmada**; salvar; exportar CSV      |
| E08/E09 tempo de estudo               | `20261105011000_study_tracking.sql`          | `e08-*`                             | Sessão Pomodoro de alguns minutos; meta semanal; abrir em outro navegador          |
| E14/E15 anotações                     | `20261105014000_annotations.sql`             | `e14-e19-*`                         | Destacar trecho, editar, arquivar, buscar no Painel                                |
| E18/E19 calendário e compartilhamento | `20261105014500_calendar_sharing.sql`        | `e14-e19-*`                         | Horário ligado a tarefa; baixar .ics; criar e revogar cópia de leitura de uma aula |
| Endurecimento de `profile_state`      | `20261120120000_profile_state_hardening.sql` | `profile-state-preflight.sql`       | Mudar tema e conferir "Salvo na conta"; abrir o perfil                             |
| Desempenho de RLS                     | `20261119140000_rls_performance.sql`         | —                                   | Navegação normal (sem mudança de comportamento esperada)                           |

Dependências: E10, E13, E08/E09 e E18/E19 exigem E05 antes. E12 exige E10. Conjuntos exigem E13.

## Configuração recomendada do worker

Se o seu `backend/.env` veio do modelo antigo, troque `WORKER_STALE_LEASE_SECONDS=0` por
`WORKER_STALE_LEASE_SECONDS=600` (ou apague a linha). Com `0`, uma tarefa interrompida ao fechar o
`INICIAR.cmd` fica "em processamento" para sempre.
