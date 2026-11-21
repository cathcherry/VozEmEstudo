# Material integrado (Marco C) — `20261121170000_multi_lesson.sql` e `20261121171000_knowledge_map_cache.sql`

**Situação:** versionadas no Git.

Onde foram aplicadas (21/11):

| Banco | Situação |
| --- | --- |
| PGlite (testes automáticos) | aplicadas a cada execução |
| Postgres 16.15 local | aplicadas; preflight e postflight ok; reaplicação recusada; concorrência real ok |
| staging Supabase `voz-em-estudo-staging` | aplicadas com o arquivo idêntico ao do commit `95b02b9` (MD5 conferido); postflight e teste funcional ok |
| **produção (`audioestudo`)** | **não aplicadas** |

**Não foi validado com um provedor de IA real** (os testes usam provedores falsos que contam as chamadas). A flag `FEATURE_MULTI_LESSON` fica desligada por padrão. Detalhes em `docs/OVERNIGHT_PROGRESS.md`, seção 3.3.

## O que resolve

O estudante gera um **material integrado** (resumo integrado, questões integradas e, opcionalmente,
flashcards) a partir de:

- várias aulas escolhidas na Biblioteca (barra de seleção → "Material integrado");
- uma unidade inteira (pasta da unidade → "Estudar a unidade inteira");
- várias unidades (API, `kind: "units"`);
- uma disciplina (pasta da disciplina → "Estudar a disciplina").

## Objetos

### `20261121170000_multi_lesson.sql` (obrigatória para a flag)

| Objeto | Para quê |
| --- | --- |
| `multi_lesson_materials` | O material integrado: título, seleção, o que gerar, **lista de fontes congelada** (`sources`: material, revisão, número da revisão, título), `source_revision_ids`, aulas excluídas com motivo, `generation_id`, status, resultado, modelo, erro. `unique(user_id, request_id)` dá idempotência. |
| gatilho `multi_lesson_materials_sources_immutable` | Impede reescrever `sources`, `source_revision_ids`, seleção, excluídas e dono depois de criado. |
| `multi_lesson_jobs` | Fila própria (`processing_jobs` exige um único `material_id`): status `pending/running/retry/done/failed`, `attempt_count`, `max_attempts` (padrão 2), `next_attempt_at`, `locked_at`/`locked_by` (lease), `error_code`. Um job por material integrado. |
| `multi_lesson_resolve_admin(user, kind, ids)` | Resolve a seleção (somente leitura). |
| `multi_lesson_attach_admin(...)` | Registra o pedido depois de `begin_generation_admin`. |
| `multi_lesson_get_admin`, `multi_lesson_list_admin`, `multi_lesson_delete_admin` | Leitura e exclusão, sempre com `p_user_id`. |
| `multi_lesson_claim_job_admin`, `multi_lesson_renew_lease_admin`, `multi_lesson_job_sources_admin`, `multi_lesson_complete_job_admin`, `multi_lesson_fail_job_admin` | Fila do worker. |

### `20261121171000_knowledge_map_cache.sql` (opcional, camada de otimização)

| Objeto | Para quê |
| --- | --- |
| `knowledge_maps` | Mapa de conhecimento por revisão, com chave única `(source_revision_id, prompt_version, model_family)`, dono (`user_id`, `material_id`), `hit_count`. |
| `knowledge_map_get_admin`, `knowledge_map_put_admin` | Ler mapas da própria conta; gravar (o primeiro a gravar vence). |

**O cache não é pré-requisito de nada.** A migration principal não menciona `knowledge_maps`
(testado). Sem a tabela, cada pedido analisa as aulas de novo: o serviço trata qualquer erro do
cache como "não encontrado" (testado com a migration do cache ausente). O readiness não exige o
cache.

Tudo é privado à conta: RLS ligado nas três tabelas, `revoke all` de `public`, `anon` e
`authenticated`, grants só para `service_role`, funções `security invoker set search_path = ''`.

## Regras

**Fontes = revisões confirmadas.** Uma aula entra quando é do próprio estudante e a revisão **atual**
da transcrição tem uma confirmação dele em `transcription_confirmations`. As demais aparecem como
excluídas, com motivo `unconfirmed` (há transcrição, mas a revisão atual não foi confirmada) ou
`not_transcribed`. Aulas de outra conta, num pedido por aulas, são só contadas em `missing`: nada é
revelado sobre elas. Unidade ou disciplina de outra conta → `MULTI_LESSON_NOT_FOUND`.

Ordem: por aulas, a ordem escolhida; por unidade/disciplina, ordem da disciplina, da unidade, e data
de criação.

**Snapshot.** A lista resolvida é copiada para o material integrado no pedido. Editar uma aula
depois (nova revisão), renomeá-la ou confirmar outra revisão não muda o material (testado). O worker
lê o `segments_snapshot` exatamente dessas revisões.

**Prévia honesta.** O pedido pode levar `expectedRevisionIds` (o que a prévia mostrou). Se a seleção
mudou entre a prévia e o pedido, a resposta é 409 `MULTI_LESSON_SOURCES_CHANGED`. Dentro do banco,
`multi_lesson_attach_admin` resolve de novo e exige as mesmas revisões da geração.

## Custo limitado

- No máximo **12 aulas** confirmadas por material (`MULTI_LESSON_TOO_MANY_SOURCES`).
- Por tentativa: no máximo **1 chamada de mapa por revisão sem mapa em cache**, **1 chamada de
  síntese** e **1 chamada de reparo** (só se a síntese não vier no formato). Com 12 aulas sem cache:
  até 14 chamadas por tentativa.
- No máximo **2 tentativas** por job (`max_attempts = 2`), e só erros temporários do provedor tentam
  de novo. Mapas que deram certo na primeira tentativa ficam no cache (se existir) e não são pagos
  de novo.
- Cada pedido passa por `begin_generation_admin` (tipo `multi_lesson`, fontes = todas as revisões,
  escopo `user:<id>`):
  - dois pedidos iguais simultâneos → um `start` e um `join` → **um** material e **um** job (testado
    em SQL e por HTTP);
  - `reuse: true` devolve um material equivalente pronto, sem chamada de IA nem orçamento;
  - o orçamento diário `AI_DAILY_GENERATION_LIMIT` vale para cada `start`.
- A chave canônica inclui: fontes, `outputs`, `questionCount`, `flashcardCount`, `focus`, versão do
  prompt (`multi-lesson-v1`) e família do modelo (provedor:modelo da tarefa `summary`, fixados no
  registro para o worker usar o mesmo modelo).
- Limite por conta na rota de criação: 20 pedidos por hora (além do orçamento diário).

## Evidências

1. **Mapa por revisão** (`knowledge-map-v1`): conceitos, definições curtas e relações, cada um com
   evidência = posição do trecho + citação. O servidor valida o JSON (zod) e confere cada citação no
   `segments_snapshot` daquela revisão (mesma tolerância de `evidence-match.js`; citações de 3–4
   palavras precisam aparecer literalmente). Conceitos e relações sem citação conferida são
   descartados e contados.
2. **Síntese** (`multi-lesson-v1`): recebe os mapas (não as transcrições). Cada seção, questão ou
   cartão precisa citar `{lesson: "A1", position, quote}`; a citação é conferida no trecho daquela
   aula. O que fica sem citação conferida é descartado. O relatório (`result.report`) informa:
   descartados por tipo, citações descartadas, aulas sem conteúdo sustentado, acertos de cache,
   chamadas de mapa, reparo usado e total de chamadas.
3. Cada citação salva aponta para `materialId`, `revisionId`, número da revisão, título da aula,
   posição do trecho, citação literal e `startMs`. A página liga para
   `material.html?id=<materialId>&busca=<citação>&trecho=<posição>#transcricao` (o mesmo link de
   "Abrir no trecho da aula" das anotações).
4. Nenhum item sustentado → falha final `MULTI_LESSON_UNSUPPORTED` (nada é salvo como pronto).

## Execução e falhas

- O worker existente (`backend/src/worker.js`) roda, a cada volta, os jobs de sempre e depois **um**
  job multiaula (`jobs/multi-lesson-runner.js`). Os jobs atuais não mudam.
- Lease renovado a cada terço da janela (`WORKER_STALE_LEASE_SECONDS`, padrão 600 s). Um job cujo
  worker morreu é retomado se ainda houver tentativas; senão falha com `WORKER_LEASE_EXPIRED`.
- Erro temporário → `retry` com o mesmo atraso dos outros jobs (`JOB_RETRY_DELAY_*`).
- Falha final → material `failed` e `fail_generation_admin` (a chave é liberada e o próximo pedido
  equivalente começa de novo). Sucesso → material `ready` e `complete_generation_admin`.
- Excluir um material ainda em fila também libera a chave.
- Flag ligada sem a migration: a API responde 503 `MULTI_LESSON_SCHEMA_REQUIRED` e o worker para
  de consultar essa fila (registra `MULTI_LESSON_SCHEMA_REQUIRED` uma vez).

## Dependências e ordem de implantação

1. `001_initial`, `20261009101846_academic_review`, `20261104190000_catalog_units`.
2. `20261121140000_classrooms.sql` (exigida por `generation_reuse`).
3. `20261121160000_generation_reuse.sql`.
4. **`20261121170000_multi_lesson.sql`** (preflight antes, postflight depois).
5. Opcional: **`20261121171000_knowledge_map_cache.sql`** (pode vir depois, ou nunca).
6. `FEATURE_CATALOG_UNITS=true` e `FEATURE_MULTI_LESSON=true` na API **e no worker**; reiniciar os
   dois. O readiness acusa `FEATURE_MULTI_LESSON exige FEATURE_CATALOG_UNITS=true` e confere
   `ai_generations`, `multi_lesson_materials` e `multi_lesson_jobs`.

Preflight e postflight: `database/checks/multi-lesson-*.sql` (somente leitura).
Reversão: `database/rollback/multi-lesson-rollback.md`.

## O que foi validado e onde

| O quê | Onde |
| --- | --- |
| Guarda, aditividade, RLS, nenhum acesso do navegador, preflight/postflight | `backend/tests/multi-lesson-migration.test.js` (PGlite) |
| Resolução por aulas, unidade, unidades e disciplina; confirmadas × não confirmadas × sem transcrição × outra conta | idem |
| Snapshot imutável após edição/nova revisão/renomear; limite de 12; worker só lê a própria lease | idem |
| Pedidos simultâneos → 1 job; reuso; orçamento; idempotência; isolamento de contas | idem e `multi-lesson-http.test.js` |
| Fila: claim, lease, retry com espera, falha final libera a chave, worker morto | `multi-lesson-migration.test.js`, `multi-lesson-worker.test.js` |
| Cache: chave única, primeiro vence, só o dono, reuso evita a chamada de mapa; funciona sem cache | `multi-lesson-migration.test.js`, `multi-lesson-worker.test.js` (provedor falso, chamadas contadas) |
| Evidências descartando seções/questões sem trecho; reparo único | `multi-lesson-worker.test.js` |
| API HTTP completa | `multi-lesson-http.test.js` (fixture Supabase sobre PGlite; worker em modo demonstração) |
| Interface (Biblioteca, diálogo, página, 390 px, axe) | `frontend/tests/multi-lesson-check.cjs` (**API simulada**) |

**Não validado:** Postgres 16 real, Supabase real, provedor de IA real (qualidade da integração e
das citações com um modelo de verdade), concorrência real entre conexões (PGlite usa uma conexão).

## Fora do escopo / próximos passos

- Compartilhar material integrado com a turma (escopo `classroom`): não implementado.
- Fontes "objetivo" e "coleção" do plano diretor: não implementadas.
- Salvar as questões integradas como lista de questões tentável (quiz) ou os cartões como conjunto
  de flashcards: hoje ficam só na página do material integrado.
- Regenerar o mapa de uma aula sob pedido e limpar mapas antigos do cache.
