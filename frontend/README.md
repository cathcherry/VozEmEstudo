# Frontend — Voz em Estudo

Frontend estático servido pelo backend deste pacote. HTML, CSS e JavaScript não exigem compilação. As dependências npm nesta pasta servem aos testes.

## Páginas

| Rota                                 | Conteúdo                                             |
| ------------------------------------ | ---------------------------------------------------- |
| `/index.html`                        | Landing pública                                      |
| `/login.html`, `/cadastro.html`      | E-mail/senha, Google e GitHub                        |
| `/auth-callback.html`                | Conclusão do login PKCE                              |
| `/painel.html`                       | Continuidade, últimos acessos, disciplinas e tópicos |
| `/nova-transcricao.html`             | Mídia, recorte, identificação e envio                |
| `/historico.html`                    | Biblioteca, tags, agrupamento, busca e edição        |
| `/material.html?id=…`                | Player, transcrição, resumo e questões               |
| `/responder.html?material=…&batch=…` | Responder questões                                   |
| `/aparencia.html`                    | Temas, cores, fonte e perfis nomeados                |
| `/leitura.html`                      | Preferências de leitura e foco                       |
| `/conta.html`                        | Perfil detalhado, oito avatares, histórico e sessão  |
| `/ajuda.html`                        | Orientações                                          |

O menu principal contém Painel, Nova transcrição e Biblioteca. Preferências e ajuda ficam nas utilidades. A marca, fontes e mascotes vêm de `/assets`, publicado pelo backend atualizado.

## Onde ajustar a interface

- `css/marque.css`: adaptação dos componentes e tipografia do UI Kit.
- `css/product.css`: landing, autenticação e player.
- `css/library.css`: composição neutra, biblioteca, perfil, sidebar e reflow.
- `css/style.css`: estrutura existente, temas e preferências.
- `pages/index.html`: textos e placeholders da equipe/contato.
- `js/pages/dashboard.page.js`, `history.page.js`: continuidade, biblioteca e organização.
- `js/utils/study-store.js`: tags e estudo por conta neste navegador.
- `js/utils/theme-init.js`, `preferences.js`: tema antes do CSS, perfis nomeados, foco e navegação.
- `js/pages/account.page.js`, `utils/avatars.js`: perfil Supabase e oito opções do Nino.
- `js/utils/media-player.js`: waveform, reprodução e limites de recorte.
- `js/pages/upload.page.js`: inspeção, exportação e envio.
- `js/api/media.api.js`: comunicação binária com a API autenticada.
- `js/api/auth.api.js`, `js/pages/auth-callback.page.js`: OAuth PKCE.
- `js/vendor/`: SDK Supabase 2.112.3 e licença, servido localmente.

`theme-init.js` é síncrono e aparece antes do CSS em todos os HTMLs. O modo foco recolhe a sidebar e mantém sua reabertura manual, com A−/A+ e Alt+F (o atalho não atua enquanto você digita em campos). No celular, Escape, Fechar ou o fundo encerram o menu; o foco retorna ao botão de abertura. Preferências ficam neste navegador e são sincronizadas entre abas pelo evento `storage`.

## Dados e envio

Disciplina/título e perfil/mascote são salvos pela API e Supabase. Tags extras, temas nomeados, progresso de escuta, revisão e contagem de respostas ficam neste navegador por conta, sem sincronização entre aparelhos. Aplique cores e preferências antes de usar **Salvar tema atual**; **Atualizar** sobrescreve um tema nomeado com a combinação aplicada.

A biblioteca inclui **Gerar questões** para materiais prontos. O formulário `material.html?id=…#gerar-questoes` usa a transcrição existente e conserva lotes anteriores.

Painel e Biblioteca usam exclusivamente respostas da API. Exemplos ilustrativos estão identificados na landing; as capturas dos testes usam fixtures. A identificação e os limites de recorte permanecem ao avançar/voltar nas etapas. Se a criação do job falhar depois do upload, a nova tentativa reutiliza o material salvo.

O player mostra forma de onda calculada a partir do áudio. Enquanto ela não está disponível, mostra uma linha de tempo, sem barras fictícias. O recorte informado tem precisão de centésimos de segundo; codecs de áudio/vídeo podem arredondar a exportação ao limite de amostra ou quadro.

## Executar testes

Instale primeiro as dependências do backend. Nesta pasta:

```sh
npm ci
npx playwright install chromium
npm test
```

Para usar executáveis já instalados, defina `BROWSER_EXECUTABLE`, `FFMPEG_PATH` e `FFPROBE_PATH`. O teste inicia seu próprio servidor local e não precisa de credenciais.

Configuração real dos provedores: [../docs/CONFIGURAR_LOGIN_SOCIAL.md](../docs/CONFIGURAR_LOGIN_SOCIAL.md). Créditos: [../docs/CREDITOS_INTERFACE.md](../docs/CREDITOS_INTERFACE.md).

## Revisão de organização — 0.3.1

Painel com uma última aula, sem duplicação nos recentes; linhas com status junto ao título, grupos de disciplinas e ações de revisão coerentes. O aviso de armazenamento está em Ajuda → Onde seus dados ficam salvos, acessível pelo rodapé. A avaliação de produtividade está em `../docs/PRODUTIVIDADE.md`; timer e metas estruturadas são propostas.
