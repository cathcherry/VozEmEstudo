# Testes e verificações

Todos os comandos rodam a partir da raiz do projeto, com dados sintéticos: não precisam de chaves,
do Supabase real nem dos provedores de IA.

## Preparar

```bash
npm ci && npm ci --prefix backend && npm ci --prefix frontend
```

```bash
python -m pip install -r requirements-dev.txt
```

O Python (3.12) instala o Ruff, usado por `npm run lint` e pelos testes em Python. Os testes de
navegador precisam do Chromium: `npx --prefix frontend playwright install chromium`, ou defina
`BROWSER_EXECUTABLE` com o caminho de um Chrome/Chromium já instalado.

## Comandos

| Comando                    | O que verifica                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm test`                 | Tudo abaixo que não precisa de navegador: backend, DOM, interfaces de cada recurso, Python e qualidade     |
| `npm run test:backend`     | Regras, rotas, permissões entre duas contas, migrations e RLS em PostgreSQL embutido (PGlite), FFmpeg real |
| `npm run test:dom`         | Páginas e preferências iniciais em jsdom                                                                   |
| `npm run test:browser`     | Jornadas completas no Chromium com API simulada, FFmpeg real e auditoria de acessibilidade (axe)           |
| `npm run lint`             | ESLint (Node e navegador) e Ruff (Python)                                                                  |
| `npm run format:check`     | Prettier nos arquivos novos ou alterados e Ruff no Python                                                  |
| `npm run check:syntax`     | Sintaxe JS, imports locais, assets, IDs e ordem do `theme-init`                                            |
| `npm run check:secrets`    | Procura chaves e segredos nos arquivos versionados (mostra só caminho e categoria)                         |
| `npm run check`            | Lint, sintaxe, CI, segredos e `npm test` (o mesmo que o GitHub Actions roda)                               |
| `npm run test:integration` | Só contra um staging autorizado; sem a configuração aprovada, falha antes de qualquer acesso à rede        |

`npm test` leva alguns minutos; `npm run test:browser`, cerca de 25.

## Integração contínua

`.github/workflows/quality.yml` roda em cada push e pull request: instala as dependências fixadas,
FFmpeg e Chromium, executa `npm run check` e `npm run test:browser` e audita o pacote de
distribuição. Não lê segredos. Os workflows `staging-readonly.yml` e `staging-browser-auth.yml`
são manuais e só rodam contra o staging com autorização explícita.

## O que os testes não comprovam

- As verificações de navegador usam uma API simulada (`frontend/tests/support/mock-app.cjs`); não
  substituem o teste com login real ([PAINEL_TESTE_MANUAL.md](PAINEL_TESTE_MANUAL.md)).
- Os provedores de IA são falsos nos testes: a qualidade real da transcrição e dos materiais
  gerados não é medida aqui.
- O axe encontra parte dos problemas de acessibilidade; não houve teste com leitores de tela reais
  (NVDA, VoiceOver, TalkBack).
- O PGlite usa uma única conexão: concorrência real entre sessões só é ensaiada no staging.

## Formatação herdada

`quality/format-baseline.json` registra os arquivos antigos que já estavam fora do estilo do
Prettier. `format:check` exige o estilo em arquivos novos ou alterados e tolera os antigos
idênticos ao registrado. Para formatar um arquivo: `npx prettier --write caminho/do/arquivo`.
