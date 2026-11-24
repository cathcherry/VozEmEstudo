# Cards do perfil ("Meus cards") — 3.7

Página: `conta.html`. Código: `frontend/js/utils/profile-cards.js` (dados, validação, formato de
texto), `frontend/js/utils/profile-card-view.js` (renderização), `frontend/js/pages/profile-card-editor.js`
(janela "Novo card"), `frontend/css/profile-cards.css`. Os cards continuam na chave
`profile-blocks` de `profile_state`, com o mesmo formato (lista de objetos com `id`, `type`, `title`,
`content`, `layout`, `hidden`…). A organização da página (visualização/edição, menu ⋯, larguras,
seções ocultáveis) não mudou.

## Templates oferecidos

| Template   | Guardado como                                                                                  | Observações                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Texto      | `type: 'text'`, `format: 'rich'`, `content`, `tone`                                            | Barra de formatação (título, negrito, itálico, destaque, listas, citação, link) e 6 cores de fundo + "Sem cor". |
| Checklist  | `type: 'checklist'`, `templateId: 'checklist'`, `templateValues.items`, `checkedItems`, `tone` | Marcar um passo salva na conta; ao editar a lista, as marcações acompanham o texto do passo.                    |
| Imagem     | `type: 'image'`, `card: 'image'`, `media`, `alt`, `caption`, `fit`                             | PNG/JPG/WebP/GIF até 8 MB, no `profile-media` (`{usuário}/card-<uuid>`) + cópia local (IndexedDB).              |
| GIF        | `type: 'image'`, `card: 'gif'`, …                                                              | GIF ou WebP animado; botão Pausar/Animar; começa parado com menos movimento, poucos estímulos ou modo foco.     |
| YouTube    | `type: 'embed'`, `card: 'youtube'`, `url` (embed), `source` (link)                             | Sempre `https://www.youtube-nocookie.com/embed/<id de 11 caracteres>[?start=N]`.                                |
| Spotify    | `type: 'embed'`, `card: 'spotify'`, `url` (embed), `source` (link)                             | Sempre `https://open.spotify.com/embed/<track/album/playlist/episode/show/artist>/<id de 22 caracteres>`.       |
| Seus dados | `type: 'data'`, `source`                                                                       | Inalterado (aulas recentes, disciplinas, objetivos, semana).                                                    |

**Não são mais oferecidos**: os cards decorativos 3D (Aurora 3D, Neon), a citação em HTML, o "Código
puro" HTML/CSS e o bloco de código. Outros serviços de música não são aceitos (só YouTube e Spotify
têm um embed validado).

## Cards antigos (compatibilidade)

Nenhum card é apagado ou reescrito automaticamente.

- `widget` (3D, HTML/CSS próprio, citação antiga): continua aparecendo como antes, num `iframe`
  `sandbox=""` (sem scripts, sem mesma origem) com o documento limpo por `widgetDocument` (lista de
  tags e atributos permitidos + CSP própria `script-src 'none'`). Só leitura: no modo de edição o card
  mostra "Formato antigo" e o menu troca **Editar** por **Copiar como texto**, que abre um card de
  texto novo com o texto extraído (o original fica).
- `code`: mostrado como texto (`<pre><code>` com `textContent`), só leitura, com **Copiar como texto**.
- Checklist antigo (`type: 'widget'`, `templateId: 'checklist'`): aparece como checklist, com as
  marcações; ao editar e salvar passa a `type: 'checklist'` (mesmos campos de itens e marcações).
- Texto antigo (`type: 'text'` sem `format`): continua como texto simples (sem interpretar `**`);
  ao editar e salvar vira texto formatado.
- Embed antigo: renderizado se o endereço guardado passar na validação estrita; senão aparece um
  aviso no lugar do `iframe`.
- Versões anteriores do app que lerem cards novos: texto mostra o texto-fonte, checklist funciona
  (mesmos campos), YouTube/Spotify funcionam (`type: 'embed'` + `url`), imagem mostra a legenda.

## Segurança

- Nenhum texto do usuário passa por `innerHTML`: o formato de texto é um subconjunto pequeno de
  Markdown convertido numa árvore e montado com `createElement`/`textContent`. HTML digitado aparece
  como texto. Links só `http(s)`, com `rel="noopener noreferrer nofollow"`.
- Os links de YouTube/Spotify são validados ao salvar (`parseYouTube`/`parseSpotify`: só os hosts
  oficiais, sem `javascript:`, `data:`, usuário/senha, portas ou domínios parecidos; ids no formato
  exato) **e de novo ao renderizar** (`embedFrame`: só os dois formatos de embed exatos), porque o
  valor guardado pode vir de outra versão ou ser alterado à mão. O link "Abrir no…" é derivado do
  endereço validado.
- `iframe` dos players: `sandbox` mínimo (`allow-scripts allow-same-origin allow-popups`, mais
  `allow-presentation` no YouTube), `allow="encrypted-media; picture-in-picture; fullscreen"`
  (Spotify: `clipboard-write` no lugar de `picture-in-picture`), `referrerpolicy="strict-origin-when-cross-origin"`
  (o YouTube exige o referenciador), `loading="lazy"`. A prévia do editor é descartada ao fechar a
  janela (o vídeo para).
- Cores de fundo são uma lista fechada de classes (`card-tone-*`); valores desconhecidos viram "Sem cor".
- Títulos e corpos de cards levam `translate="no"` (a tradução da interface não mexe no conteúdo).

## CSP

`backend/src/app.js` (`contentSecurityDirectives`) já permite `frame-src` para
`https://www.youtube-nocookie.com`, `https://www.youtube.com` e `https://open.spotify.com`, e
`img-src` para `blob:` (imagens dos cards são exibidas por `URL.createObjectURL`). Nada precisou
mudar; `frontend/tests/profile-cards-check.cjs` serve `conta.html` com essa política e verifica que
os players e as imagens carregam sem violações. Imagens por URL externa **não** são aceitas de
propósito (a `img-src` não permite outros hosts).

## Testes

- `frontend/tests/profile-cards.test.mjs` (em `npm run test:personalization`): lista de templates
  sem 3D/código, validação de links (rejeita `javascript:`, outros hosts, domínios parecidos), revalidação
  na renderização, formato de texto sem HTML, barra de formatação, checklist (marcação e edição),
  reconhecimento de cards antigos.
- `frontend/tests/profile-cards-check.cjs` (navegador, em `npm run test:browser`): cards antigos
  seguros, galeria, criação de cada template, links inválidos recusados, marcações e imagens após
  recarregar, CSP, 390 px, tema noturno e texto grande (axe).
