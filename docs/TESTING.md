# Testes e checks

> **Atualização de 21/11/2026.** `npm test` também roda `test:personalization` (layout do Início,
> blocos do perfil, modos de estudo, resumos do Início e idiomas). `npm run test:browser` roda
> ainda `dashboard-home-check.cjs`, `navigation-check.cjs` (links, página atual, menu da conta,
> busca, voltar/avançar), `personalization-check.cjs` (Personalizar o Início, perfil em edição,
> modos de estudo, idioma, temas) e `feature-validation-check.cjs` (planejamento, ICS, anotações,
> falha de uma ferramenta). As verificações de navegador compartilham a API simulada de
> `frontend/tests/support/mock-app.cjs`, que inclui uma tabela `profile_state` em memória (troca de
> conta, falha de rede, cópia mais nova de outro aparelho). Matriz de validação dos recursos:
> [VALIDACAO_RECURSOS.md](VALIDACAO_RECURSOS.md).

> **Situação em 20/11/2026.** `npm test` roda backend (PGlite + fixtures), DOM, interfaces de cada
> recurso (`test:catalog-ui`, `test:planning-ui`, `test:quiz-v2-ui`, `test:flashcards-ui`,
> `test:player-v2`, `test:study-tracking`, `test:learning-tools`, `test:study-authoring`,
> `test:auth-css`), Python e qualidade. `npm run test:browser` roda três verificações com Chromium:
> `browser-check.cjs` (jornadas, FFmpeg real, axe), `subject-menu-check.cjs` (menu ⋯ das
> disciplinas) e `password-signup-check.cjs` (regras e senhas vazadas). Fora do contêiner de CI,
> indique o navegador com `BROWSER_EXECUTABLE`. Falhas conhecidas: o teste de recorte de **AAC** em
> `media.test.js` depende da versão do FFmpeg, e `check:openapi` não roda porque o arquivo OpenAPI
> não está no repositório (a referência de rotas atual é [API.md](API.md)). Os links para
> `gates-readiness.md`, `e01-issues.md` e `testing-contract.md` abaixo apontam para arquivos que não
> foram publicados.


Execute a partir da raiz após [SETUP.md](SETUP.md). Os comandos normais não precisam de credenciais. Use dados sintéticos; não importar .env da instalação para a suíte de fixtures.

> **Política enxuta da etapa 1 (04/11/2026):** `npm run check` não executa `format:check` até a dívida de formatação herdada ser resolvida. A checagem Prettier/Ruff continua disponível separadamente por `npm run format:check`, mas não bloqueia o CI por estilos antigos e não demanda Docker. Testes de lint, sintaxe, segredos e regressões continuam obrigatórios. O validador OpenAPI foi também retirado do check padrão porque o arquivo `docs/engineering/AudioEstudo_openapi.yaml` não foi incluído na versão publicada; `npm run check:openapi` continua disponível para quando o contrato for recuperado ou reconstruído com evidência. Não interpretar CI verde como aprovação de integrações reais ou gates E00–E02.

Preparação dos gates antes da E03: [gates-readiness.md](implementation-2.0/gates-readiness.md). Os novos testes de guards/RLS em `scripts/tests/` entram nos comandos locais existentes. `staging-academic-check.mjs` e `staging-concurrency.py` são ensaios de **escrita** exclusivamente em staging autorizado, separados do probe E01 de leitura; não são chamados por CI ou `npm test`. Nenhuma execução real é aprovada apenas por existir uma variável de ambiente.

| Comando                  | O que verifica                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| npm run lint             | ESLint Node/browser e Ruff Python                                                                              |
| npm run format:check     | Prettier de arquivos novos/alterados; legado idêntico por hash é desvio explícito; Ruff de todo Python próprio |
| npm run format           | Formata arquivos próprios; é uma ação explícita e pode produzir um diff amplo do legado                        |
| npm run check:syntax     | Sintaxe JS, imports locais, assets/CSS, IDs e ordem theme-init                                                 |
| npm run check:openapi    | Especificação 3.1, refs locais, paridade de rotas, flags, UUID e campos legados                                |
| npm run check:secrets    | Fonte rastreada por Git ou pacote seguro; só paths/categorias, nunca conteúdo encontrado                       |
| npm run test:backend     | Testes Node: regras, FFmpeg, ownership A/B, contratos, flags e PostgreSQL E02 embutido                         |
| npm run test:dom         | DOM de páginas e preferências iniciais em jsdom; sem login real                                                |
| npm run test:python      | Auditor de distribuição e adaptador ASR com modelos/providers falsos                                           |
| npm run test:quality     | Regressão da política de formatação e bloqueio dos checks remotos                                              |
| npm test                 | Backend, DOM, Python e ferramentas                                                                             |
| npm run check            | Lint, sintaxe, segredos e npm test (formatacao/OpenAPI opcionais nesta etapa)                                                         |
| npm run test:browser     | Jornadas Chromium existentes, FFmpeg e axe com APIs/Auth simulados                                             |
| npm run test:integration | Apenas staging explicitamente autorizado; sem configuração aprovada falha antes de fetch                       |

Backend/tests/rules.test.js e media.test.js preservam seus cenários/assertions; testes existentes de navegador continuam. dom-check.cjs estava ausente na revisão 10 e foi acrescentado. O transporte HTTP falso mantém app/controllers/services/repositories/SDK reais: remover um filtro de ownership faz a regressão A/B falhar.

## Limites de evidência

FFmpeg real testa nove formatos e recorte/exportação. Browser cobre temas, biblioteca, perfil, foco, navegação móvel, OAuth simulado e novas questões de áudios antigos. Axe é auxiliar; zero violações automáticas não comprova teste com NVDA ou outra tecnologia assistiva. DOM não substitui o navegador.

Fixtures HTTP não comprovam RLS/transações no banco remoto. Os testes ASR verificam conversão de chunks/tempo e rejeição de entrada, sem inferência real. Não há cobertura percentual medida nem promessa de ausência de bugs.

## Formatter incremental

quality/format-baseline.json registra somente hashes de arquivos já existentes fora do estilo antes da E01. `format:check` mostra a lista de débitos, ligada à issue E01-001. Arquivo novo fora do estilo ou arquivo legado alterado sem formatação falha. CI nunca recria essa baseline; não adicionar exceções para esconder regressões. Ao formatar um arquivo, o hash antigo deixa de dispensá-lo. Evidências históricas, bins, bundles de terceiros, lockfiles e .env são excluídos.

Use Prettier diretamente para um diff pontual: `npx prettier --write caminho/do/arquivo.js`. Execute novamente check e testes afetados. Separe o diff de formatter do diff funcional; a evidência E01 inclui os dois sem fabricar commits Git.

## CI local e remoto

.github/workflows/quality.yml roda em push/PR com npm ci dos três lockfiles, Python 3.12, ferramentas fixadas, FFmpeg do sistema, Chromium e dados falsos. Não lê secrets nem usa pull_request_target. Actions estão fixadas por SHA; permissões contents: read e checkout sem persistir credenciais.

.github/workflows/staging-readonly.yml é manual e separado. Exige a frase de autorização e environment staging-readonly, que o responsável deve configurar com revisores e acesso a secrets. Isso não foi configurado remotamente nesta entrega. Nomear um environment no YAML sozinho não instala a proteção.

O probe remoto exige E01_REMOTE_READS_APPROVED, E01_STAGING_PROJECT_REF, E01_API_URL, E01_PUBLISHABLE_KEY, E01_USER_A_TOKEN, E01_USER_B_TOKEN, E01_MATERIAL_A_ID e E01_JOB_A_ID. Rejeita o projeto existente auditado e chaves administrativas. Confirma tenant/configuração, API própria 200, UUID de A consultado por B 404, assinatura Storage cruzada negada e TTL de URL fria. Usa fixture de mídia autorizada, registra apenas status e não enfileira geração, cria dados, migra ou apaga arquivos. Assinatura gera token transitório; leituras consomem quota.

A expiração usa cacheNonce e uma URL nunca aquecida: TTL do token e cache CDN não são a mesma coisa. ASR/Groq reais não têm execução ordinária nem job que faça chamadas pagas automaticamente; qualquer suíte futura deve entrar em workflow manual separado com autorização/limites, secrets de staging e evidência própria.

## Registrar resultado e falha

Salvar comando, UTC, ambiente, status de saída, escopo de mocks, base/hash e evidência sanitizada. Checks estáticos não atualizam os arquivos E00; opcionalmente passe o destino da nova evidência ao static-check.py. Falha residual deve ter issue local/remota, motivo, prioridade, dono e critério de fechamento. Ver [e01-issues.md](implementation-2.0/e01-issues.md) e [testing-contract.md](implementation-2.0/testing-contract.md).

## E02 — SQL, worker e revisão humana

```sh
node --test backend/tests/academic.test.js
node --test --test-concurrency=1 backend/tests/academic-flow.test.js backend/tests/initial-flow.test.js backend/tests/rpc.test.js
```

`academic-db.fixture.js` carrega a baseline histórica e a migration E02 em PGlite 0.5.8 / PostgreSQL 18.3, com contas/segmentos sintéticos. Exercita transações, constraints, grants e RLS por role; conferência, edição/restauração, fonte congelada, idempotência e rollback de resumo/lote. O teste de mudança de declaração usa uma função constante apenas no banco de teste e fecha a instância ao terminar.

A fixture HTTP conserva Express, services, repositories e SDK Supabase reais. RPCs e updates usados pelo worker executam no banco embutido; transporte Auth/Storage/Groq é falso. O fluxo inicial usa ASR mock, bytes sintéticos, persistência real de snapshot, cleanup com falha/retry e bloqueio de derivados até confirmação. As gerações usam respostas estruturadas falsas e não acessam nenhum provedor real. Avisos inválidos/indisponíveis falham por tipo, sem selo de veracidade. O transporte simula resposta perdida após commit: o retry recupera o derivado sem duplicar nem chamar o LLM. `rpc.test.js` verifica falhas transitórias de HTTP/SQLSTATE e que schema/permissão continuam fail-closed. Os logs do loop do worker exibem somente código seguro.

PGlite usa uma conexão. `Promise.all` submete operações, mas elas são serializadas; não constitui ensaio de locks de duas conexões. O projeto remoto inspecionado usa PostgreSQL 17.6. G1 exige validação nativa/staging, A/B/Storage/TTL reais e backup/restore. O [runbook](implementation-2.0/02-review-migration-runbook.md) descreve o ensaio de múltiplas sessões/worker; não foi executado. Zero conteúdo integral de gravação ou erro bruto de provedor deve entrar em logs.

Os checks pre/postflight em `database/checks/` são leitura, sem textos/IDs pessoais. A suíte SQL executa e valida esses arquivos no ambiente descartável. Sem autorização, `npm run test:integration` continua bloqueado antes de fetch; seu escopo E01 é somente leitura e assinatura transitória, não aplicação de migration ou teste de geração remoto.

Capturas E02: `upload-review-desktop.png`, `confirmation-awaiting-desktop.png`, `warnings-desktop.png`. Axe/reflow/teclado rodam no roteiro existente; leitores de tela reais continuam pendentes. Logs e hashes da E01 não são substituídos; resultados E02 ficam em `implementation-2.0/e02/evidence/`.
