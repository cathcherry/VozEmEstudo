# Auditoria de segurança: abertura para teste público (30–100 participantes)

Data: 2026-11-24 · Versão auditada: branch `claude/keen-shannon-sj3ut5` (3.7) · Autor: revisão
automatizada com evidências (código, testes e consultas somente leitura aos dois projetos Supabase).

Este documento é um insumo técnico para a decisão GO/NO-GO. **Não é parecer jurídico** e não
afirma conformidade com a LGPD.

## 1. Escopo

- Backend Node/Express (`backend/src`), worker de IA (AssemblyAI/Groq), front-end estático
  (`frontend/`), migrations (`database/migrations`) e os projetos Supabase:
  - produção `fxsuagrcfargpejglwtl` (audioestudo);
  - staging `cissxpmmjnnpewreuxeo`.
- Áreas: autenticação, autorização/RLS, API, upload/mídia, segredos, privacidade, confiabilidade
  ligada à segurança e guardas do front-end.
- **Fora do escopo de correção** (desenvolvimento paralelo, apenas revisado): cotas/admin/demo
  (`20261125100000_public_testing.sql`, `services/{material,processing,quota,demo,admin}*`,
  `routes/material.routes.js`, controller de geração de cartões, rotas multi-aula, páginas de
  conta/biblioteca). Itens já conhecidos por esse desenvolvedor: `durationMs` enviado pelo navegador
  é confiado hoje, limites de taxa em memória, inexistência de papel de administrador.

## 2. Método

1. Leitura de código: rotas × `requireAuth`, toda consulta `.from(...)` com o cliente de serviço
   (script que lista consultas sem filtro de dono e revisão manual de cada chamador), validadores
   zod, montagem de caminhos de Storage, chamadas a FFmpeg, saídas de log, `innerHTML`/`DOMParser`
   no front-end, redirecionamentos de autenticação.
2. Banco (somente leitura, apenas metadados: nunca conteúdo de usuários): RLS e políticas de todas
   as tabelas de `public`, privilégios de `anon`/`authenticated` em tabelas e funções, funções
   `SECURITY DEFINER` e `search_path`, _default privileges_, buckets e políticas de
   `storage.objects`, esquemas extras, histórico de migrations, contagens agregadas de `auth.users`
   (sem e-mails), advisors de segurança e desempenho.
3. Segredos: `scripts/secret-check.py`; varredura de todo o histórico git (`git log -p --all`)
   com padrões de chaves Supabase, JWT, Groq, Hugging Face, AssemblyAI, GitHub, chaves privadas e
   URLs de banco com senha — o relatório registra só commit/caminho/categoria.
4. Testes: suíte do backend, ESLint, verificações estáticas, `test:quality`, `test:dom`,
   `browser-check.cjs` (Playwright, mocks) e um novo teste de CSP aplicada em todas as páginas.

## 3. Fatos verificados do ambiente

| Item                                                 | Produção                                                                                                                                                                                                                                                                                          | Staging                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Tabelas em `public`                                  | 64, todas com RLS                                                                                                                                                                                                                                                                                 | 64, todas com RLS                            |
| Tabelas legíveis por `anon`                          | 0                                                                                                                                                                                                                                                                                                 | 0                                            |
| Tabelas legíveis por `authenticated`                 | 4: `profile_state` (+ escrita), `content_warnings`, `material_permissions`, `transcription_confirmations` — todas com política "somente o dono"                                                                                                                                                   | igual                                        |
| Demais tabelas                                       | sem privilégio para os papéis do navegador; acesso só pela API (service role)                                                                                                                                                                                                                     | igual                                        |
| Funções executáveis por `anon`                       | só `set_updated_at` (função de gatilho, inofensiva)                                                                                                                                                                                                                                               | igual                                        |
| Funções executáveis por `authenticated`              | `set_updated_at`, `storage_owns_material` (`SECURITY DEFINER`, `search_path=''`, só responde "esta aula é minha?")                                                                                                                                                                                | igual                                        |
| Funções `*_admin`                                    | nenhuma executável por `anon`/`authenticated`                                                                                                                                                                                                                                                     | igual                                        |
| _Default privileges_ de funções (postgres, `public`) | sem `EXECUTE` para PUBLIC/anon/authenticated (novas funções nascem fechadas)                                                                                                                                                                                                                      | —                                            |
| Privilégios residuais                                | `anon`/`authenticated` com TRUNCATE/REFERENCES/TRIGGER em 10 tabelas (não alcançáveis pelo PostgREST)                                                                                                                                                                                             | 20 concessões de TRUNCATE                    |
| Buckets                                              | todos privados: `audios` (100 MB; áudio + `video/mp4`), `study-videos` (100 MB, mp4), `profile-media` (8 MB, imagens), `flashcard-media` (2 MB, imagens)                                                                                                                                          | iguais, exceto `audios` sem `video/mp4`      |
| Políticas de Storage                                 | `audios`: inserir só em `temp/<próprio id>/`, ler/apagar só objetos próprios (`owner_id`); sem UPDATE (não há sobrescrita). `study-videos`: inserir/ler só `original/<próprio id>/<aula própria>/source.mp4`. `profile-media`: pasta do próprio id. `flashcard-media`: sem política (só servidor) | iguais                                       |
| Esquemas de backup                                   | `backup_pre_3_4_20261121`, `backup_pre_discoveries_20261122`, `backup_pre_journals_20261122` (cópias completas de dados de usuários, RLS desligado, **sem** USAGE para anon/authenticated) e `release_tmp` com função auxiliar                                                                    | `qa` com função auxiliar                     |
| Histórico de migrations                              | `rls_performance` não aplicada (decisão registrada); tabelas de `journals` existem mas a migration não aparece no histórico (deriva de registro)                                                                                                                                                  | 33 migrations registradas                    |
| Contas (agregado)                                    | 4 contas, 0 não confirmadas, 0 anônimas; provedores email, github, google; 0 fatores MFA                                                                                                                                                                                                          | 13 contas, 2 não confirmadas, provedor email |
| Advisor de segurança                                 | 33× "RLS sem política" (INFO, intencional: acesso só pela API); `storage_owns_material` executável por authenticated (WARN); `release_tmp.apply_git_migration` com `search_path` mutável (WARN); **proteção contra senhas vazadas desligada** (WARN)                                              | iguais (função auxiliar em `qa`)             |
| Advisor de desempenho                                | 13 políticas `auth_rls_initplan` (corrigidas pela migration candidata `rls_performance`), 73 FKs sem índice (INFO), 154 tabelas sem PK (quase todas nos backups), 50 índices não usados                                                                                                           | —                                            |

Links de remediação dos advisors:
[0008 RLS sem política](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) ·
[0011 search_path mutável](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) ·
[0029 SECURITY DEFINER executável por authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) ·
[Senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) ·
[0003 auth_rls_initplan](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan) ·
[0001 FK sem índice](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

### O que NÃO pôde ser verificado (e por quê)

Configurações do Supabase Auth ficam no painel/API de gerenciamento, não em tabelas legíveis por
SQL. Não foram verificados, e **devem ser conferidos manualmente no painel antes do GO**:

- **Confirm email** ligado (indício: os usuários de e-mail de produção têm `confirmation_sent_at`;
  não é prova). O backend agora recusa contas de e-mail não confirmadas de qualquer forma (A-01).
- **SMTP próprio**: com o SMTP embutido do Supabase o envio de e-mails é limitado a poucas
  mensagens por hora — insuficiente para 30–100 cadastros/recuperações de senha.
- Limites de taxa do Auth (cadastro, login, OTP, verificação), CAPTCHA (hCaptcha/Turnstile),
  tamanho mínimo/complexidade de senha, expiração do JWT e do refresh token, "sessões únicas".
- **Site URL e lista de Redirect URLs** (impede que `redirectTo` aponte para domínios externos).
- Provedores OAuth: domínios de callback e escopos no Google/GitHub.
- Proteção contra senhas vazadas: o advisor confirma que está **desligada** nos dois projetos.
- Hospedagem (Railway): variáveis reais (`NODE_ENV`, `APP_ORIGIN`, `CONTENT_SECURITY_POLICY`,
  `MOCK_EXTERNAL_SERVICES`), HTTPS, número de instâncias e de saltos de proxy.
- Retenção e exclusão de dados nos provedores (AssemblyAI, Groq, Hugging Face) — depende de
  contrato/configuração das contas.
- Os testes Playwright usam mocks; não houve teste ponta a ponta contra o Supabase real nesta
  auditoria (há roteiros em `docs/STAGING_E2E.md`).

## 4. Achados

Severidade: **Crítica** (exploração direta de dados de terceiros), **Alta** (risco real para um
teste público), **Média** (defesa em profundidade/abuso/privacidade), **Baixa** (higiene).
Nenhum achado crítico foi encontrado.

| ID   | Sev.  | Achado                                                                                                                                                                                              | Evidência                                                                                                                                              | Impacto                                                                                                                                       | Correção / estado                                                                                                                                                                                                                                                                                                           |
| ---- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-01 | Alta  | API aceitava qualquer token válido, inclusive de conta de e-mail **não confirmada** ou de login anônimo, dependendo só do painel do Auth                                                            | `backend/src/integrations/supabase/auth-client.js` (antes: só `getUser`)                                                                               | Se "Confirm email" ou "anonymous sign-ins" fossem ligados/desligados por engano, contas descartáveis usariam a API paga sem prova de e-mail   | **Corrigido**: `isAllowedUser` (l. 39) recusa `is_anonymous` e provedor `email` sem `email_confirmed_at` no modo `server`; no modo `jwks` recusa anônimos (a confirmação não é claim). Testes em `backend/tests/auth-verify.test.js`                                                                                        |
| A-02 | Alta  | CSP **desligada por padrão**, inclusive em produção                                                                                                                                                 | `backend/src/config/env.js` (antes: `'off'` se a variável não existisse); `.env.example` trazia `CONTENT_SECURITY_POLICY=off`                          | Sem CSP, qualquer XSS futuro rouba a sessão (o token fica no `localStorage`)                                                                  | **Corrigido**: `cspMode` (env.js l. 28) aplica `enforce` quando `NODE_ENV=production` e a variável está vazia; `.env.example` deixa vazio; aviso no log se produção sobe sem `enforce`. Testes: `backend/tests/security-headers.test.js` e `frontend/tests/csp-enforce-check.cjs` (33 páginas, 0 violações)                 |
| A-03 | Alta  | Ligar a CSP quebraria em silêncio a checagem de senhas vazadas (HIBP) e o redirecionamento de `leitura.html`                                                                                        | `frontend/js/utils/password-policy.js:47` (fetch a `api.pwnedpasswords.com`, ausente de `connect-src`); script inline em `frontend/pages/leitura.html` | A checagem falha "aberta" (aceita senha vazada)                                                                                               | **Corrigido**: `connect-src` inclui `https://api.pwnedpasswords.com` (app.js l. 55); redirecionamento movido para `frontend/js/utils/reading-redirect.js`                                                                                                                                                                   |
| A-04 | Alta  | **Proteção contra senhas vazadas do Supabase desligada** e ausência de CAPTCHA/limites próprios de cadastro                                                                                         | advisor `auth_leaked_password_protection` (prod e staging); nenhum `captchaToken` no front-end                                                         | Cadastro em massa/credential stuffing limitados só aos padrões do Supabase; a checagem HIBP do front-end é contornável chamando o Auth direto | **Aberto (painel)**: ligar _Leaked password protection_, configurar CAPTCHA (Turnstile/hCaptcha) e revisar limites de taxa do Auth; para 30–100 pessoas, alternativa aceitável é cadastro só por convite/lista                                                                                                              |
| A-05 | Alta  | Sem caminho de **exclusão de conta/exportação de dados** nem contato para pedidos de titulares; página de privacidade sem controlador, base legal, transferência internacional, retenção e direitos | `frontend/pages/privacidade.html` (seções "O que é enviado"/"Serviços externos"); nenhuma rota de exclusão em `backend/src`                            | Participantes não conseguem exercer direitos; risco de confiança/regulatório no teste                                                         | **Aberto**: ver seção 6 (texto mínimo e processo manual documentado antes do GO)                                                                                                                                                                                                                                            |
| A-06 | Média | **Backups com dados pessoais completos** dentro do banco de produção (3 esquemas, RLS desligado)                                                                                                    | consulta a `pg_namespace`/`pg_class` (seção 3)                                                                                                         | Não expostos à API (sem USAGE), mas exclusões de usuários não chegam a essas cópias; aumentam o impacto de um vazamento de credencial         | **Aberto (operação)**: após validar as versões, exportar para armazenamento cifrado fora do banco ou `drop schema … cascade` com data registrada; definir prazo de retenção                                                                                                                                                 |
| A-07 | Média | Áudio e transcrições ficam retidos na **AssemblyAI** após o processamento                                                                                                                           | `backend/src/integrations/asr/assemblyai.client.js` (upload `/v2/upload` e transcrição; nenhum `DELETE /v2/transcript/{id}`)                           | Dados de voz de participantes permanecem num terceiro (EUA) sem prazo controlado pelo app                                                     | **Proposto** (arquivo do outro desenvolvedor: `processing.service.js`): chamar `DELETE /v2/transcript/{id}` após gravar a transcrição; documentar retenção da Groq/HF                                                                                                                                                       |
| A-08 | Média | Endpoints públicos de links compartilhados sem limite                                                                                                                                               | `app.js` `/api/shared-material`, `/api/shared-question-list`                                                                                           | Tokens têm 256 bits (adivinhação inviável), mas qualquer um gera carga no banco sem autenticação                                              | **Corrigido**: `limitPerAddress` (30/min por endereço; `RATE_LIMIT_PUBLIC_SHARES_PER_MINUTE`), `TRUST_PROXY` para obter o IP real atrás do proxy                                                                                                                                                                            |
| A-09 | Média | Uploads de mídia ficavam inteiros na memória antes da checagem de concorrência                                                                                                                      | `backend/src/routes/media.routes.js` (`express.raw` 100 MB) + `media.service.js` (`active >= 2` só depois do corpo lido)                               | Poucas contas enviando em paralelo esgotam a RAM da instância (indisponibilidade para todos)                                                  | **Corrigido**: `limitInflight` (máx. 3 uploads simultâneos por processo, antes de ler o corpo; 429 com `Retry-After`). Recomenda-se ainda gravar o corpo em disco em vez de memória                                                                                                                                         |
| A-10 | Média | Limites de custo em memória por processo; `durationMs` vindo do navegador                                                                                                                           | `middleware/rate-limit.middleware.js`; `validators/material.validator.js:19`                                                                           | Cotas reiniciam com a instância; duração declarada pode ser falsificada                                                                       | **Em andamento** (outro desenvolvedor: `usage_ledger`/`testing_reserve_admin`). Condição do GO: cota no banco ativa e duração medida no servidor (ffprobe) antes de enviar ao ASR                                                                                                                                           |
| A-11 | Média | Log aceitava `x-request-id` arbitrário e não tinha redação de campos sensíveis; erros 500 não registravam a causa                                                                                   | `middleware/request-id.middleware.js`, `utils/logger.js`, `middleware/error.middleware.js`                                                             | Injeção de conteúdo nos logs; risco de um campo futuro gravar token/e-mail                                                                    | **Corrigido**: id aceito só se `^[A-Za-z0-9._:-]{1,64}$`; `redact()` substitui chaves sensíveis (`authorization`, `*token`, `secret`, `password`, `apiKey`, `email`, `signedUrl`, transcrição…), corta strings longas e reduz `Error` a `{name, code}`; 500 registra só classe/código. Testes em `security-headers.test.js` |
| A-12 | Baixa | `storage_owns_material` (`SECURITY DEFINER`) exposta como `/rest/v1/rpc/…`                                                                                                                          | advisor 0029 (prod/staging)                                                                                                                            | Só responde sobre as próprias aulas; sem vazamento, mas aumenta superfície                                                                    | **Corrigido em migration candidata** `20261125090000_security_hardening_public.sql`: função movida para o esquema `private` (não exposto), políticas de `study-videos` reapontadas, cópia pública removida. Teste PGlite `backend/tests/security-hardening-public-migration.test.js` prova as mesmas respostas antes/depois |
| A-13 | Baixa | TRUNCATE/REFERENCES/TRIGGER para `anon`/`authenticated` em tabelas de `public` (e _default privileges_ que os concedem a tabelas novas)                                                             | `information_schema.role_table_grants`, `pg_default_acl`                                                                                               | Não alcançável pelo PostgREST; TRUNCATE ignora RLS se algum dia houver outro caminho SQL                                                      | **Corrigido na migration candidata** (revoga e ajusta _default privileges_)                                                                                                                                                                                                                                                 |
| A-14 | Baixa | 13 políticas de `001_initial` criadas `to public`                                                                                                                                                   | `pg_policies`                                                                                                                                          | Sem efeito hoje (anon sem privilégio de tabela)                                                                                               | **Corrigido na migration candidata** (`alter policy … to authenticated`). O ganho de desempenho continua na `rls_performance` (não aplicada)                                                                                                                                                                                |
| A-15 | Baixa | Funções auxiliares de release com `search_path` mutável (`release_tmp.apply_git_migration` em prod, `qa.apply_git_migration` em staging)                                                            | advisor 0011                                                                                                                                           | Esquemas sem USAGE para os papéis do navegador; risco baixo                                                                                   | **Aberto (operação)**: remover após o release                                                                                                                                                                                                                                                                               |
| A-16 | Baixa | Deriva do histórico de migrations em produção (tabelas de `journals` presentes sem registro)                                                                                                        | `list_migrations` × catálogo                                                                                                                           | Dificulta auditoria/rollback                                                                                                                  | **Aberto**: registrar a migration aplicada ou documentar                                                                                                                                                                                                                                                                    |
| A-17 | Baixa | Códigos de convite de turma e tokens de compartilhamento são gerados no navegador; o servidor valida só o formato                                                                                   | `frontend/js/api/classroom.api.js:85`, `learning-tools.validator.js:37`                                                                                | O dono pode escolher um código fraco para a própria turma; não afeta terceiros                                                                | Aceito para o teste; opcional: gerar no servidor. Entrada em turma sem limite por conta (60 bits torna adivinhação inviável)                                                                                                                                                                                                |
| A-18 | Baixa | Bucket `audios` de produção aceita `video/mp4` (staging não)                                                                                                                                        | `storage.buckets`                                                                                                                                      | Divergência de configuração; o conteúdo só é usado após validação                                                                             | Alinhar os ambientes                                                                                                                                                                                                                                                                                                        |
| A-19 | Baixa | Dados locais (perfil, cópias) permanecem no navegador após sair                                                                                                                                     | `privacidade.html` informa                                                                                                                             | Computadores compartilhados                                                                                                                   | Já informado; manter o aviso no convite do teste                                                                                                                                                                                                                                                                            |
| A-20 | Baixa | Configurações de produção perigosas só eram documentadas                                                                                                                                            | `env.js`                                                                                                                                               | `MOCK_EXTERNAL_SERVICES=true`, CSP desligada ou `APP_ORIGIN` http/localhost passariam despercebidos                                           | **Corrigido**: `productionConfigWarnings` registra `UNSAFE_PRODUCTION_CONFIG` na subida                                                                                                                                                                                                                                     |

### Verificações sem achado (com evidência)

- **Rotas autenticadas**: todos os routers privados são montados com `requireAuth` em
  `backend/src/app.js`; as únicas rotas públicas são `/api/health`, `/api/config` (só URL e chave
  publicável — `assertPublicSupabaseKey` recusa chave secreta) e as duas de links compartilhados.
- **IDOR**: todas as consultas com o cliente de serviço filtram por `user_id` ou são precedidas de
  `getOwnedMaterial`/`getOwnedJob` (listas sem filtro direto — `listBatches`, `listSummaries`,
  `listWarnings`, `listVersions`, eventos de tarefa, segmentos — só são chamadas após a checagem de
  dono no controller). As RPCs `*_admin` recebem `p_user_id` do token, nunca do corpo.
  `getQuestionForAnswer` confere o dono pela cadeia questão→lista→aula. Teste existente:
  `backend/tests/ownership.test.js` usa um adaptador HTTP que devolve a linha alheia se o filtro sumir.
- **Caminhos de Storage**: `assertSafeStoragePath` recusa `..`, `.`, segmentos vazios, `\`, `?`,
  `#`, `%` e controles; a criação de aula exige o prefixo `temp/<usuário>/<aula>/`
  (`material.service.js`); vídeo exige exatamente `original/<usuário>/<aula>/source.mp4`.
- **FFmpeg/ffprobe**: argumentos em array (`spawn`, sem shell), `-protocol_whitelist file,pipe`
  (impede HLS/HTTP → SSRF), `-format_whitelist`, timeout com `SIGKILL`, limite de saída, diretório
  temporário removido em `finally`, duração máxima de 2 h, `-fs` e reverificação da duração do recorte.
- **SSRF**: o backend só contata hosts fixos (AssemblyAI, gateway LLM, Groq, HF configurados no
  servidor); embeds de YouTube/Spotify são validados por expressão exata e renderizados no navegador.
- **XSS**: nenhum `innerHTML` com dado do usuário (os 20 usos são marcação fixa/ícones); texto rico
  dos cards vira DOM por `textContent`, links só `http(s)`; cards HTML legados vão para
  `<iframe sandbox="">` com CSP própria `default-src 'none'`; links compartilhados levam o token
  no fragmento (`#token=…`, não vai ao servidor nem ao `Referer`) e as respostas públicas usam
  `Cache-Control: no-store`, `Referrer-Policy: no-referrer` e `X-Robots-Tag: noindex`.
- **Redirecionamentos**: `safeDestination` (`frontend/js/utils/auth-redirect.js`) aceita só a
  mesma origem e uma lista fixa de páginas; o callback OAuth usa PKCE e esse mesmo filtro;
  `redirectTo`/`emailRedirectTo` são sempre construídos a partir da origem atual.
- **Tokens de compartilhamento**: 256 bits, só o SHA-256 é guardado, expiração e revogação no
  SQL (`study_resolve_share_admin` exige `revoked_at is null and expires_at > now()`).
- **URLs assinadas**: 600 s para áudio/vídeo, 3600 s para imagens de cartões, sempre após checar o dono.
- **CORS/CSRF**: autenticação por `Authorization: Bearer` (sem cookies), CORS restrito a
  `APP_ORIGIN`, `credentials: false` — CSRF não se aplica. JSON limitado a 2 MB.
- **Mensagens de erro**: erros inesperados devolvem "Ocorreu um erro interno." e `requestId`;
  erros zod listam só caminho/tipo.
- **Sessão**: `getUser` a cada requisição (modo `server`) — sessão revogada para de funcionar
  imediatamente; logout usa `signOut()` (escopo global padrão do supabase-js); recuperação de senha
  troca o código PKCE, exige nova senha e encerra a sessão.
- **Guardas do front-end**: todas as páginas privadas passam por `requireSession` (via `shell.js`);
  as que não passam são públicas por natureza (login, cadastro, recuperação, callback, landing,
  link compartilhado, redirecionamentos, `arte.html` com arte estática). Mesmo sem guarda, nenhum
  dado privado é servido sem token pela API.
- **Segredos**: `secret-check.py` sem achados; histórico git (321 commits) sem segredos reais —
  apenas valores sintéticos de teste marcados como _fixture_ em `backend/tests/contracts.test.js`
  (0617a8b), `backend/tests/classroom-contributions-http.test.js` (8dc2196) e
  `backend/tests/multi-lesson-worker.test.js` (c0d4c97); nenhum `.env` versionado; o front-end só
  recebe URL e chave publicável via `/api/config`.
- **Worker**: reivindicação com _lease_ e recuperação de tarefas órfãs (`claim_next_processing_job`
  com `p_stale_after_seconds`), tentativas limitadas (`JOB_MAX_ATTEMPTS=3`), a transcrição paga não
  é reenviada ao recomeçar (estado externo guardado; `findSubmission`), testes em
  `job-lease.test.js` e `async-transcription.test.js`.

### Revisão da migration paralela `20261125100000_public_testing.sql` (sem edição)

Pontos positivos: tabelas novas com RLS e `revoke all` de `public/anon/authenticated`; todas as
funções `*_admin` executáveis só por `service_role`; única `SECURITY DEFINER`
(`testing_account_created_at`) com `search_path=''` e restrita ao servidor; política de Storage
`RESTRICTIVE` (só estreita). Observações:

1. O teto de 40 objetos em `audios` conta com `count(*)` dentro da política: inserções simultâneas
   podem ultrapassar o teto (condição de corrida) — aceitável como teto aproximado; o limite real
   deve estar na reserva de cota no servidor.
2. As cotas devem medir a duração no servidor (ffprobe do objeto em Storage) antes de reservar,
   não a partir de `durationMs` do cliente (A-10).
3. Cotas e papéis de administrador **não** devem ler `profile_state`, que é gravável pelo próprio
   usuário via PostgREST (verificado: `authenticated` tem INSERT/UPDATE com política "dono").
4. A ordem das migrations é compatível: a de hardening (`…090000`) roda antes e não toca nas
   tabelas novas.

## 5. Correções feitas nesta auditoria

| Arquivo                                                                                                                                                 | Mudança                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/src/integrations/supabase/auth-client.js`                                                                                                      | `isAllowedUser`: recusa anônimos e e-mail não confirmado (A-01)                                                                                                                                  |
| `backend/src/config/env.js`, `backend/.env.example`, `docs/HOSPEDAGEM.md`                                                                               | CSP `enforce` por padrão em produção; `TRUST_PROXY`; `RATE_LIMIT_PUBLIC_SHARES_PER_MINUTE`; `productionConfigWarnings` (A-02, A-08, A-20)                                                        |
| `backend/src/app.js`                                                                                                                                    | `connect-src` com HIBP; limite por endereço nas rotas públicas; `trust proxy` configurável (A-03, A-08)                                                                                          |
| `backend/src/middleware/public-rate-limit.middleware.js`                                                                                                | novo limitador por endereço                                                                                                                                                                      |
| `backend/src/routes/media.routes.js`                                                                                                                    | `limitInflight` antes de ler o corpo (A-09)                                                                                                                                                      |
| `backend/src/middleware/request-id.middleware.js`, `backend/src/utils/logger.js`, `backend/src/middleware/error.middleware.js`, `backend/src/server.js` | id seguro, redação de logs, causa de 500 sem mensagem bruta, aviso de configuração (A-11, A-20)                                                                                                  |
| `frontend/pages/leitura.html`, `frontend/js/utils/reading-redirect.js`                                                                                  | redirecionamento sem script inline (A-03)                                                                                                                                                        |
| `database/migrations/20261125090000_security_hardening_public.sql`                                                                                      | **candidata, não aplicada** (A-12, A-13, A-14)                                                                                                                                                   |
| Testes                                                                                                                                                  | `backend/tests/security-headers.test.js`, `backend/tests/security-hardening-public-migration.test.js`, `backend/tests/auth-verify.test.js` (novos casos), `frontend/tests/csp-enforce-check.cjs` |

Aplicação da migration candidata: rodar primeiro no staging, conferir upload/leitura de MP4
original e o advisor (o aviso 0029 deve sumir), depois produção. Não altera dados.

## 6. Privacidade e LGPD (o que falta para um teste público)

Já existe: explicação do envio de áudio a reconhecimento de fala e do texto a IA, provedores
listados com links, declaração de permissão por envio, opção de não conservar o áudio, aviso sobre
cópia local no navegador e sobre conteúdo gerado poder conter erros.

Falta (recomendação, sem afirmar conformidade):

1. **Identificação do responsável e canal de contato** (e-mail) para dúvidas e pedidos de titulares.
2. **Termo de participação no teste**: finalidade (TCC/avaliação), voluntariedade, possibilidade de
   sair a qualquer momento, o que é coletado (conta, gravações, transcrições, métricas de uso e de
   cota), quem acessa (desenvolvedor/administradores), aceite registrado com data/versão.
3. **Transferência internacional**: AssemblyAI, Groq, Hugging Face e Supabase processam dados fora
   do Brasil; dizer isso explicitamente.
4. **Retenção**: prazo para apagar contas e dados do teste (inclusive backups do banco — A-06 — e
   dados nos provedores — A-07); dizer o que acontece ao final do teste.
5. **Exclusão e exportação**: até existir um botão, documentar o processo manual (pedido por e-mail →
   exclusão do usuário no Auth, que remove em cascata as linhas das tabelas com FK para `auth.users`
   — verificado: `ON DELETE CASCADE` em todas, exceto colunas de autoria em tabelas de turma
   (`classroom_contributions`, `classroom_lessons`, `classroom_resources`, `classroom_shared_items`,
   `classroom_submission_events`…), que ficam `SET NULL` e precisam de revisão caso a caso + limpeza
   dos objetos de Storage do usuário, que **não** são apagados em cascata + remoção nos backups) e o
   prazo de resposta.
6. **Gravações de terceiros**: reforçar que aulas podem conter vozes de professores/colegas; enviar
   só com autorização (a declaração existe; reforçar no convite).
7. **Menores de idade**: definir se o teste aceita menores; se não, dizer no termo.
8. **Base legal** e direitos do titular (acesso, correção, exclusão, revogação do consentimento) em
   linguagem simples — validar com orientação jurídica/orientador.

## 7. Recomendação GO / NO-GO

**GO condicionado** para um teste fechado com 30–100 participantes convidados, desde que as
condições abaixo sejam cumpridas **antes** de enviar os convites. Sem elas: **NO-GO**.

Condições obrigatórias:

1. Deploy desta branch com `NODE_ENV=production`, `APP_ORIGIN=https://…` correto, sem
   `MOCK_EXTERNAL_SERVICES`, sem `CONTENT_SECURITY_POLICY=off` e sem `UNSAFE_PRODUCTION_CONFIG` no
   log de subida; `TRUST_PROXY=1` (ou o número de saltos da hospedagem).
2. Painel do Supabase Auth: _Confirm email_ ligado, **SMTP próprio**, _Leaked password protection_
   ligado, Site URL/Redirect URLs restritos ao domínio do app, limites de taxa revisados; CAPTCHA
   ligado **ou** cadastro restrito a convidados.
3. Cotas no banco (trabalho paralelo) ativas e duração medida no servidor (A-10), com teto global de
   custo configurado.
4. Página de privacidade/termo do teste com os itens 1–5 da seção 6 e um processo manual de exclusão
   testado uma vez no staging.
5. Uma única instância da API (os limites por endereço/conta restantes são em memória).

Recomendadas (podem ocorrer durante o teste, com data):

- Aplicar `20261125090000_security_hardening_public.sql` (staging → produção).
- Remover/exportar os esquemas `backup_*` e as funções de release (`release_tmp`, `qa`).
- Excluir transcrições na AssemblyAI após o processamento (A-07).
- Gravar uploads de mídia em disco em vez de memória; revisar os advisors após cada migration.
