# Ativar Google e GitHub no Supabase

O código desta entrega inicia OAuth com PKCE, conclui a troca do código por sessão em `/auth-callback.html` e recupera um destino interno seguro. Não houve alteração no seu projeto remoto. Para usar os botões com contas reais, configure os provedores abaixo.

## URLs do aplicativo

Em Supabase → Authentication → URL Configuration:

- Site URL: a origem pública do aplicativo, por exemplo `https://seu-dominio.example`.
- Redirect URLs: `http://localhost:3000/auth-callback.html` para desenvolvimento e `https://seu-dominio.example/auth-callback.html` para produção.

Em `backend/.env`, ajuste `APP_ORIGIN` para a mesma origem usada no navegador. Use HTTPS em produção. Reinicie a API após alterar o arquivo.

O retorno configurado no Google/GitHub é **o callback do Supabase**, normalmente `https://SEU_PROJECT_REF.supabase.co/auth/v1/callback`; o retorno autorizado dentro do Supabase é **o callback do aplicativo**, terminando em `/auth-callback.html`. Copie o endereço exato exibido no painel do seu projeto.

## Google

1. No Google Cloud, configure a tela de consentimento OAuth e crie um cliente OAuth para aplicação web.
2. Adicione a origem do aplicativo em Authorized JavaScript origins.
3. Adicione o callback do Supabase em Authorized redirect URIs.
4. Em Supabase → Authentication → Sign In / Providers → Google, habilite o provedor e preencha Client ID e Client Secret.
5. Se a tela de consentimento estiver em modo de teste, autorize as contas de teste necessárias.
6. Entre pelo botão “Continuar com Google”. Confira a criação/recuperação da sessão e o retorno ao Painel.

Referência oficial: https://supabase.com/docs/guides/auth/social-login/auth-google

## GitHub

1. Em GitHub → Settings → Developer settings → OAuth Apps, crie um OAuth App.
2. Homepage URL: origem do aplicativo. Authorization callback URL: callback do Supabase.
3. Copie Client ID, gere um Client Secret e configure ambos no provedor GitHub dentro do Supabase.
4. Habilite o provedor e valide “Continuar com GitHub”.

Referência oficial: https://supabase.com/docs/guides/auth/social-login/auth-github

## Provedores disponíveis na interface

`OAUTH_PROVIDERS=google,github` publica os dois provedores. Para habilitar somente Google na interface, use `OAUTH_PROVIDERS=google`. Essa variável **não ativa os provedores no Supabase**; ela controla quais botões ficam disponíveis.

Os segredos OAuth permanecem no painel do Supabase. Não os adicione ao HTML nem à configuração pública da API. Os testes automatizados simulam o SDK e conferem os parâmetros/callbacks; o consentimento e a sessão reais devem ser verificados depois da configuração.

PKCE precisa concluir no mesmo navegador em que foi iniciado. Em caso de código expirado, cancelamento ou provedor indisponível, a tela oferece nova tentativa ou acesso por e-mail/senha. O callback só aceita retorno para páginas internas permitidas.
