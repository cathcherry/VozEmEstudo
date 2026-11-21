# Sessão autônoma noturna — Voz em Estudo 3.0

Registro vivo da sessão. É atualizado a cada marco para que outra sessão possa continuar o trabalho.

## Estado inicial (21/11/2026, ~04:50 UTC)

| Item | Valor |
| --- | --- |
| Branch de trabalho anterior | `feat/personalization-2-0` |
| SHA inicial | `cc7ec56` (CI Quality verde) |
| `main` antes da sessão | `47b64bf` |
| Referência de segurança | branch `backup/pre-voz-3-0` → `cc7ec56` (o proxy recusa tags) |
| Branch de integração desta sessão | `feat/voz-3-0`, a partir de `cc7ec56` |
| PR desta sessão | [cathcherry/VozEmEstudo#8](https://github.com/cathcherry/VozEmEstudo/pull/8) (rascunho, base `main`) |

## Marcos

| # | Marco | Situação | Commit |
| --- | --- | --- | --- |
| M0 | Integrar o PR #7 em `main` | **Feito**: merge `fee4222` (CI verde em `cc7ec56`) | `fee4222` |
| M1 | Material 3.0: preparação × espaço de estudo | Implementado e com testes automáticos (mock) | `1acde64` |
| M3a | Questões 3.0: falsa insuficiência (backend) | Implementado e com testes automáticos (unidade + HTTP com mock) | `8fad422` |
| M2 | Focar 3.0: sessão única, painel lateral e cápsula, página Focar | Implementado e com testes automáticos (8 de unidade + jornada) | `5501d38` |
| M3b | Questões 3.0: objetivos (presets) e opções avançadas | Implementado e com testes automáticos | `b8b4b63` |
| M4 | Personalização 3.0: 3 temas, fundos, vidro, fundo por página | Implementado e com testes automáticos (axe) | `1a07155` |
| M6 | Anotações 3.0: Destacar/Comentar no texto, ouvir trecho, voltar ao destaque | Implementado e com testes automáticos | `edfb5b1` |
| M5 | Plano diretor 3.0 | **Feito** | `62f8288` |
| M7 | Flashcards 3.0: modelos visuais separados do conteúdo | Implementado e com testes automáticos (axe em cada modelo) | `52b3284` |
| M8 | IA compartilhada: chave canônica e single flight (fundação) | Implementado e com testes de unidade; ainda não conectado aos jobs | `1a69148` |
| M9 | Início: "Iniciar foco" com um clique | Implementado e com testes automáticos | `98a1e3a` |

O CI do `5501d38` falhou por uma contagem de links no dock do modo foco, que mudou com o novo item "Focar". Isso foi corrigido em `b8b4b63`.

## Decisões de arquitetura

### Modo da aula pelo estado real

- A função `lessonMode`, em `frontend/js/utils/lesson-steps.js`, decide o modo da aula.
- Transcrição não confirmada → preparação.
- Transcrição confirmada sem resumo, lista, resposta, escuta ou "Começar a estudar" → preparação, com o título "Aula pronta para estudar".
- Nos demais casos → espaço de estudo.
- A escolha "Começar a estudar" e a última aba ficam em `voz-study-v1`, já sincronizado pela `profile_state`.

### Questões 3.0

- O plano combina conceito × habilidade × faceta: definição, mecanismo, relação, causa/efeito, aplicação e implicação.
- O tamanho do plano é limitado pela transcrição (cerca de 60 palavras por questão), e não por "no máximo 2 por conceito".
- Vagas reserva absorvem as rejeições.
- Há uma única rodada de reposição, com no máximo 3 chamadas ao modelo.
- O motivo da falta é classificado: `insufficient_content` só quando a fonte limitou o plano; caso contrário, `unsupported`, `invalid`, `redundancy` ou `model_omitted`.
- O filtro de redundância passou a considerar a faceta.
- Conceitos com citação parafraseada são mantidos se as palavras do rótulo estiverem na aula.
- Versão do prompt: `questions-v2.2`.

### Focar 3.0

- Uma sessão por conta, em `localStorage` (`voz-focus-v1:<userId>`), calculada a partir de horários de relógio.
- Uma aba líder, visível, envia o heartbeat ao servidor.
- Os ticks são gravados antes do envio. Assim, a próxima página reenvia o mesmo tick, e o servidor o aceita de forma idempotente.
- Uma execução não confirmada por 20 s para nesse ponto, e o intervalo oculto não recebe crédito.
- O crédito continua 100% no servidor, que usa os próprios horários e credita no máximo 30 s por tick.
- O shell de utilidades (`utility-shell.js`) oferece:
  - botão no topo;
  - painel à direita que estreita o conteúdo em telas largas (folha inferior no celular);
  - cápsula flutuante.

  Esconder qualquer um deles nunca para a sessão.

### Personalização 3.0

- Novos temas `matcha`, `desktop` e `planner`.
- Fundos declarativos: `wallpaper` (CSS com as cores do tema), mais `pageWallpapers` por página e `surfaces` (sólidas ou vidro).
- Tudo fica em `audioestudo-ui-preferences`, já sincronizado. Não foi criado novo armazenamento.

Nenhuma migration foi criada ou aplicada.

## Testes (contêiner, API simulada)

- Backend: suíte completa verde. Inclui `question-generation` (11) e `study-authoring-http` (7).
- Front end, unidade: `test:dom`, `test:study-tracking` (correção: os testes de `focus-session` só passaram a fazer parte deste script em `6439743`; antes eram rodados à mão), `test:planning-ui`, `test:personalization`, `test:study-authoring`, `test:flashcards-ui`, `test:learning-tools` e `test:quality`.
- Navegador:
  - `browser-check` (57);
  - `dashboard-home` (9);
  - `navigation`;
  - `personalization` (8);
  - `feature-validation` (6);
  - `focus-check` (5, novo);
  - `i18n-check`;
  - `account-privacy` (6);
  - `theme-check` (3 casos, com os temas novos).
- Nenhuma chamada paga. Login, Supabase e provedores reais **não** foram testados.

## Próximos passos (em ordem)

1. Anotações 3.0: caderno da aula (comentários com trecho e tempo, ouvir o trecho) e desenho do modelo de âncoras com vários segmentos e de documentos ricos.
2. Plano diretor 3.0 (`docs/PLANO_DIRETOR_VOZ_EM_ESTUDO_3_0.md`).
3. Flashcards 3.0: separação entre conteúdo e template (fundação).
4. Revisar o CI do PR #8 e, com tudo verde, decidir o merge.

## Continuação — branch `feat/voz-3-1` (PR #9)

| Marco | Commit |
| --- | --- |
| Durações do Focar na conta (`focusSettings`) | `f494ef4` |
| Biblioteca em lista estilo Finder; "+ Nova disciplina"; catálogo no simulador | `7263872` |
| Aba Flashcards na aula + `?conjunto=` em Revisar | `a31e078` |
| Blocos do Focar ligados à aula; notificação do sistema (opcional) | `4c6052f` |
| Imagem ou GIF próprio como fundo | `fd83fee` |
| Tipografia dos títulos | `4f35699` |
| Som ambiente gerado no navegador (ruído marrom, chuva, ondas) com ducking | `6439743` |
| Biblioteca: selecionar várias aulas e mover de uma vez (barra de seleção, axe ok) | `37b1e31` |
| Histórico de blocos do Focar na conta (`focus-history`, união entre aparelhos) | `59dc98e` |
| Correção de privacidade: "Apagar dados desta conta" também remove Focar, painel e som (achada pelo CI) | `5ddc1b9` |

**PR #9 integrado em `main`** (merge `399bddb`), depois do CI verde em `5ddc1b9`.

## Continuação — branch `feat/ux-navigation` (Flashcards 3.0 sem migrations)

| Marco | Commit |
| --- | --- |
| Mesclar conjuntos próprios e importar cartões (Anki em texto, CSV, TSV) para um conjunto novo | `3bea961` |
| "Seu ritmo": 12 semanas contra a meta, aulas mais estudadas e mapa do ano (`GET /api/study/history`, sem tabela nova) | `0296300` |
| Adesivos originais ao lado do título (até 3, preferências sincronizadas) | `21b0fc1` |
| Calendário › Semana: grade de horários, mover sem arrastar | `e3c3e4a` |
| Aula muito longa: busca na transcrição sem travar (pausa, cache, fatias) + jornada de 2.200 trechos | `8e22974` |
| Questões: "Reportar problema" (marca própria, sincronizada, desfazer) + Aparência na página de responder | `c5c9967` |
| Revisar › Questões: lista "Questões marcadas" | `1490c10` |
| Som ambiente "Tocar junto com o foco" | `61d94df` |
| Planejar uma unidade (tarefa por aula, prazos espaçados, re-executar acrescenta só as novas) | `3d5b53a` |

**PR #10 integrado em `main`** (merge `41e2437`), depois do CI verde em `7d39dff`.

## Voz em Estudo 3.3 — migrations aprovadas (branch `feat/ux-navigation`)

O dono autorizou criar e testar migrations; produção só com backup e nova autorização. Cada marco informa separadamente:

- **arquivo no Git**: a migration está versionada;
- **aplicada**: em qual banco ela rodou de fato.

| Marco | Situação | Commits |
| --- | --- | --- |
| B — Flashcards 3.0 | Backend e frontend prontos, com testes (detalhes abaixo). | `55ce18e`, `1567013` |
| A — Anotações 3.0 (subagente, revisado e integrado) | Âncoras em vários trechos, caderno da aula com autosave, referências cientes de revisão, privado por padrão. | merge `50fd380` |
| E — Turmas privadas (subagente, revisado e integrado) | Papéis, convites com hash, aulas publicadas com revisão fixada, máquina de estados de envios, conjuntos compartilhados sem histórico. | merge `8a32fc2` |
| D — Gerações de IA reutilizáveis | Chave canônica ligada aos jobs: reuso autorizado, single flight, orçamento diário, falha honesta. | `d3c9436` |
| C — Aprendizagem multiaula (subagente, revisado e integrado) | Material integrado de várias aulas, unidades ou disciplina. Só entram revisões confirmadas, com a lista de fontes congelada. Fila própria com lease e no máximo 2 tentativas. Cache de mapas de conhecimento opcional, em migration separada. Citações conferidas na revisão de origem. Usa a reutilização de gerações do marco D. | merge `95b02b9` |

**Flashcards 3.0 em detalhe:**

- notas tipadas;
- modelos visuais;
- uma aparência por conjunto;
- mescla com decisões;
- `.apkg`.

### Validação da migration de Flashcards 3.0 (`20261121150000_flashcards_3_0.sql`)

| Ambiente | Resultado |
| --- | --- |
| PGlite (testes) | 5 testes de SQL real: backfill, agenda e histórico intactos, procedência, modelos, RLS e escrita concorrente. |
| **Postgres 16.15 local** | Cadeia completa aplicada em ordem (`001` → `profile_state_hardening`, mais `proposals/profile-gamification.sql`, que cria `profile_state` em produção). Dados inseridos antes da migration. Detalhes abaixo. |
| Staging Supabase | Aplicada em 21/11. Ver "Validação no staging Supabase real". |
| **Produção** | **Não aplicada.** |

Resultado no Postgres 16.15 local:

- preflight: `prerequisites = t`, `already_applied = f`;
- a migration foi aplicada;
- postflight: 2 cartões e 1 revisão, iguais ao preflight; `term_cards = 1`; `untyped_term_cards = 0`; RLS ligado; sem acesso para `anon` nem para `authenticated`; bucket privado;
- uma segunda aplicação foi recusada com `FLASHCARDS_3_0_ABORT`.

Achado: nenhuma migration cria `public.profile_state`. Ela vem da proposta `database/proposals/profile-gamification.sql`, aplicada à mão. Para recriar um banco do zero, aplique essa proposta antes de `20261120120000_profile_state_hardening.sql`.

### Validação em Postgres 16.15 real (local, 21/11)

Montei um banco novo com a cadeia inteira, de `001_initial.sql` até `20261120120000`, mais a proposta `profile_state`. Antes das migrations novas, criei pelas APIs antigas:

- uma aula com permissão declarada e revisão confirmada;
- um destaque E14;
- uma nota solta;
- um cartão `term_definition`.

Depois apliquei as quatro migrations novas, na ordem de implantação:

| Migration | Preflight | Aplicação | Postflight |
| --- | --- | --- | --- |
| `20261121130000_notes_3_0` | pré-requisitos ok; 2 anotações, 1 com âncora | ok | backfill completo (`legacy_rows_not_backfilled = 0`), contagens iguais, RLS ligado, sem acesso do navegador, nenhum compartilhamento |
| `20261121140000_classrooms` | pré-requisitos ok | ok | RLS ligado nas 8 tabelas, funções só para o servidor |
| `20261121150000_flashcards_3_0` | 1 cartão a reclassificar | ok | `term_cards = 1`, `untyped_term_cards = 0`, bucket privado |
| `20261121160000_generation_reuse` | — | ok | — |

**Concorrência real**, com conexões separadas (o PGlite não consegue testar isso):

| Cenário | Resultado |
| --- | --- |
| 4 alunos entram ao mesmo tempo num convite de 1 uso | 1 entrou; `use_count = 1`; 3 receberam `CLASSROOM_INVITE_FULL` |
| 5 pedidos de geração equivalentes ao mesmo tempo | 1 `start` e 4 `join`; uma única linha, ou seja, um único job pago |
| 2 escritores no mesmo caderno, na versão 1 | um salvou (v2) e o outro recebeu `LEARNING_VERSION_CONFLICT`; nada foi perdido em silêncio |

**Produção: nenhuma destas migrations foi aplicada.**

### Validação no staging Supabase real (`voz-em-estudo-staging`, 21/11)

O projeto de staging estava pausado e vazio: sem migrations e sem tabelas. Reativei o projeto e montei o banco do zero, na mesma ordem de produção:

1. as 19 migrations existentes, mais a proposta `profile_state`;
2. dados sintéticos pelas funções antigas (sem nenhum dado real):
   - 2 contas `qa-a@example.test` e `qa-b@example.test`;
   - uma aula com revisão confirmada;
   - um destaque E14;
   - uma nota solta;
   - um cartão `term_definition`;
3. os preflights;
4. as quatro migrations novas;
5. os postflights.

O texto de cada migration foi lido do GitHub no commit `cbec226`. O MD5 de cada arquivo lido é igual ao MD5 do arquivo local no Git, então o que rodou é exatamente o que está versionado.

| Verificação (postflight) | Resultado |
| --- | --- |
| anotações depois do backfill | 2, iguais ao preflight; `legacy_not_backfilled = 0` |
| anotações compartilhadas | 0 (privado por padrão) |
| cartões depois da migration | 1; `term_cards = 1` |
| RLS em todas as tabelas novas | sim |
| tabelas novas legíveis pelo navegador (`anon`/`authenticated`) | 0 |
| funções novas chamáveis pelo navegador | 0 |
| bucket `flashcard-media` público | não |

**Advisors do Supabase (lint real do projeto):**

- **Segurança:**
  - `rls_enabled_no_policy` (INFO) nas tabelas novas: é intencional. Essas tabelas só são acessadas pelo servidor (`service_role`) e não têm grants para o navegador.
  - `authenticated_security_definer_function_executable` em `storage_owns_material`: é anterior à 3.3 (`20261120090000`) e intencional, porque as políticas do Storage precisam dela.
  - `function_search_path_mutable` em `qa.apply_git_migration`: é o auxiliar que usei só no staging (detalhes abaixo).
  - Proteção contra senhas vazadas desligada: é uma configuração do Auth, não de migration.
  - Nenhum achado de segurança nos objetos novos.
- **Desempenho:** só INFO.
  - Índices nunca usados: esperado num banco recém-criado.
  - Chaves estrangeiras sem índice de cobertura: algumas são das tabelas novas, por exemplo `ai_generations.material_id` e as chaves `classroom_lessons.*`. Nenhuma está num caminho de leitura quente. Elas só pesam em exclusões em cascata. Se o volume crescer, fica como recomendação para uma migration aditiva futura de índices.

**Teste funcional no staging**, chamando as funções do servidor com as contas sintéticas:

| Passo | Resultado |
| --- | --- |
| professora cria a turma e um convite de 1 uso | ok |
| aluna entra pelo convite | `student` |
| professora usa o mesmo convite | `alreadyMember`, sem gastar o uso |
| geração nova, depois o mesmo pedido de novo | `start`, depois `join` (um único job) |
| depois de concluir, um pedido que aceita reuso | `reuse` |
| outra conta usa a revisão da professora | `GENERATION_SOURCE_FORBIDDEN` |
| geração na turma sobre uma aula não publicada | `GENERATION_SOURCE_FORBIDDEN` |
| salvar o caderno | versão 1 |
| escrita com versão velha | `LEARNING_VERSION_CONFLICT` |
| outra conta salva o caderno da aula | `LEARNING_NOT_FOUND` |

**Auxiliar de staging:** para aplicar os arquivos exatamente como estão no Git, criei no staging:

- a extensão `http`;
- o schema `qa`, com `qa.apply_git_migration(commit, caminho)`.

Isso existe **só no staging**. Não faz parte de nenhuma migration e não deve ir para produção.

| Banco | Notes 3.0 | Turmas | Flashcards 3.0 | Gerações reutilizáveis |
| --- | --- | --- | --- | --- |
| PGlite (testes) | aplicada | aplicada | aplicada | aplicada |
| Postgres 16.15 local | aplicada | aplicada | aplicada | aplicada |
| Staging Supabase | aplicada | aplicada | aplicada | aplicada |
| **Produção (`audioestudo`)** | **não** | **não** | **não** | **não** |

### Validação do marco C (`20261121170000_multi_lesson` e `20261121171000_knowledge_map_cache`)

| Ambiente | Resultado |
| --- | --- |
| PGlite | 11 testes de SQL, 2 do worker (com provedor falso que conta as chamadas) e 1 HTTP com 5 subtestes |
| navegador | 6 jornadas com API simulada |
| Postgres 16.15 local | preflight ok; as duas migrations aplicadas; postflight ok (RLS, nada para o navegador, gatilho de fontes congeladas, cache com RLS); reaplicação recusada com `MULTI_LESSON_ABORT` |
| Concorrência real (PG16) | 2 workers pedem a fila ao mesmo tempo: um recebe o job e o outro recebe `none` (`skip locked`); um único `attempt_count = 1` |
| Staging Supabase | preflight ok; aplicadas a partir do commit `95b02b9`, com o MD5 dos dois arquivos igual ao do Git; postflight ok; 0 funções novas chamáveis pelo navegador |

Teste funcional no staging:

| Passo | Resultado |
| --- | --- |
| resolver as próprias aulas | 1 incluída |
| outra conta pede as mesmas aulas | 0 incluídas, 1 em `missing` (nada revelado) |
| geração nova | `start`, `attach` em `queued` |
| worker pega o job | `running`, com 1 revisão de fonte |
| outro worker tenta ler as fontes | `MULTI_LESSON_LEASE_LOST` |
| tentativa de reescrever as fontes | `MULTI_LESSON_SOURCES_IMMUTABLE` |
| job concluído | `ready` |
| pedido equivalente com reuso | `reuse`, sem chamada de IA |
| outra conta lê o material | `MULTI_LESSON_NOT_FOUND` |

Nenhum provedor de IA real foi chamado: nada foi gasto.

| Banco | Multiaula | Cache de mapas (opcional) |
| --- | --- | --- |
| Postgres 16.15 local | aplicada | aplicada |
| Staging Supabase | aplicada | aplicada |
| **Produção (`audioestudo`)** | **não** | **não** |

## Voz em Estudo 3.4 — integração real, jornadas completas e prontidão para produção

Ponto de partida: `main` em `504f3aa` (3.3). Branch `feat/ux-navigation`.

### Jornadas completadas (código)

| Item | Entrega | Migration nova |
| --- | --- | --- |
| Questões do material integrado → lista respondível | a lista é ancorada na primeira aula de origem, guarda a citação de cada questão e é respondida pelo fluxo de sempre | `20261121180000_multi_lesson_exports.sql` |
| Cartões do material integrado → conjunto pessoal | conjunto com procedência (aula e trecho); o segundo clique devolve o mesmo | (a mesma) |
| Várias unidades na Biblioteca | seleção direta, com prévia de incluídas e excluídas | — |
| Material integrado compartilhado com a turma | o professor publica direto; o aluno passa pela fila; leitura só do conteúdo gerado; revogação imediata | `20261122090000_classroom_contributions.sql` |
| Contribuições com revisão e recado | estados claros para o aluno; fila do professor com aprovar ou recusar e recado | (a mesma) |
| Aulas e links publicados pelo professor | leitura completa pelo aluno, sem nada privado do professor | — |
| Mescla de baralhos (item 7) | ver o subagente de UX abaixo | — |

### Validação real no staging (`voz-em-estudo-staging`)

O acesso foi feito por chaves salvas no ambiente: o proxy de rede injeta a chave do servidor do
Supabase e a chave da Groq, e nenhum valor aparece em código ou log. Foram criadas 9 contas
sintéticas `qa34-*@example.test` (professora, s1…s7 e uma conta de fora).

- **Migrations novas no staging:** aplicadas a partir do commit `4323d41`, com MD5 igual ao do Git, preflight e postflight ok.
- **Readiness real (`check-runtime.js`):** todos os probes `[OK]`, incluindo os novos (exportações, cache e bucket `flashcard-media`).
- **E2E pela API real (`scripts/staging/e2e-staging.mjs`, `docs/STAGING_E2E.md`):** **188 PASS, 0 FAIL, 1 SKIP**.
  - Real: banco, Auth, Storage, fila e worker.
  - Simulado: só o texto da IA e da transcrição.
  - Cobertura:
    - caderno com conflito concorrente;
    - turma, papéis e envio do aluno até a publicação;
    - links de apoio e revogação;
    - 7 alunos compartilham baralhos; **s1 junta os de 4 colegas**, aplica **um** modelo ao baralho inteiro e os originais ficam intactos;
    - `.apkg` com imagem;
    - multiaula com exportações;
    - 5 gerações simultâneas → 1 job;
    - 57 leituras negadas a outras contas.
- **Destaque em 3 trechos** (o passo que ficou SKIP no E2E) validado depois, com transcrição de 10 trechos: salvo, lido de volta com a citação exata, citação adulterada → 409, outra conta → lista vazia.
- **Navegador real** (Playwright pelo proxy): 8 telas, 0 violações axe depois das correções. O login pelo formulário não funciona atrás do proxy (ver "Bloqueios").

**Bugs reais encontrados e corrigidos:**

| Problema | Correção |
| --- | --- |
| `join` simultâneo respondia sem `jobId` (4 de 5 pedidos) | espera o job da geração |
| envio publicado oferecia "confirmar transcrição", que despublicava a aula sem aviso | botão "Despublicar da turma" com confirmação |
| nome da marca com problema de rótulo (WCAG 2.5.3) em todas as páginas | corrigido |
| rótulos sobrepostos no diálogo de mescla | corrigido |
| modelo padrão `llama-3.3-70b-versatile` fora da Groq | novo padrão `openai/gpt-oss-120b` |
| `gpt-oss` estourava o limite de tokens raciocinando | `LLM_REASONING_EFFORT=low` |
| `json_validate_failed` derrubava o material integrado | vira saída inválida reparável |
| readiness não conferia exportações, cache e `flashcard-media` | probes novos |
| `.env.example` sem 2 flags e 2 variáveis | completado, com teste |

### Teste real de IA (Groq, limitado)

`openai/gpt-oss-120b`, 8 chamadas no total (3 antes do log de uso existir), em duas aulas sintéticas
de Biologia com 10 trechos cada.

| Geração | Resultado | Latência | Tokens (entrada/saída) |
| --- | --- | --- | --- |
| resumo de 1 aula | ok | 1,4–3,2 s | 647 / 509 |
| 5 questões de 1 aula | ok, enunciados corretos e sem erro de conteúdo | 1,5–4,5 s | 621 / 529 |
| material integrado de 2 aulas (1ª tentativa) | **falhou**: raciocínio estourou 4000 tokens, `LLM_FAILED` | — | 803 / 4000 |
| material integrado de 2 aulas (depois da correção) | `ready` em 12,2 s, 2 chamadas (1 mapa + síntese; o outro mapa veio do cache) | 5,4 + 4,3 s | 4012 / 4296 |
| resumo de novo com `reuse` | `reuse`, sem chamada | imediato | 0 |

**Qualidade do material integrado:**

- 2 seções de resumo (fotossíntese e respiração);
- 5 questões e 6 cartões;
- **toda citação é trecho literal da aula certa**, com posição e tempo;
- nada foi descartado pelo verificador de evidência (`droppedCitations = 0`).

Ressalva de estilo: algumas questões dizem "descrita na transcrição".

**Custo real:** cerca de 6,1 mil tokens de entrada e 9,3 mil de saída registrados (mais 3 chamadas
anteriores ao log), ou seja, **menos de US$0,01**, a US$0,15 e US$0,60 por milhão de tokens. Os
servidores com IA real foram desligados depois do teste.

### Prontidão para produção

- `docs/RUNBOOK_PRODUCAO_3_4.md`:
  - backup verificado;
  - estado das migrations (`database/checks/production-state-3-4.sql`, somente leitura);
  - ordem e dependências;
  - preflight e postflight de cada migration;
  - configuração antes das flags;
  - ordem de ativação das flags;
  - testes de fumaça, reversão e monitoramento.
- **Ensaio completo** no Postgres 16: banco no estado pré-3.3 → 8 migrations na ordem, cada uma com preflight e postflight → estado final todo aplicado → reaplicação recusada pelas guardas.
- **Backup e restauração ensaiados**: `pg_dump -Fc` → `pg_restore` num banco vazio → `database/checks/backup-fingerprint.sql` idêntico.

| Banco | 8 migrations da 3.3/3.4 |
| --- | --- |
| PGlite (testes) | aplicadas |
| Postgres 16.15 local | aplicadas (incluindo o ensaio do roteiro) |
| Staging Supabase | **aplicadas** (as 2 da 3.4 em 21/11, commit `4323d41`) |
| **Produção (`audioestudo`)** | **não aplicadas**: aguardam backup verificado e autorização |

### Bloqueios e pendências

- **Login pelo formulário atrás do proxy.** O proxy do ambiente de nuvem injeta a chave do servidor em todo pedido ao Supabase, e o Auth passa a recusar o token do usuário.
  - Para os testes, a API usou `SUPABASE_AUTH_VERIFY=jwks`.
  - No navegador, a sessão foi gravada a partir de um login real feito fora dele. Isso é uma adaptação do teste, não um bug do produto.
  - Fora desse proxy, o login normal não é afetado.
- **Upload ao Storage atrás do proxy.** Foi feito como service role, então as políticas RLS do bucket `audios` não foram exercitadas no staging (só nos testes PGlite).
- **Auxiliar `qa` no staging.** A extensão `http` e o schema `qa` existem só no staging, para aplicar migrations direto do Git. Podem ser removidos quando não forem mais úteis.
