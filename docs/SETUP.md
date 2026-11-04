# Preparação do ambiente

> **Situação em 04/11/2026:** o desenvolvimento corrente está no repositório privado `cathcherry/VozEmEstudo`, na branch `main`. O projeto Supabase existente recebeu a migration E02 segundo o histórico de operação informado pela responsável; o estado remoto não foi reinspecionado nesta etapa. Não reaplique a migration nem a baseline `001_initial.sql`. As observações E00/E01 abaixo preservam o contexto técnico e histórico de 09/10/2026.

## Fluxo recomendado sem Docker

Para contribuições: GitHub Desktop para atualizar o checkout e GitHub Actions para testes de código. Mudanças de banco serão preparadas como SQL aditivo e somente aplicadas via Supabase Dashboard após conferir ambiente e backup. **Nenhuma instalação de Docker, PostgreSQL ou Supabase CLI é exigida para a etapa 1.** O roteiro local abaixo é opcional e serve para quem precisar executar o produto.

## Editar e apresentar sem Docker

Para abrir as telas atuais com dados fictícios, consulte [Apresentação local](../APRESENTACAO.md). Execute `node scripts/presentation/server.mjs` na raiz e abra http://127.0.0.1:3000. Sem instalação de dependências para a navegação básica; sem conexão com Supabase. O modo integrado abaixo continua dependendo dos gates e da configuração do ambiente.

Base desta etapa: pacote corrente E01, revisão 12; mudanças locais E02 exigem migration aditiva antes de usar as rotas acadêmicas. Extraia a raiz AudioEstudo/ ou use o checkout mais recente; o ZIP de 07/10 é referência histórica. Não sobreponha arquivos .env pessoais nem reaplique o SQL inicial em banco existente.

## Versões

| Componente          | Seleção E01                 | Situação                                                   |
| ------------------- | --------------------------- | ---------------------------------------------------------- |
| Node                | 24.19.0                     | Referência local/CI; ferramentas requerem >=22.19.0        |
| npm                 | 11.9.0                      | packageManager e lockfiles; três instalações independentes |
| Python              | 3.12                        | Referência de lint/testes; target Ruff py310               |
| ESLint / @eslint/js | 10.12.0 / 10.0.1            | Configuração flat Node/browser                             |
| Prettier            | 3.9.9                       | Uma configuração e baseline legada por hash                |
| Ruff                | 0.16.10                     | requirements-dev.txt; lint e formatter                     |
| PGlite (somente QA) | 0.5.8 / PostgreSQL 18.3     | Banco embutido descartável; não é o banco do produto       |
| OpenAPI parser      | 13.1.0                      | Validação 3.1 sem refs remotos                             |
| FFmpeg / FFprobe    | Sistema ou packages legados | Local validado com 6.1.1; paths opcionais                  |
| Playwright / axe    | 1.62.1 / 4.14.0             | Preservados; Chromium instalado separadamente              |

O backend legado declara engines >=20, mas @supabase/supabase-js 2.112.3 exige >=22; isso está rastreado em E01-007. O ambiente de ferramentas requer >=22.19 e a referência completa testada é Node 24.19. Não considerar Node 20 homologado.

Essas são seleções técnicas verificáveis desta entrega, sujeitas à confirmação da equipe para o ambiente de desenvolvimento. Não mudar versões do SDK/backend nem adotar framework para satisfazer ferramentas.

## Instalar ferramentas e dependências

Na raiz, com Node e Python disponíveis:

```sh
npm ci
npm ci --prefix backend
npm ci --prefix frontend
python -m venv .venv
```

Ative .venv antes de instalar Python. No Linux/macOS: `source .venv/bin/activate`. No PowerShell: `.\.venv\Scripts\Activate.ps1`. Em seguida:

```sh
python -m pip install -r requirements-dev.txt
npm run check
```

O npm da raiz instala apenas ferramentas de qualidade. O backend/frontend mantêm seus próprios package.json/lockfiles; não há workspaces nem mudança de arquitetura. CI usa npm ci --ignore-scripts e FFmpeg do sistema para evitar postinstall de binários durante checks. Essa alternativa exige FFmpeg/FFprobe instalados e paths corretos; não significa que conversão funciona sem os executáveis.

Para jornadas de navegador:

```sh
cd frontend
npx playwright install chromium
cd ..
npm run test:browser
```

Quando necessário, defina FFMPEG_PATH e FFPROBE_PATH com os paths reais. No PowerShell: `$env:FFMPEG_PATH = 'C:\caminho\ffmpeg.exe'` e `$env:FFPROBE_PATH = 'C:\caminho\ffprobe.exe'`. No POSIX, use export. BROWSER_EXECUTABLE é opcional para Chromium já instalado. Não versionar esses binários.

## Executar o produto

Copie backend/.env.example para backend/.env somente na instalação local e preencha valores privados. Nunca use o template como credencial de produção nem cole valores em logs/relatórios.

```sh
npm --prefix backend start
```

Em outro terminal:

```sh
npm --prefix backend run worker
```

Abra http://localhost:3000. O Express serve o frontend; não abrir páginas por file://. Sem configuração Supabase válida, health/páginas públicas funcionam, mas login, biblioteca remota e worker não são um demo totalmente offline. Os testes normais usam adapters de transporte falsos e não precisam de .env.

## Configuração por nomes

Servidor: NODE_ENV, PORT, APP_ORIGIN, SERVE_FRONTEND. Supabase: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SUPABASE_AUDIO_BUCKET, OAUTH_PROVIDERS. Mídia: FFMPEG_PATH, FFPROBE_PATH.

ASR/LLM: GROQ_API_KEY, GROQ_MODEL, HF_TOKEN, HF_ASR_SPACE_ID, HF_ASR_API_NAME, HF_ASR_AUDIO_FIELD, HF_ASR_TASK_FIELD, HF_ASR_TASK_VALUE, HF_ASR_RETURNS_SEGMENTS. Fila: WORKER_ID, WORKER_POLL_MS, WORKER_CONCURRENCY, JOB_MAX_ATTEMPTS, JOB_RETRY_DELAY_1_MS, JOB_RETRY_DELAY_2_MS. MOCK_EXTERNAL_SERVICES simula apenas ASR/LLM.

Flags futuras: FEATURE_CATALOG_UNITS, FEATURE_PLANNING, FEATURE_MP4_RETENTION, FEATURE_STUDY_TRACKING, FEATURE_QUIZ_V2, FEATURE_FLASHCARDS, FEATURE_SOCIAL_BASIC, FEATURE_SHARING. Todas OFF no template; somente a string exata true ativa a flag no servidor. Não são permissões nem implementação da feature. Browser aceita somente valores boolean true de /api/config; configuração antiga sem flags mantém todas OFF.

## ASR e ambiente remoto

Ruff/testes usam apenas requirements-dev.txt e módulos falsos: nenhum modelo, GPU ou Space é iniciado. asr-space/requirements.txt contém dependências de inferência ainda não travadas em versões; a homologação desse runtime é um desvio separado, com dono e prioridade no [registro de desvios](implementation-2.0/e01-issues.md). Não alegar inferência real aprovada.

O projeto Supabase existente não foi classificado como staging. Provisionamento, grants/Auth, backups, restore, migrations e rotação precisam de autorização específica. Ver [runbook E00](implementation-2.0/01-staging-backup.md). A E01 não executa migrations nem publica CI em repositório remoto por conta própria.

## Schema acadêmico E02

A migration `database/migrations/20261009101846_academic_review.sql` foi testada apenas em banco local descartável. Em Supabase existente, não aplicar `001_initial.sql` nem executar reset/push cegamente: o histórico lido está vazio apesar de haver schema. Siga o [runbook E02](implementation-2.0/02-review-migration-runbook.md), com aprovação de staging, backup/restore, contagens e janela.

API, worker e frontend E02 precisam do mesmo schema; sem RPCs, comandos acadêmicos ficam bloqueados. Não há nova variável secreta, nova flag de bypass nem alteração dos oito defaults OFF. A versão da declaração deriva do texto em `config/permission-declaration.js` e é fixada na migration; mudança de texto exige atualização coordenada do contrato SQL e nova confirmação. Não editar a migration já aplicada em um ambiente futuro; criar outra aditiva.

`npm ci` na raiz instala PGlite como ferramenta de testes; o backend em execução não importa PGlite e mantém suas dependências. A suíte não precisa de Docker/Postgres/ASR/Groq reais. Ela remove somente a declaração de extensão pgcrypto da cópia em memória da baseline para usar `gen_random_uuid` nativo, com Auth/Storage sintéticos. Esse ajuste não altera o SQL 001 distribuído.
