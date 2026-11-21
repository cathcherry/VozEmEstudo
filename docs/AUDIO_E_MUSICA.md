# Sons ambientes e música (Marco 7 da versão 3.5)

Este documento descreve o som do Voz em Estudo 3.5: as paisagens sonoras geradas no navegador, o
mixer, a redução automática durante a aula, como o som sobrevive à troca de página e as
integrações com YouTube e Spotify. A visão está em
[EXPERIENCE_VISION_3_5.md](EXPERIENCE_VISION_3_5.md) (seções 7 e 8).

## 1. O que foi implementado

| Parte | Arquivo |
| --- | --- |
| Estado do mixer, camadas, atmosferas e validação de links | `frontend/js/utils/soundscape-mix.js` |
| Motor de som (Web Audio) | `frontend/js/utils/soundscape-engine.js` |
| Controle: persistência por conta, retomada e mini-player | `frontend/js/utils/soundscape-controller.js` |
| Interface: botão da barra superior, popover e mixer | `frontend/js/utils/soundscape-ui.js` |
| Estilos | `frontend/css/soundscape.css` |
| Janela do mini-player | `frontend/pages/mini-player.html` e `frontend/js/pages/soundscape-mini.page.js` |
| Testes | `frontend/tests/soundscape.test.mjs` (unidade) e `frontend/tests/soundscape-check.cjs` (navegador) |

O som ambiente da 3.4 (ruído marrom, chuva e ondas, como ferramenta "Som" do painel do Focar)
foi substituído por este mixer. A escolha antiga (`voz-ambient-v1`) é lida uma vez e convertida
em uma mistura equivalente. A opção "Tocar junto com o foco" continua existindo e agora fica no
mixer. Ela só aparece quando o Focar está ativo.

### 1.1 Camadas procedurais

Tudo é gerado no navegador. Não há gravações nem arquivos de terceiros, então não há questões de
licença e nada é baixado. Cada camada combina três técnicas:

1. **Ruído filtrado**: ruído branco, rosa ou marrom, com filtros que variam devagar.
2. **Texturas curtas**: pingos, estalos, bolhas, grilos e murmúrio são calculados uma vez em
   buffers de 6 a 10 segundos. Os buffers tocam em laço, começam em pontos aleatórios e às vezes
   aparecem em duas velocidades sobrepostas, o que disfarça a repetição.
3. **Eventos aleatórios**: pássaros, páginas, xícaras e trovões são sintetizados na hora, em
   intervalos aleatórios.

| Camada | Como soa |
| --- | --- |
| Chuva | Leito de ruído rosa entre 420 Hz e 6,5 kHz. Por cima, duas texturas de pingos (chiado fino e gotas mais pesadas com leve ressonância). As intensidades oscilam devagar. |
| Ondas do mar | Ruído marrom em que cada onda (7 a 12 s) sobe, quebra e recua: o volume e o corte do filtro sobem e descem juntos. A espuma (ruído agudo) aparece logo depois da crista. |
| Vento | Ruído rosa em banda que se desloca entre 260 e 800 Hz, com rajadas. Um assobio estreito e discreto entra e sai. |
| Floresta | Farfalhar de folhas (banda em 3,2 kHz, com movimento). Frases de pássaros de 2 a 6 notas, sintetizadas com glissandos, em posições estéreo aleatórias e com um pequeno eco de espaço. |
| Lareira | Ronco grave (ruído marrom em passa-baixas). Estalos em grupos e alguns "pops" graves, com cintilação de volume. |
| Trovão distante | Silêncio na maior parte do tempo. A cada 50 a 140 s vem um ribombar grave e suave, com ataque lento e duas ou três rolagens antes de sumir. |
| Riacho | Duas bandas de ruído com centros que se movem, mais bolhas (senoides curtas com glissando ascendente). |
| Grilos | Três grilos de afinações e ritmos diferentes (pulsos de 4,3 a 5,2 kHz), um coro mais distante e um fundo noturno grave. |
| Biblioteca | Tom de sala: ventilação e prédio ao longe. A cada 20 a 60 s, uma página virada (um sopro ao levantar e uma batida curta ao assentar). |
| Café | Murmúrio de conversas distantes: ruído em ressonâncias de vogal que mudam a cada sílaba, em frases e pausas. Tem também tom de sala e, de vez em quando, o tilintar de uma ou duas xícaras (parciais inarmônicas com decaimento rápido). |

### 1.2 Atmosferas (presets)

| Atmosfera | Mistura |
| --- | --- |
| Biblioteca chuvosa | chuva 65 %, biblioteca 45 %, trovão 30 % |
| Escrivaninha lavanda | floresta 35 %, vento 20 %, biblioteca 30 % |
| Tarde de matcha | café 45 %, riacho 30 %, floresta 20 % |
| Inverno aconchegante | lareira 70 %, vento 35 %, biblioteca 20 % |
| Estudo à beira-mar | ondas 70 %, vento 25 % |
| Jardim noturno | grilos 60 %, riacho 30 %, vento 15 % |
| Caderno acadêmico antigo | biblioteca 60 %, lareira 30 %, chuva 20 % |
| Pastel sonhador | vento 20 %, floresta 30 %, riacho 30 % |

Qualquer camada pode ser ligada, desligada ou ajustada depois. Quando a mistura deixa de ser
igual à de uma atmosfera, ela vira "personalizada" e nenhum preset fica marcado. Os volumes das
camadas e o volume geral usam uma curva perceptiva (quadrática).

### 1.3 Consumo de CPU e limpeza

- Um único `AudioContext` por página, criado **somente** no clique de tocar.
- Buffers de ruído e texturas são calculados uma vez por página e compartilhados entre camadas.
- Uma camada desligada é desmontada depois do fade (cerca de 2 s). Camadas sem volume não custam
  nada.
- Os eventos curtos têm um limite de 12 vozes simultâneas. Cada nó é desconectado ao terminar.
- Um único timer (250 ms) cuida de todas as modulações.
- Um compressor suave na saída evita picos quando muitas camadas somam.
- Pausar faz um fade de cerca de 0,4 s, para todas as fontes e suspende o contexto, que é
  reaproveitado no próximo play.
- Ao voltar para a aba (`visibilitychange`, `pageshow`), o contexto é retomado se o som deveria
  estar tocando. Isso cobre interrupções do sistema, como no iOS.

### 1.4 Nunca toca sozinho

O som só começa com um gesto do usuário: o botão de play, "Retomar som" ou um bloco de foco
iniciado com a opção "Tocar junto com o foco". Abrir o popover, escolher uma atmosfera ou carregar
a página não cria áudio. O teste de navegador conta os `AudioContext` criados pelo motor e confirma
que são zero antes do clique.

### 1.5 Redução durante a aula (ducking)

Fica ligada por padrão e é configurável pela caixa "Abaixar durante a aula". A página escuta, em
captura, os eventos `play`, `pause`, `ended` e `emptied` de qualquer `<audio>` ou `<video>`, o
que inclui o player da aula em `material.html`. Enquanto algum deles toca, o volume geral cai para
22 % (`DUCK_LEVEL`) em cerca de 1 s. Quando o último para, o volume volta em cerca de 2 s. Com o
mini-player aberto, a página envia o pedido de redução para ele.

### 1.6 Interface

- Um ícone de fones na barra superior (`.header-navigation`) abre um popover
  (`role="dialog"`, rotulado pelo título). O foco vai para o título; `Esc` fecha e devolve o foco
  ao ícone; clicar fora também fecha. Um ponto no ícone indica que o som está tocando (ou cinza,
  quando há som para retomar).
- Cada camada tem um botão só com ícone (`aria-pressed`, `aria-label` e `title` como dica) e um
  controle deslizante com rótulo próprio ("Volume da chuva" etc.).
- As atmosferas formam uma linha segmentada de rádios nativos, navegável com as setas.
- O mixer também tem o volume geral, a caixa "Abaixar durante a aula" e a caixa "Tocar junto com
  o foco".
- A música fica num `<details>` recolhido, e há o botão "Abrir mini-player".
- Não há chaves liga/desliga (toggle switches), só botões, rádios e caixas de seleção nativas.
- O popover funciona com 390 px de largura (16 px de margem dos dois lados), sem rolagem
  horizontal, e passa no axe (WCAG 2.2 A/AA).
- Os estilos ficam só em `soundscape.css`, carregado pelo próprio módulo, e usam os tokens
  existentes (`--surface`, `--text`, `--accent-strong`, `--border-light`…) com valores de reserva.
- Os textos estão em português e são traduzidos para inglês, espanhol e chinês pelo catálogo de
  frases (`scripts/i18n/build-phrases.mjs`).

## 2. Persistência entre páginas: o som é **restaurado**, não ininterrupto

O app tem várias páginas HTML e cada navegação recarrega a página inteira. Isso tem duas
consequências:

- **Numa aba comum, o som para ao trocar de página.** Os navegadores também bloqueiam áudio que
  começa sem clique. Por isso a mistura e o estado "estava tocando" ficam salvos em `localStorage`
  por conta (`voz-soundscape-v1:<id>`, incluído na limpeza de dados da conta). Na página seguinte
  aparece o aviso "Seus sons ambientes estavam tocando. Quer continuar?", com o botão
  **Retomar som**. O som volta com **um toque**: é uma restauração, não uma continuação sem
  interrupção.
- **Sem interrupção: o mini-player.** "Abrir mini-player" abre uma janela pequena e separada
  (`mini-player.html`). Ela não recarrega quando a aba principal navega, então o som e a música
  continuam. Enquanto o mini-player está aberto:
  - ele avisa que está vivo com um sinal no `localStorage` a cada 2 s;
  - as páginas não tocam nada e passam a controlar o mini-player: a mistura vai pelo
    `localStorage` (evento `storage`), e tocar, pausar e reduzir vão por um `BroadcastChannel`;
  - o ícone da barra mostra que o som está tocando no mini-player.

  Fechar o mini-player encerra o som. A página volta a tocar com um clique.

### Limitações do mini-player

- Ele depende de pop-ups permitidos. Se o navegador bloquear, o usuário vê um aviso.
- O navegador pode exigir um clique dentro da janela nova para começar o áudio, porque a
  ativação do usuário não passa da aba para a janela. Nesse caso o botão de play fica pronto e o
  status diz "Toque em tocar para começar o som".
- O id da conta é passado no fragmento do endereço (`#u=…`). O fragmento nunca vai ao servidor.
  O mini-player só lê e grava preferências locais e não acessa dados da conta.
- Em celulares, "janelas" abrem como abas. O som continua enquanto a aba do mini-player estiver
  viva, mas o sistema pode suspendê-la em segundo plano.

### Document Picture-in-Picture: investigado e não adotado

A API `documentPictureInPicture.requestWindow()` cria uma janela sempre visível com HTML
arbitrário. Ela existe no Chrome e no Edge 116+ e, segundo as tabelas de compatibilidade, no
Firefox mais recente. Não existe no Safari nem no Chrome para Android, e exige HTTPS. A janela
PiP **pertence ao documento que a abriu** e fecha quando ele é descarregado. Como cada navegação
do Voz em Estudo descarrega a página, a PiP não mantém o som entre páginas. Por isso ela não foi
usada. O mini-player em janela separada resolve o problema em todos os navegadores com pop-up.

## 3. Música: YouTube e Spotify por meios oficiais

O usuário cola o link de uma playlist, álbum, faixa ou vídeo no mixer (ou no mini-player). O
Voz em Estudo **não baixa, não grava e não retransmite** áudio. Ele só incorpora o player oficial
da plataforma num `<iframe>`.

### 3.1 Validação estrita dos links

`parseMusicUrl()` aceita somente:

- `https://` sem usuário, senha ou porta, com até 500 caracteres;
- YouTube: `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com` e `youtu.be`.
  Os formatos aceitos são `watch?v=`, `/shorts/`, `/embed/`, `/live/` e `playlist?list=`. O id
  do vídeo deve ter 11 caracteres `[\w-]` e o da playlist, de 10 a 64;
- Spotify: `open.spotify.com`, inclusive `/intl-xx/` e `/embed/`, para `playlist`, `album`,
  `track`, `episode`, `show` e `artist`, com id base62 de 22 caracteres.

O endereço incorporado é **reconstruído a partir do id** e nunca usa o texto colado. Hosts
parecidos (`youtube.com.evil.example`), `http:`, `javascript:` e outros serviços são recusados
com uma mensagem clara.

### 3.2 Privacidade e CSP

- O YouTube usa o domínio `www.youtube-nocookie.com` (modo de privacidade avançada), com `rel=0`,
  `playsinline=1` e **sem `autoplay`**.
- O Spotify usa `open.spotify.com/embed/<tipo>/<id>`, sem alterações no iframe, com
  `allow="encrypted-media; …"`, como recomenda a documentação.
- **O iframe só é criado depois de um clique** ("Usar link" ou "Carregar player"). Ao carregar
  uma página com um link salvo, nenhum pedido vai ao YouTube ou ao Spotify até o usuário pedir.
- Os iframes usam `referrerpolicy="strict-origin-when-cross-origin"` e `loading="lazy"`.
- Na CSP do backend (`backend/src/app.js`), `frame-src` já lista somente `'self'`,
  `https://www.youtube-nocookie.com`, `https://www.youtube.com` e `https://open.spotify.com`
  (os dois últimos também servem às incorporações do perfil). Não foi preciso nenhum host novo.
  `script-src` continua `'self'`: não carregamos scripts de terceiros.

### 3.3 Por que não usamos a IFrame Player API nem a iFrame API do Spotify

- A **YouTube IFrame Player API** exige carregar `https://www.youtube.com/iframe_api`. Isso
  abriria o `script-src` da CSP para o YouTube. Para tocar uma playlist o iframe simples basta.
  A contrapartida é que a música não acompanha o ducking automaticamente: o usuário pausa no
  próprio player.
- A **Spotify iFrame API** (`open.spotify.com/embed/iframe-api/v1`) também é um script de
  terceiro. A documentação a apresenta sobretudo para podcasts, e há relatos de instabilidade no
  fórum de desenvolvedores. Pelo mesmo motivo de CSP, usamos só o iframe.

Os dois podem ser adotados no futuro, acrescentando o host ao `script-src` e revisando a
privacidade.

### 3.4 Termos e limites das plataformas

- **Spotify**: o embed toca a faixa inteira somente para quem está logado no Spotify no mesmo
  navegador. Sem login, ou em alguns navegadores móveis, ele toca **prévias de até 30 segundos**.
  A documentação de solução de problemas também diz que alterar o iframe gerado pode reduzir a
  reprodução a prévias. Por isso não modificamos o iframe.
- **YouTube Music não tem API nem embed oficial.** Links de `music.youtube.com` são aceitos e
  tocam o **vídeo** correspondente no player comum do YouTube. Bibliotecas não oficiais (como a
  `ytmusicapi`) não são usadas.
- **YouTube**: o player incorporado segue os Termos dos Serviços de API do YouTube, inclusive o
  documento "Required Minimum Functionality". O player não pode ser escondido, sobreposto ou
  reduzido a um tamanho que impeça o uso: o nosso fica visível no popover ou no mini-player. Não
  removemos anúncios nem a marca, e não iniciamos a reprodução sozinhos. Alguns vídeos não
  permitem incorporação, e o próprio player avisa.
- **Privacidade avançada não é zero rastreamento**: o domínio `youtube-nocookie.com` não grava
  cookies ao carregar, mas pode usar armazenamento local e cookies quando o vídeo é reproduzido.
- **Troca de página**: numa aba comum, a música para quando a página muda, como acontece com
  qualquer iframe. Com o mini-player aberto, a música continua nele.

## 4. Testes

- `frontend/tests/soundscape.test.mjs` (em `npm run test:study-tracking`):
  - 10 camadas e as 8 atmosferas, com misturas válidas e distintas;
  - normalização, edição de camada que vira "personalizada" e volta ao preset;
  - curva de ganho e ducking (que pode ser desligado);
  - migração da 3.4;
  - validação de links (aceitos, recusados e reconstruídos);
  - controlador que nunca toca sozinho, retomada, persistência por conta, mini-player e foco;
  - motor com Web Audio simulado: nenhum contexto antes do start, só as camadas ligadas são
    montadas, limite de vozes, contexto bloqueado sem clique reportado em vez de travar.
- `frontend/tests/soundscape-check.cjs` (em `npm run test:browser`), com o app simulado:
  - o popover abre e nenhum `AudioContext` do motor existe antes do clique;
  - atmosferas, camadas e volumes salvos, `Esc` devolve o foco e o axe passa;
  - na página seguinte, "Retomar som" sem autoplay;
  - ducking com o áudio da aula, inclusive com a opção desligada;
  - música: link inválido recusado, `youtube-nocookie` sem autoplay e nenhum iframe antes de
    "Carregar player";
  - mini-player: continua tocando quando a aba muda de página, a página o controla e o axe passa;
  - 390 px: o popover cabe na tela, não há rolagem horizontal e o axe passa.
- `frontend/tests/focus-check.cjs`: "Tocar junto com o foco" começa com o bloco e pausa na pausa.

O ouvido humano ainda é necessário. A naturalidade das camadas foi ajustada por parâmetros e
ainda não foi avaliada em sessões reais de estudo.

## 5. Fontes

- Spotify: embeds e solução de problemas (prévias de 30 s; alterar o iframe reduz a reprodução a
  prévias): <https://developer.spotify.com/documentation/embeds/tutorials/troubleshooting>
- Spotify: referência e guia da iFrame API:
  <https://developer.spotify.com/documentation/embeds/references/iframe-api>,
  <https://developer.spotify.com/documentation/embeds/tutorials/using-the-iframe-api>
- Spotify: relatos da comunidade sobre prévias e `allow="encrypted-media"`:
  <https://community.spotify.com/t5/Spotify-for-Developers/30-second-preview-showing-when-try-to-embed-playlist/m-p/5655484/highlight/true>
- YouTube: parâmetros do player incorporado (`list`, `listType`, `rel`, `playsinline`):
  <https://developers.google.com/youtube/player_parameters>
- YouTube: Required Minimum Functionality (Termos dos Serviços de API):
  <https://developers.google.com/youtube/terms/required-minimum-functionality>
- YouTube: visão geral das APIs (não há API para o YouTube Music):
  <https://developers.google.com/youtube/documentation>
- Biblioteca não oficial, citada só como contraste: <https://ytmusicapi.readthedocs.io/>
- Sobre o modo de privacidade avançada (`youtube-nocookie.com`) e os cookies após o play:
  <https://www.ghacks.net/?p=144538>
- Document Picture-in-Picture: <https://developer.chrome.com/docs/web-platform/document-picture-in-picture>,
  <https://developer.mozilla.org/en-US/docs/Web/API/DocumentPictureInPicture/requestWindow>,
  <https://caniuse.com/mdn-api_documentpictureinpicture_requestwindow>

As fontes foram consultadas por busca na web em 21/11/2026. O ambiente de desenvolvimento não
conseguiu abrir diretamente as páginas `developer.spotify.com` e `developer.chrome.com` (rede
restrita). Os trechos citados vêm dos resumos da busca, então vale conferir as páginas antes de
mudanças de produto que dependam desses detalhes.
