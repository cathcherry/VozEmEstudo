# Voz em Estudo — protótipo (código organizado)

Esta pasta contém o frontend, backend Node.js/Express, worker de processamento,
integrações com Supabase, Hugging Face/Whisper e Groq, além dos scripts SQL.

## Como iniciar no Windows

1. Verifique que o Supabase e o Space do Hugging Face estão ativos.
2. Dê dois cliques em **INICIAR.cmd**. Na primeira execução, o script instalará
   automaticamente as dependências do backend com `npm ci` (precisa de internet).
3. Aguarde a mensagem de inicialização da API e do worker.
4. Abra **http://localhost:3000/painel.html** no navegador.
5. Deixe a janela do terminal aberta; para encerrar, pressione Ctrl+C.

Requisito: **Node.js 22.19+**, preferencialmente Node.js 24.

## Se preferir usar o PowerShell

Abra dois terminais na pasta `backend`, e execute:

Terminal 1: `npm.cmd start`
Terminal 2: `npm.cmd run worker`

Instale as dependências antes com `npm.cmd ci` na pasta `backend`.

## Configuração e banco

- O repositório **não contém** `backend/.env`. Na instalação local, mantenha seu
  próprio arquivo privado (use `backend/.env.example` apenas como referência).
  Nunca publique credenciais, mesmo em repositório privado.
- A migração E02 (`database/migrations/20261009101846_academic_review.sql`)
  foi aplicada anteriormente ao projeto Supabase usado nos testes. **Não é
  necessário reaplicá-la** se você estiver usando o mesmo banco.
- Ao usar outro banco, conferir o schema e fazer backup antes de migrar.
- O ZIP contém código e configuração, mas não inclui os dados armazenados
  remotamente no Supabase nem os arquivos de áudio do Storage.

## Organização

- `backend/`: servidor, worker, integração com APIs e `.env`.
- `frontend/`: páginas e interface web.
- `database/`: schema e migrações.
- `asr-space/`: código do Space de reconhecimento de fala.
- `scripts/`: verificações e inicializador usado pelo `INICIAR.cmd`.
- `docs/`: documentação técnica (preservada), decisões e referências.

Arquivos de licença permanecem em seus locais originais.

**Nota:** este ZIP é uma organização do pacote corrigido, sem modificações nos
fluxos de negócio. A versão corrigida do cliente Whisper não foi validada aqui
contra a API externa; o protótipo que você confirmou funcionando anteriormente
foi a pasta original após aplicar E02 no Supabase.


### Recuperação de senha (Supabase Auth)

A página `frontend/pages/recuperar-senha.html` envia um link de recuperação usando `resetPasswordForEmail` e permite definir uma nova senha após validar o código PKCE.

No painel do Supabase, em **Authentication → URL Configuration → Redirect URLs**, inclua exatamente `http://localhost:3000/recuperar-senha.html` (além da URL de `auth-callback.html` usada no login social). Confira também que a opção de autenticação por e-mail está habilitada e que o SMTP/limite de envio permite mensagens de recuperação. Para o fluxo PKCE funcionar, abra o link de recuperação no mesmo navegador onde solicitou o e-mail.

O formulário de cadastro apresenta uma mensagem genérica por privacidade quando a API não confirma se o e-mail é novo.


## CSS de autenticação e publicação

As páginas `login.html`, `cadastro.html` e `recuperar-senha.html` compartilham agora **uma folha de CSS de ajustes**, `frontend/css/auth-pages.css`, carregada depois dos estilos gerais. Os estilos globais (base, temas, kit) são mantidos intactos para as demais telas. Para não criar conflitos futuros, ajuste estas telas **somente nesse arquivo**. A verificação `node frontend/tests/auth-style-check.mjs` agora faz parte de `npm test` no GitHub Actions. Consulte [o mapa de CSS](docs/CSS_GUIDE.md) antes de alterar outros estilos.

**GitHub:** o código é versionado no repositório privado `cathcherry/VozEmEstudo`. As instruções de publicação inicial em [`PUBLICAR_NO_GITHUB.md`](PUBLICAR_NO_GITHUB.md) são históricas. Faça as próximas alterações em branches e revise o CI antes de incorporar à `main`.
