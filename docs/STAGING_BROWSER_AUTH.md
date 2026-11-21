# Login no navegador e uploads ao Storage sem credencial privilegiada

## O que foi investigado (21/11/2026)

Na validação real da 3.4, o login pelo formulário falhou no staging e os uploads ao Storage
passaram como `service_role`. A causa **não está no produto**, e sim no ambiente de nuvem em que
os testes rodaram:

- **Origem da injeção.** A chave secreta do staging foi salva como "segredo de rede" desse ambiente. O proxy de saída do contêiner coloca essa chave no cabeçalho `apikey` de **todo** pedido HTTPS a `cissxpmmjnnpewreuxeo.supabase.co`. Isso vale para a API, para o worker, para os scripts e para o Chromium headless que roda no mesmo contêiner.
- **Por que o login falhou.** Com a chave do servidor no `apikey`, o Supabase Auth deixa de tratar o pedido como vindo do usuário: `GET /auth/v1/user` → `403 bad_jwt`. O login no navegador recebeu 401.
- **Por que os uploads passaram.** O Storage tratou os uploads do navegador como `service_role`, e as políticas RLS do bucket `audios` não foram exercitadas.

## O que o produto garante (verificado)

| Garantia | Onde | Teste |
| --- | --- | --- |
| `/api/config` só entrega a chave **publicável** (`sb_publishable_…` ou JWT `anon`). Uma chave secreta posta no campo público faz a rota responder 503 sem ecoar o valor | `backend/src/validators/public-config.validator.js` | `backend/tests/public-config.test.js` |
| Nenhum arquivo servido ao navegador (`frontend/`, sem build) cita `SUPABASE_SECRET_KEY`, `supabaseSecretKey`, `sb_secret_…` ou `service_role` | — | `scripts/tests/key-hygiene.test.mjs` |
| Existe um único cliente Supabase no navegador, criado com `config.supabasePublishableKey` | `frontend/js/api/supabase-browser.js` | `scripts/tests/key-hygiene.test.mjs` |
| A chave secreta só é lida pelo cliente administrativo do servidor | `backend/src/integrations/supabase/admin-client.js` | — |
| Todo pedido do navegador ao Supabase sai com a chave publicável; o proxy de nuvem só a troca **depois** que ela sai do navegador | — | passo 2 de `scripts/staging/browser-auth-storage-check.mjs` |

Em produção, os navegadores são os dos usuários e não passam por esse proxy. A chave secreta fica
só nas variáveis do servidor (API e worker).

## Procedimento: login normal e Storage com RLS real

O script `scripts/staging/browser-auth-storage-check.mjs` percorre os passos abaixo:

0. **Rede limpa.** Um pedido só com a chave publicável tenta ler uma tabela exclusiva do servidor (`ai_generations`).
   - Se conseguir (HTTP 200), algo está injetando uma chave privilegiada. O script para com **INCONCLUSIVE** (código 2) e não dá falso positivo.
   - Neste ambiente de nuvem, ele parou exatamente assim.
1. **Login pelo formulário real** (`/login.html`), com uma conta sintética `@example.test`.
2. **Higiene das chaves.** Todo pedido do navegador ao Supabase carregou só a chave publicável.
3. **Upload ao próprio prefixo** `temp/{uid}/…` do bucket `audios`, seguido da leitura de volta.
4. **Fronteira entre contas.** O navegador não grava no prefixo de outra conta e não lista os arquivos dela.
5. **A API aceita o token da sessão**: não responde 401 nem 403.

### Onde rodar

O script precisa rodar **sem** segredo de rede para o host do Supabase. Escolha uma das opções:

- **GitHub Actions** (recomendado): workflow manual `Staging browser login and Storage (no privileged key)`, arquivo `.github/workflows/staging-browser-auth.yml`.
  - A API sobe **sem** `SUPABASE_SECRET_KEY`, então o job nem chega a ter credencial privilegiada.
  - Configuração única no GitHub (Settings › Environments › `staging-browser`):
    - variável `STAGING_SUPABASE_URL` = `https://cissxpmmjnnpewreuxeo.supabase.co`;
    - variável `STAGING_SUPABASE_PUBLISHABLE_KEY` = a chave **publicável** do staging;
    - segredo `STAGING_SYNTHETIC_ACCOUNTS` = `{"s1":{"email":"qa34-s1@example.test","password":"…"},"s2":{"email":"qa34-s2@example.test","password":"…"}}`.
  - Para disparar, digite `APPROVE_STAGING_BROWSER` no campo de autorização.
- **Máquina local** (sem proxy):
  1. Suba a API com `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` do staging. Deixe `SUPABASE_SECRET_KEY` vazio.
  2. Rode:

     ```bash
     E2E_ACCOUNTS_FILE=/caminho/privado/contas.json node scripts/staging/browser-auth-storage-check.mjs
     ```

O E2E completo (`scripts/staging/e2e-staging.mjs`) continua precisando da chave do servidor, porque
cria aulas, turmas e baralhos pela API. Rode os dois em ambientes separados.

## Resultado da rodada real (21/11/2026, staging, sem chave privilegiada)

Esta sessão de nuvem foi movida para um ambiente sem segredos de rede (só o host do staging liberado). O passo 0 confirmou a rede limpa: a chave publicável sozinha leva `401` numa tabela do servidor. A API subiu **sem** `SUPABASE_SECRET_KEY`.

| Passo | Resultado |
| --- | --- |
| `/api/config` só com a chave publicável | PASS |
| a chave publicável sozinha não lê tabela do servidor | PASS (401) |
| login pelo formulário real | PASS (redirecionou para `/painel.html`) |
| upload ao próprio prefixo `temp/{uid}/…` e leitura de volta | PASS |
| gravar no prefixo de outra conta | PASS (negado pelo RLS do Storage) |
| listar o prefixo de outra conta | PASS (vazio) |
| a API aceita o token da sessão | PASS (503 por falta da chave do servidor, nunca 401/403) |
| chaves nos pedidos do navegador | PASS (só a publicável) |

Isso fecha a ressalva da 3.4: o login normal e as políticas do bucket `audios` funcionam de verdade, sem nenhuma credencial privilegiada.
