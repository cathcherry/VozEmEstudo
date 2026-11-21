# Gerações de IA reutilizáveis — `20261121160000_generation_reuse.sql`

**Situação:** está versionada no Git e foi testada em PGlite e no Postgres 16 local, inclusive com concorrência real. **Não foi aplicada em produção.**

## O que resolve

A chave canônica (`backend/src/domain/generation-key.js`) agora fica ligada aos jobs de resumo e de questões. Ela é formada por:

- escopo;
- revisões de origem confirmadas;
- tipo;
- configurações que mudam o conteúdo;
- versão do prompt;
- provedor e modelo.

Antes de criar um job, o servidor pergunta ao banco o que fazer (`begin_generation_admin`):

| Decisão | Quando | Custo |
| --- | --- | --- |
| `reuse` | Há um resultado equivalente pronto e autorizado, e o aluno aceitou reutilizá-lo (`reuse: true`). Numa turma, os alunos sempre reutilizam. | Nenhuma chamada de IA. |
| `join` | Um job equivalente já está rodando (clique duplo, segunda aba, colega da turma). | Nenhuma chamada a mais. |
| `start` | Nada equivalente está vivo. | Conta no orçamento diário. |

**Invalidação por versão:** mudar a revisão, as configurações, o prompt ou o modelo produz outra chave. Resultados antigos não são reutilizados para uma fonte nova.

**Single flight:** um índice único parcial (`generation_key` em `pending`, `running` ou `ready`) e um lock por chave. No Postgres 16 real, 5 pedidos simultâneos geraram 1 `start` e 4 `join`.

**Falha honesta:**
- uma falha final libera a chave;
- um job perdido é reconciliado a partir de `processing_jobs` (`FALHOU` → falha; `CONCLUIDA` → pronto);
- um pedido que nunca chegou a criar job é liberado depois de 10 minutos.

**Orçamento:** `AI_DAILY_GENERATION_LIMIT` (padrão 40) por conta a cada 24 h.
- Conta cada geração iniciada, incluindo as que depois falharam ou foram substituídas.
- Reutilizar e acompanhar não contam.
- Ao estourar: 429 com mensagem clara.

**Escopo de turma:**
- só membros ativos de turma ativa;
- as fontes precisam ser revisões publicadas naquela turma;
- só professor ou monitor iniciam uma geração nova; alunos reutilizam ou acompanham;
- quem sai da turma perde o acesso.

## Dependências e ordem

1. `20261121130000_notes_3_0.sql` (independente desta).
2. `20261121140000_classrooms.sql`, **necessária** para o escopo de turma.
3. `20261121150000_flashcards_3_0.sql` (independente desta).
4. **Esta migration.**

Preflight e postflight: `database/checks/generation-reuse-*.sql`.
Reversão: `database/rollback/generation-reuse-rollback.md`.
Flag: `FEATURE_GENERATION_REUSE`.

## Limites conhecidos

- O escopo de turma no backend está ligado aos pedidos do professor (`classroomId` no corpo). A tela de turma ainda não tem um botão de "usar a geração da turma" para alunos. A regra no banco está testada.
- Flashcards gerados e materiais multiaula ainda não passam por este controle. O esquema já aceita `flashcards` e `multi_lesson`.
