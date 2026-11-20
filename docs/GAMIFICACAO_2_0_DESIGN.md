# Gamificação 2.0 — desenho com validação no servidor

Proposta para a branch `feat/gamification-2-0` (Prompt 4). **Nada disto está implementado.**
Escrito em 20/11/2026 a partir da auditoria do sistema atual.

## Situação atual (o que existe e o quanto é confiável)

| Item                                                       | Origem                                                             | Confiável?                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Número de aulas                                            | `GET /api/materials` (servidor)                                    | Sim                                                                                |
| Revisões concluídas, questões respondidas, minutos ouvidos | `study-store` no navegador (localStorage + `profile_state`)        | Não: derivado no navegador                                                         |
| Marcos, XP e nível                                         | `frontend/js/utils/gamification.js`, calculados no navegador       | Não: provisório                                                                    |
| Estado dos marcos                                          | `profile_state` chave `milestones` (gravável pelo próprio usuário) | Não                                                                                |
| Avatares do Nino desbloqueados                             | derivados dos marcos                                               | Cosméticos; a escolha fica em `user_metadata` do Auth, que o próprio usuário edita |

Garantias atuais (verificadas na auditoria):

- XP e marcos **não dão acesso a nada**: o servidor não lê esses valores, e nenhuma rota ou RLS
  depende deles.
- Um usuário só altera o próprio estado (RLS de `profile_state`, testado com duas contas).
- O XP é sempre recalculado a partir de marcos conhecidos; um número de XP gravado à mão é ignorado.
- A interface informa que os pontos são calculados no navegador e não são verificados.

## Objetivo

Pontos, marcos e desbloqueios que reflitam **aprendizagem registrada pelo servidor**, sem
duplicidade, sem depender de números enviados pelo navegador, e sem quebrar o histórico atual.

## 1. Eventos de aprendizagem verificados

Só contam eventos que o servidor já registra por conta própria:

| Evento                                   | Fonte no servidor                              | Pré-requisito  |
| ---------------------------------------- | ---------------------------------------------- | -------------- |
| `lesson_uploaded`                        | `materials` criado com declaração de permissão | E02 (produção) |
| `transcript_confirmed`                   | `transcription_confirmations`                  | E02 (produção) |
| `question_answered` / `attempt_finished` | `quiz_session_answers`, `quiz_sessions`        | E10            |
| `wrong_answers_reviewed`                 | sessões de revisão                             | E12            |
| `flashcard_reviewed`                     | `study_flashcard_reviews`                      | E13            |
| `study_minutes_credited`                 | `study_time_credits`                           | E08/E09        |

Minutos ouvidos e "revisão concluída" hoje vivem no navegador. Eles só passam a contar quando vierem
de E08/E09 (`study_sessions`/`study_time_credits`), que já têm limites de tempo no servidor.

Tabela proposta:

```sql
create table public.learning_events (
  id uuid primary key,                       -- determinístico: hash(tipo, origem)
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                        -- um dos tipos acima
  source_table text not null,
  source_id uuid not null,                   -- linha que comprova o evento
  material_id uuid,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, kind, source_table, source_id)
);
```

Os eventos são gravados **no servidor, na mesma transação** que cria a linha de origem (gatilhos
`after insert` nas tabelas de origem, ou dentro das RPCs `*_admin`). O navegador nunca escreve
eventos. RLS: `select` do próprio dono; sem `insert/update/delete` para `authenticated`.

## 2. Emissão idempotente de recompensas

```sql
create table public.reward_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references public.learning_events(id) on delete restrict,
  milestone_id text,
  xp integer not null check (xp between 0 and 1000),
  reason text not null,                      -- 'event' | 'milestone' | 'legacy_provisional'
  issued_at timestamptz not null default now(),
  unique (user_id, event_id, reason),
  unique (user_id, milestone_id)
);
```

- Uma função `issue_rewards_admin(p_event_id)` lê o evento, soma XP por tipo (tabela de regras
  versionada no código SQL) e avalia marcos com `insert … on conflict do nothing`. Repetir a chamada
  não muda nada.
- **Duplicidade**: impedida pelas chaves únicas acima. Reprocessar um job, repetir uma requisição ou
  receber o mesmo evento duas vezes não gera pontos extras.
- XP total e nível são **calculados** (`sum(xp)` por usuário, view `profile_progress`), nunca
  gravados como número editável.
- Limites contra abuso: XP diário máximo por tipo de evento (por exemplo, respostas repetidas da
  mesma questão contam uma vez por dia).

## 3. Persistência e posse das conquistas

```sql
create table public.achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone_id text not null,
  unlocked_at timestamptz not null,
  evidence_event_id uuid references public.learning_events(id),
  verified boolean not null default true,
  primary key (user_id, milestone_id)
);
```

RLS só de leitura para o dono. Escrita apenas por `issue_rewards_admin` (service_role).

## 4. Migração do histórico atual

1. Recalcular no servidor o que já é verificável: aulas enviadas e transcrições confirmadas (E02),
   e, quando aplicadas, respostas (E10) e revisões de cartões (E13). Esses marcos entram como
   `verified = true` com a data do evento original.
2. Marcos que hoje só existem em `profile_state.milestones` e não têm evidência no servidor são
   importados como `reason = 'legacy_provisional'` e `verified = false`: continuam visíveis (o
   aluno não perde o que viu), com um selo "registrado antes da verificação", e **não** desbloqueiam
   cosméticos novos.
3. A chave `milestones` em `profile_state` passa a ser só cache de exibição e é ignorada no cálculo.

## 5. Autorização de cosméticos

- A escolha de avatar sai do `user_metadata` do Auth (editável pelo usuário) e vai para
  `set_profile_avatar_admin(p_user_id, p_avatar)`, que confere em `achievements` se o avatar está
  desbloqueado (os avatares iniciais continuam livres).
- O frontend lê o avatar escolhido de uma view própria; `user_metadata.mascot_avatar` vira só
  compatibilidade de leitura.

## 6. API

- `GET /api/progress` → XP, nível, marcos (verificados e provisórios) e próximos objetivos.
- `POST /api/profile/avatar` → valida o desbloqueio.
- Sem rota para "dar pontos": pontos nascem só dos eventos.

## 7. Testes necessários

- Duas contas: ninguém lê ou altera progresso alheio.
- Idempotência: mesmo evento processado 3 vezes → mesmo XP.
- Job repetido, resposta repetida, revisão repetida → sem pontos extras.
- Histórico provisório importado não desbloqueia cosméticos.
- Avatar bloqueado recusado pela RPC mesmo chamando a API diretamente.

## Dependências

Depende das migrations E10, E12, E13 e E08/E09 para ter eventos além de aulas e confirmações. Pode
começar só com `lesson_uploaded` e `transcript_confirmed`, que já existem em produção.
