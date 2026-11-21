# E2E de staging — Voz em Estudo 3.4

Script: `scripts/staging/e2e-staging.mjs`. Ele percorre o produto inteiro **pela API HTTP real**, com
contas sintéticas (`@example.test`), contra um projeto Supabase de **staging** (banco, Auth e
Storage reais). Não há segredo no script: a URL do Supabase e a chave **publicável** vêm de
`GET /api/config`; senhas ficam só no arquivo de contas; tokens ficam só na memória; a saída tem
apenas nomes de passos, status HTTP e contagens. Ele se recusa a rodar se a API apontar para o
projeto de produção ou se uma conta não for `@example.test`.

## Como rodar

Pré-requisitos: uma API e um worker apontando para o staging (com `MOCK_EXTERNAL_SERVICES=true`,
para que IA e transcrição sejam simuladas e nada seja cobrado) e todas as flags da 3.4 ligadas.

```bash
E2E_ACCOUNTS_FILE=/caminho/privado/accounts.json \
E2E_BASE_URL=http://localhost:3401 \
NODE_USE_ENV_PROXY=1 \
node scripts/staging/e2e-staging.mjs
```

| Variável | Obrigatória | Uso |
| --- | --- | --- |
| `E2E_ACCOUNTS_FILE` | sim | JSON `{teacher, s1…s7, outsider: {email, password}}` (fora do Git) |
| `E2E_BASE_URL` | não (`http://localhost:3400`) | API que serve o app |
| `E2E_BUDGET_BASE_URL` | não | Uma segunda API **no mesmo banco** iniciada com `AI_DAILY_GENERATION_LIMIT=1`, para observar `429 GENERATION_BUDGET_EXCEEDED` sem gastar o orçamento real; sem ela o passo vira `SKIP` |
| `E2E_RESULTS_FILE` | não | Grava os resultados em JSON |
| `E2E_ONLY` | não | Lista de passos (`1,2,3`); os passos seguintes dependem dos anteriores |
| `NODE_USE_ENV_PROXY=1` | atrás de proxy | Faz o `fetch` do Node usar `HTTPS_PROXY` |

Cada verificação imprime `PASS`, `FAIL` ou `SKIP` com o status HTTP; `[simulado]` marca o que
depende de saída simulada de IA/ASR. O processo sai com código 1 se houver qualquer `FAIL`. Cada
rodada cria dados novos (nomes com a data da rodada); nada é apagado e as contas não são removidas.

### Atenção: proxy que injeta a chave do servidor

No ambiente de nuvem em que a validação foi feita, o proxy de rede injeta a chave **secreta** do
Supabase em **todo** pedido a `*.supabase.co`. Com isso o Supabase Auth deixa de ver o token do
usuário (`GET /auth/v1/user` → `403 bad_jwt: missing sub claim`), e:

- a API iniciada com o padrão (`SUPABASE_AUTH_VERIFY=server`, porta 3400) responde **401 a todos os
  pedidos autenticados** — o script para no passo 0 com `FAIL API aceita o token do usuário`;
- o login pelo formulário no navegador recebe `401` (o supabase-js manda a chave publicável em
  `Authorization`), e leituras diretas do navegador ao PostgREST (`profile_state`) também;
- o upload direto ao Storage passa (200), mas como **service role**: as políticas RLS do bucket
  `audios` (só o próprio prefixo) **não** são exercitadas neste ambiente.

Por isso a rodada foi feita numa API do worktree na porta 3401 com `SUPABASE_AUTH_VERIFY=jwks`
(confere a assinatura ES256 do token pela JWKS pública do projeto — ver `docs/CONFIGURACAO.md`).
Fora desse proxy, use o padrão.

## O que cada passo prova

| Passo | O que prova |
| --- | --- |
| 0 | API no projeto de staging; login real das 9 contas no Supabase Auth; a API aceita o token; sem token → 401 |
| 1 | Aula criada do jeito real: WAV sintético de 4 s enviado ao bucket `audios` em `temp/{user}/{material}/`, `POST /api/materials` com a declaração de permissão (sem ela 422, versão antiga 409, prefixo alheio 403; duas criações simultâneas com o mesmo id → a mesma aula), `POST /process`, o worker transcreve, a aula fica `awaiting_review`, gerar antes de confirmar → 409, confirmação da revisão (dois cliques → uma confirmação) |
| 2 | Caderno: vazio → v1, mesmo `requestId` → `replayed`, 4 salvamentos sucessivos (autosave), **dois salvamentos simultâneos na mesma versão → exatamente um `409 LEARNING_VERSION_CONFLICT`**, o vencedor fica inteiro e a aba perdedora reaplica o texto na versão atual (nada se perde); HTML → 400 |
| 3 | Destaque ancorado na revisão confirmada, recuperado com início/fim/citação; o caderno cita o destaque (`annotation_ref`); âncora para um trecho inexistente ou com citação errada → `409 LEARNING_ANCHOR_CONFLICT` |
| 4 | Turma: criação, convite (só o hash é guardado; a lista não devolve o código), código errado 404, s1…s7 entram ao mesmo tempo, reentrada não gasta uso, 8 membros; outsider 404 e não vê a turma na lista; aluno não convida, não renomeia, não muda papéis, não remove, não publica, não cria links (403); aula publicada com a revisão fixada, sem anotações/caderno/áudio |
| 5 | Envio do aluno: `submitted` → aluno não aprova o próprio (403) → professor aprova com recado → `processing` sem processar → 409 → aluno processa (worker) e marca `processing` → professor não confirma antes do aluno (409) → aluno confirma → professor lê a revisão e confirma → publica; o aluno vê `published` e o histórico; a aula aparece na turma. Recusa com motivo: o aluno vê `rejected` e o motivo; estado final (409). Outro aluno não vê o envio |
| 7 | Flashcards: s1…s7 criam baralhos próprios; s2 revisa um cartão (histórico real); os 7 oferecem à turma → **pendentes** (fila de revisão); professor vê a fila e a prévia, aluno não revisa (403); 6 aprovados, 1 recusado com motivo (o aluno lê); colegas veem só os aprovados, sem agenda/histórico do autor. **s1 junta os baralhos de 4 colegas (s2…s5)** pela turma: prévia com duplicatas e conflito, decisão `keep:` respeitada, autoria de cada cartão preservada, origem com as 4 fontes; s1 revisa um cartão do baralho novo e aplica **um** modelo visual ao conjunto inteiro: conteúdo, fontes, agenda e histórico iguais antes/depois; os 4 originais intactos (conteúdo, autoria, agenda e histórico de s2); o baralho juntado é pessoal (404 para s2) |
| 6 | Links de apoio: professor cria (sem https → 400), membro vê, outsider 404, remoção some para todos. Revogação: s7 para de compartilhar o baralho aprovado → colegas recebem 404 e ele sai da lista; o original continua com o dono |
| 8 | `.apkg` direto (pacote sintético do fixture `backend/tests/fixtures/apkg.fixture.js`): prévia com 3 notas e 1 imagem não cria nada; importação cria o baralho; a imagem é guardada no Storage e baixa pela URL assinada (PNG); HTML do Anki não fica como HTML; arquivo inválido → 400 |
| 9 | Multiaula: disciplina com 2 unidades; prévia por aulas (aula de outra conta fica em `missing`) e por **várias unidades** (3 aulas); outra conta não descobre nada; geração (`start`), mesmo `requestId` → mesmo material; worker conclui; exporta questões → lista respondível → **responde uma questão** no questionário; exporta flashcards → baralho pessoal; **segundo clique → o mesmo baralho**; compartilha com a turma (aprovado na hora), aluno lê só o conteúdo gerado, outsider 404, registro privado 404, revogação → 404 |
| 10 | **5 pedidos equivalentes simultâneos → 1 job** (1 `start` + 4 `join`, todos com o mesmo `jobId`), 1 resumo; `reuse:true` devolve o resultado pronto sem job novo; outsider não reaproveita; com orçamento esgotado, geração nova → `429 GENERATION_BUDGET_EXCEEDED` e reutilizar continua grátis |
| 11 | Para cada recurso privado criado acima (aulas, caderno, destaques, baralhos, integrado, exportações), o outsider e outras contas recebem 403/404 ou lista vazia; as listas do outsider e de s6 não contêm nenhum desses ids; nenhuma leitura da turma mostra anotações, caderno, materiais não publicados ou baralhos pessoais; o professor não abre o material, o caderno nem o histórico de revisão dos alunos |

## Resultado da rodada de 21/11/2026 (staging `cissxpmmjnnpewreuxeo`)

API do worktree na porta 3401 (`SUPABASE_AUTH_VERIFY=jwks`) + worker em execução no checkout
principal (mesmo código de backend da 3.4), `MOCK_EXTERNAL_SERVICES=true`, API auxiliar na porta
3402 com `AI_DAILY_GENERATION_LIMIT=1` para o passo de orçamento.

**188 PASS, 0 FAIL, 1 SKIP** (rodada `202611211641`, código de saída 0).

| Passo | PASS | FAIL | SKIP | Real | Simulado |
| --- | --- | --- | --- | --- | --- |
| 0 Preparação e login | 5 | 0 | 0 | Auth, API | — |
| 1 Aulas (upload, processamento, confirmação) | 26 | 0 | 0 | Storage¹, API, banco, fila, worker, confirmação | texto da transcrição (ASR) — 3 verificações |
| 2 Caderno e conflito de versão | 8 | 0 | 0 | tudo (funções do banco) | — |
| 3 Destaques | 6 | 0 | 1 | âncoras conferidas no banco | trechos da transcrição; **destaque em vários trechos não verificado com dados reais** (o ASR simulado gera 1 trecho por aula) |
| 4 Turma e papéis | 21 | 0 | 0 | tudo | texto da aula publicada |
| 5 Envio do aluno (aprovar, processar, confirmar, publicar, recusar) | 23 | 0 | 0 | máquina de estados, permissões, worker | texto da transcrição do aluno |
| 7 Flashcards, fila, junção de 4 baralhos, modelo | 44 | 0 | 0 | tudo | — |
| 6 Links e revogação | 12 | 0 | 0 | tudo | — |
| 8 Importação `.apkg` com imagem | 7 | 0 | 0 | parser, Storage, URL assinada | — (pacote sintético) |
| 9 Multiaula e exportações | 22 | 0 | 0 | seleção, fila, exportações, questionário, turma | conteúdo do material integrado (IA) |
| 10 Reuso, concorrência e orçamento | 8 | 0 | 0 | chave de geração, `join`/`reuse`, orçamento | texto do resumo |
| 11 Fronteiras de privacidade | 6 | 0 | 0 | 57 leituras negadas, 19 ids ausentes de listas | — |

¹ Upload aceito pelo Storage real, porém com a chave do servidor injetada pelo proxy (ver acima):
as políticas do bucket não foram exercitadas.

Conferência somente leitura no banco (SQL) depois da rodada, para a aula B do passo 10: 1 job de
geração, 1 linha em `ai_generations`, `reuse_count = 2` (o `reuse` do passo e o do teste de
orçamento).

### Problemas encontrados e corrigidos (worktree)

| Problema | Onde | Correção |
| --- | --- | --- |
| Pedidos `join` que chegavam antes de o pedido `start` anexar o job respondiam `202` **sem `jobId`** (4 de 5 pedidos simultâneos); `questoes.html` navegaria com `job=undefined` e o material mostrava "tente de novo" | `backend/src/services/material.service.js` | O `join` espera (até ~3 s) o job marcado com o id da geração (`findOwnedJobByGeneration`); teste `backend/tests/generation-join-wait.test.js`; revalidado no staging (5 → 1 job, todos com o mesmo `jobId`) |
| A API não autentica ninguém atrás do proxy que injeta a chave do servidor | `backend/src/integrations/supabase/auth-client.js` | Opção `SUPABASE_AUTH_VERIFY=jwks` (padrão inalterado); teste `backend/tests/auth-verify.test.js` |
| Envio **publicado** mostrava "Conferir e confirmar transcrição"; confirmar o diálogo **despublicava** a aula sem avisar (a aresta `published → transcription_confirmed` é o "despublicar") | `frontend/js/pages/classrooms.page.js` | Botão "Despublicar da turma" com confirmação explícita e aviso correto; `frontend/js/utils/submission-actions.js` + teste em `frontend/tests/classrooms-ui.test.mjs` |
| axe `label-content-name-mismatch` (sério, WCAG 2.5.3) em todas as páginas: o link da marca tem rótulo "Voz em Estudo" mas texto visível "VozemEstudo" | `frontend/pages/*.html` | Espaços entre os `span` (a linha é flex com `gap`, o visual não muda); teste `frontend/tests/brand-name.test.mjs`; axe: 0 violações nas 8 telas depois |
| Na captura de página inteira (390 px), os rótulos da lista "Conjuntos" do diálogo Mesclar se sobrepunham (linhas da grade encolhidas até o `min-height` de 40 px) | `frontend/css/flashcards.css` | `grid-auto-rows: max-content` em `.deck-sources` |

### Observações não corrigidas

- `POST /api/flashcards/import/apkg?mode=preview` responde **201** (só lê); o contrato está fixado em
  `backend/tests/flashcards-v3-http.test.js`. Sugestão: 200 na prévia.
- Gerar antes de confirmar responde `409 GENERATION_SOURCE_FORBIDDEN` com a reutilização ligada
  (antes, `TRANSCRIPTION_CONFIRMATION_REQUIRED`); a mensagem é a mesma, mas clientes que olham o
  código precisam aceitar os dois.
- Modelos visuais com o mesmo nome aparecem repetidos, sem distinção, no seletor de aparência.
- O botão "Mesclar conjuntos" fica dentro de um `<details>` fechado ("Conjuntos de flashcards"):
  difícil de encontrar.
- Destaque em vários trechos: o caminho feliz não foi exercitado com dados reais (ASR simulado com
  1 trecho); continua coberto pelos testes PGlite.

## Passada curta no navegador

Playwright Chromium pelo proxy, 1280×860 e 390×844, `deviceScaleFactor` 1, axe-core 4.14 (WCAG 2.0/2.1
A e AA). O login pelo formulário recebeu 401 (proxy, ver acima); a sessão de um login real com
senha feito fora do navegador foi gravada no `localStorage` do supabase-js — **isso foi uma
adaptação do teste, não o fluxo de login do produto**. O certificado do proxy foi aceito com
`ignoreHTTPSErrors` (só o host do Supabase usa HTTPS; o app é `http://localhost`).

Caminho: Biblioteca → material integrado → "Transformar em lista de questões" (lista guardada) e
"Salvar como conjunto de flashcards" (conjunto salvo, 2 repetidos deixados de fora); Turmas →
turma → Envios (fila do professor com prévia, aprovar/recusar; o envio publicado mostra
"Despublicar da turma" depois da correção); aluno: Envios com status e motivo; Revisar →
Mesclar conjuntos com prévia ("13 cartões no conjunto novo; 17 repetidos ficam de fora") e escolha
de aparência. Resultado: 0 violações axe nas 8 telas depois das correções, sem rolagem horizontal.
