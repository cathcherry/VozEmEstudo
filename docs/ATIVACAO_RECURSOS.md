# Ativação de recursos

Situação de cada flag e roteiro para ligar o que falta em produção. Atualizado em 20/11/2026 (ativação aplicada às 21h40).

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

| #   | Migration                                     | Libera a flag         | Depende de | Situação          |
| --- | --------------------------------------------- | --------------------- | ---------- | ----------------- |
| 1   | E05 `20261104203000_study_planning.sql`       | `planning`            | E03 ✅     | ✅ Aplicada 20/11 |
| 2   | E10 `20261104223000_quiz_sessions.sql`        | `quiz_v2`             | E05        | ✅ Aplicada 20/11 |
| 3   | E12 `20261104233000_quiz_review.sql`          | `quiz_review`         | E10        | ✅ Aplicada 20/11 |
| 4   | E13 `20261104234500_flashcards.sql`           | `flashcards`          | E05        | ✅ Aplicada 20/11 |
| 5   | `20261119121000_flashcard_sets.sql`           | `flashcard_sets`      | E13        | ✅ Aplicada 20/11 |
| 6   | E08/E09 `20261105011000_study_tracking.sql`   | `study_tracking`      | E05        | ✅ Aplicada 20/11 |
| 7   | E14/E15 `20261105014000_annotations.sql`      | `annotations`         | E02 ✅     | ✅ Aplicada 20/11 |
| 8   | E18/E19 `20261105014500_calendar_sharing.sql` | `calendar`, `sharing` | E05        | ✅ Aplicada 20/11 |
| 9   | `20261120120000_profile_state_hardening.sql`  | — (segurança)         | —          | ✅ Aplicada 20/11 |
| 10  | `20261119140000_rls_performance.sql`          | — (desempenho)        | —          | ⏸️ Não aprovada   |

Para cada passo aprovado: ensaio com `rollback` em produção → aplicar → pós-check → conferir contagens
da linha de base → ligar só a flag correspondente no `backend/.env` → reiniciar o `INICIAR.cmd` → todos
os `[OK]` → teste manual da tabela "Ordem e testes manuais" abaixo.

**Backup**: o plano gratuito do Supabase não oferece backups automáticos baixáveis. A ativação de
20/11 seguiu sem dump, por decisão do dono do projeto, porque as migrations só acrescentam objetos e
cada passo tinha uma trava: se qualquer linha das 17 tabelas existentes mudasse (contagem ou hash de
conteúdo), o passo inteiro era desfeito. Todas as travas passaram. Para desfazer a ativação:
`database/rollback/20261120_feature_activation_undo.sql` (testado numa réplica; apaga os dados dos
recursos novos). Daqui em diante, faça um dump (`supabase db dump`) antes de mudanças de esquema.

### Resultado da ativação (20/11/2026)

- **Aplicadas** (histórico do Supabase): `e05_study_planning`, `e10_quiz_sessions`,
  `e12_quiz_review`, `e13_flashcards`, `flashcard_sets`, `e08_study_tracking`, `e14_annotations`,
  `e18_calendar_sharing`, `profile_state_hardening`.
- **Pós-check**: 16 tabelas novas, todas com RLS; nenhuma permissão do navegador nelas (só leitura
  das próprias linhas por política); nenhuma função `*_admin` executável pelo navegador;
  `profile_state` sem nada para `anon` e só `SELECT/INSERT/UPDATE` para `authenticated`; contagens
  da linha de base iguais. Advisor de segurança: só os avisos conhecidos e intencionais.
- **Teste integrado em produção** (com contas e aulas reais, dentro de uma transação desfeita no fim;
  nada ficou gravado, conferido depois): 36 verificações, todas aprovadas:
  - planejamento: criar objetivo/subobjetivo/tarefas, reordenar, concluir e reabrir; outra conta não
    reordena; tarefa não aceita aula de outra conta;
  - Quiz 2.0: feedback adiado não devolve gabarito nem explicação; lista incompleta não conclui;
    outra conta não responde; conclusão;
  - revisão de erros: só as erradas, histórico da tentativa original intacto, feedback imediato com
    gabarito;
  - Flashcards 2.0: conjunto a partir da revisão confirmada (duplicata descartada), revisão não
    confirmada recusada, revisão agenda para 1 dia, repetição da mesma requisição não duplica, outra
    conta bloqueada;
  - tempo de estudo: sessão Pomodoro, uma sessão ativa por vez, meta semanal e fuso, progresso;
    outra conta bloqueada;
  - anotações: destaque ancorado na revisão, edição (versão 2), busca; outra conta bloqueada;
  - calendário: horário ligado a tarefa, feed com horário e tarefa; outra conta não liga tarefa;
  - cópia de leitura: cria, abre sem gabarito/arquivos, revogada some, expirada some; outra conta
    bloqueada;
  - `profile_state` como navegador: só as próprias linhas, não altera as de outra conta, sem
    `TRUNCATE`/`DELETE`, formato de chave exigido; navegador sem acesso direto às tabelas novas.
- **Falta**: ligar as flags no `backend/.env` (abaixo) e o teste manual pela interface com login real
  (tabela "Ordem e testes manuais").

### Flags a ligar no `backend/.env`

```
FEATURE_STUDY_AUTHORING=true
FEATURE_PLANNING=true
FEATURE_QUIZ_V2=true
FEATURE_QUIZ_REVIEW=true
FEATURE_FLASHCARDS=true
FEATURE_FLASHCARD_SETS=true
FEATURE_STUDY_TRACKING=true
FEATURE_ANNOTATIONS=true
FEATURE_CALENDAR=true
FEATURE_SHARING=true
```

Nunca ligar `FEATURE_SOCIAL_BASIC` (não implementada; o `INICIAR.cmd` recusa iniciar). Depois de
salvar, feche e abra o `INICIAR.cmd`: todas as linhas devem sair `[OK]`.

## Como ler a matriz

"Pronto para produção" não é uma coisa só. Para cada flag separamos:

1. **Código**: a implementação existe no repositório.
2. **Migration**: o arquivo SQL existe em `database/migrations/`.
3. **Banco** (migrada): as tabelas foram conferidas no banco `audioestudo` (20/11/2026).
4. **Flag**: se está ligada no `backend/.env` de produção — **não é visível daqui**; confira o seu
   `.env` (o `INICIAR.cmd` lista os recursos ativos ao iniciar).
5. **Dependências**: outras flags, provedores ou buckets necessários.
6. **Ponta a ponta**: testes automáticos (banco em memória + navegador simulado); "integrado" =
   funções do banco testadas em produção com contas reais numa transação desfeita (20/11); "manual" =
   pela interface com login real.
7. **Limitações** conhecidas.

| Flag                               | Código              | Migration                                                | Banco | Dependências                  | Ponta a ponta                                        | Limitações                                                                                        |
| ---------------------------------- | ------------------- | -------------------------------------------------------- | ----- | ----------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `catalog_units`                    | ✅                  | E03                                                      | ✅    | —                             | Automático ✅; manual ✅ (pastas usadas em produção) | Ícone de pasta salvo em `profile-media`                                                           |
| `mp4_retention`                    | ✅                  | E07 (`material_videos_table` + correção de políticas)    | ✅    | bucket `study-videos`         | Automático ✅; manual parcial                        | MP4 até 100 MB                                                                                    |
| `study_authoring`                  | ✅                  | `study_authoring`                                        | ✅    | —                             | Automático ✅; manual ✅ (listas geradas em 19/11)   | Só múltipla escolha                                                                               |
| `sharing`                          | ✅                  | E18/E19 (cópia de material) + `study_authoring` (listas) | ✅    | `study_authoring` para listas | Automático ✅; integrado ✅; manual pendente         | Ligar sem E18/E19: o `INICIAR.cmd` bloqueia a inicialização (a cópia de material não funcionaria) |
| `planning`                         | ✅                  | E05                                                      | ✅    | —                             | Automático ✅; integrado ✅; manual pendente         | —                                                                                                 |
| `quiz_v2`                          | ✅                  | E10                                                      | ✅    | E05                           | Automático ✅; integrado ✅; manual pendente         | —                                                                                                 |
| `quiz_review`                      | ✅                  | E12                                                      | ✅    | `quiz_v2`, E10                | Automático ✅; integrado ✅; manual pendente         | —                                                                                                 |
| `flashcards`                       | ✅                  | E13                                                      | ✅    | E05                           | Automático ✅; integrado ✅; manual pendente         | —                                                                                                 |
| `flashcard_sets`                   | ✅                  | `flashcard_sets`                                         | ✅    | `flashcards`, E13             | Automático ✅; integrado ✅; manual pendente         | Salvar cartões gerados exige revisão confirmada (desde 20/11)                                     |
| `study_tracking`                   | ✅                  | E08/E09                                                  | ✅    | E05                           | Automático ✅; integrado ✅; manual pendente         | Minutos medidos no navegador, com limites no servidor                                             |
| `annotations`                      | ✅                  | E14/E15                                                  | ✅    | —                             | Automático ✅; integrado ✅; manual pendente         | Anotação presa à versão da transcrição                                                            |
| `calendar`                         | ✅                  | E18/E19                                                  | ✅    | E05                           | Automático ✅; integrado ✅; manual pendente         | Janela de consulta de 62 dias                                                                     |
| `social_basic`                     | ❌ não implementada | —                                                        | —     | —                             | —                                                    | O `INICIAR.cmd` recusa iniciar se estiver ligada                                                  |
| (config) `ASR_PROVIDER=assemblyai` | ✅                  | `ai_executions`                                          | ✅    | `ASSEMBLYAI_API_KEY`          | Manual ✅ (transcrições de 19/11)                    | Custo por minuto de áudio                                                                         |

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
