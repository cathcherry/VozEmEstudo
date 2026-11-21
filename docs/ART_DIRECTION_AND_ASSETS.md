# Direção de arte e ativos (Voz em Estudo 3.5)

Este documento é o guia de estilo da arte do ciclo 3.5 e o inventário de todas as ilustrações. Ele
segue a direção criativa de [`EXPERIENCE_VISION_3_5.md`](./EXPERIENCE_VISION_3_5.md) (seções 3, 4, 7
e 9).

> **Nota sobre ferramentas.** Esta sessão **não tem ferramenta de geração de imagens por IA**. Toda a
> arte foi desenhada à mão em SVG, com caminhos escritos um a um. O código que monta os arquivos fica
> em `scripts/art/` e só junta peças, aplica a paleta e repete molduras comuns (borda de selo,
> sombra no chão). Nenhuma arte de terceiros foi baixada ou usada.

## 1. Princípios

1. **Um mundo só.** Selos, objetos, capas, fundos e a Lume parecem saídos do mesmo caderno: mesma
   linha, mesma paleta e a mesma luz, que vem de cima à esquerda.
2. **Lembrança, não prêmio.** Cada peça colecionável representa um gesto de estudo (citar, explicar,
   revisitar, ligar). Nada fala de sequência, de pressa ou de tempo de tela.
3. **Calma em tamanho pequeno.** Cada peça precisa ser reconhecível na menor medida em que aparece
   (48 px para selos e Lume, 16 px para ícones). Detalhe fino é bônus, nunca a informação principal.
4. **Sem texto na arte.** As etiquetas das capas ficam em branco e o app escreve por cima. Se um dia
   um texto for indispensável, ele será em pt-BR e legível no menor tamanho de uso.
5. **Gentileza.** A Lume nunca fica triste. Estados vazios mostram espaço livre e um contorno
   tracejado do que vai chegar: um convite, nunca uma cobrança.

## 2. Linha, preenchimento e sombreado

| Elemento         | Regra                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Linha            | Contínua e fina, em tinta `#2E2A3B` com opacidade 0,88 (nunca preto puro). Pontas e junções arredondadas.                                                          |
| Espessura        | 1,6 a 1,8 unidades nas formas principais e 1,0 a 1,4 nos detalhes, numa prancheta de 120 a 240 unidades. Ícones usam 1,6 em 24.                                    |
| Linhas coloridas | Veios, caules e costuras usam o tom escuro da própria cor (`matchaDeep`, `honeyDeep`, `mistDeep`), não a tinta.                                                    |
| Preenchimento    | Chapado, sem gradientes nos objetos. Os gradientes só aparecem no céu dos papéis de parede.                                                                        |
| Sombreado        | Uma única forma de sombra suave por volume, do lado direito ou de baixo, no tom mais escuro da cor com opacidade de 0,3 a 0,55.                                    |
| Brilho           | Um traço branco curto em vidro, metal e olhos (opacidade 0,7 a 0,9).                                                                                               |
| Chão             | Elipse de tinta com opacidade 0,08 a 0,14 sob tudo o que se apoia na mesa.                                                                                         |
| Transparência    | Todo arquivo tem fundo transparente, exceto os papéis de parede, que são cenas completas. A borda perfurada dos selos é recortada no próprio desenho, sem máscara. |

## 3. Paleta

Os seis tokens da visão e os tons auxiliares que a arte usa. O teste `art-manifest.test.mjs` rejeita
qualquer cor fora desta lista nos arquivos gerados.

| Família                | Base      | Claro                   | Pálido    | Escuro    |
| ---------------------- | --------- | ----------------------- | --------- | --------- |
| Tinta (`--ink`)        | `#2E2A3B` | `#5B5470` (tinta suave) |           |           |
| Papel (`--paper`)      | `#F7F5FB` | `#FFFFFF`               |           |           |
| Lavanda (`--lavender`) | `#8E7CC3` | `#AE9FDB` / `#CFC5EC`   | `#ECE8F7` | `#6F60A6` |
| Matcha (`--matcha`)    | `#7FA36B` | `#B5CDA4`               | `#E3EDDA` | `#5E7F4E` |
| Mel (`--honey`)        | `#E2B14A` | `#F1D38C`               | `#FAEDCB` | `#B9862A` |
| Névoa (`--mist`)       | `#A9C4D9` | `#D3E2EE`               | `#EAF1F7` | `#7D9DB8` |
| Rosa (`--rose`)        | `#D98A9B` | `#EDBDC7`               | `#F8E4E8` | `#B86A7C` |
| Madeira                | `#C9A27E` | `#E2C6A8`               |           | `#9C7656` |
| Noite                  | `#3D3656` |                         |           | `#2A2640` |

- O **mel** é a cor da luz: lanterna, faíscas, recompensas. Usado com parcimônia.
- A **lavanda** é a marca e a Lume.
- O **matcha** é crescimento calmo: plantas, veios das asas, progresso.
- Nenhuma peça usa vermelho de erro. A rosa é só atenção gentil.

## 4. Formatos, proporções e leitura em tamanho pequeno

| Tipo             | Prancheta (viewBox) | Proporção | Fundo                            | Tamanhos de uso               | Como deve ler pequeno                                                                   |
| ---------------- | ------------------- | --------- | -------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| Lume (estados)   | 240 × 240           | 1:1       | transparente                     | 48 a 176 px                   | silhueta de asas + cabeça redonda + lanterna mel; olhos visíveis a partir de 48 px      |
| Trajes da Lume   | 240 × 240           | 1:1       | transparente                     | sobre a Lume                  | uma forma de cor sólida (cachecol rosa, chapéu mel) que muda a silhueta                 |
| Selos            | 120 × 120           | 1:1       | transparente, borda perfurada    | 48 a 96 px                    | disco de cor + um único motivo central com contorno; nada abaixo de 3 unidades          |
| Objetos de mesa  | 160 × 160           | 1:1       | transparente                     | 56 a 128 px                   | apoiados na mesma linha de base (y ≈ 138) com sombra; silhueta reconhecível sem detalhe |
| Capas de caderno | 240 × 320           | 3:4       | transparente                     | 60 a 240 px de largura        | cor e padrão da capa; etiqueta clara para o título                                      |
| Papéis de parede | 1600 × 1000         | 16:10     | cena completa                    | tela inteira, recorte "cover" | baixo contraste; o centro fica calmo e os detalhes ficam nas bordas e embaixo           |
| Estados vazios   | 320 × 240           | 4:3       | transparente com mancha de fundo | 160 a 320 px                  | um objeto principal e um contorno tracejado do que falta                                |
| Ícones           | 24 × 24             | 1:1       | traço, sem preenchimento         | 16 a 32 px                    | traço 1,6 com pontas redondas; usados como máscara, herdam a cor do texto               |

Os SVGs trazem `width` e `height` iguais à prancheta, para que o navegador reserve o espaço certo
antes de carregar.

## 5. Lume, a mariposa bibliotecária

**Anatomia** (igual em todos os estados, para que os trajes sirvam em qualquer um):

- cabeça redonda lavanda-clara (centro 120, 100; raio 31) com um tufo macio no alto;
- gola fofa de papel (o tórax peludo das mariposas) e abdômen lavanda com dois sulcos;
- olhos grandes e calmos em tinta, com dois brilhos; bochechas rosadas;
- antenas em forma de pena, cor de mel, com barbas finas;
- quatro asas lavanda-pálidas com faixa lavanda, veios em matcha e um "olho" cor de mel;
- braços curtos que saem de baixo da gola; a lanterna de mel pendurada na mão direita.

**Partes animáveis** (classes dentro do SVG, que o CSS em `frontend/css/art.css` usa):

| Classe                                                       | Parte                                                                     | Pivô (unidades do desenho) |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | -------------------------- |
| `lume-figure`                                                | o corpo inteiro (respirar, pulinho)                                       | 120, 196 (os pés)          |
| `lume-wing-l`, `lume-wing-r`                                 | asa esquerda e direita (cada uma com `lume-wing-fore` e `lume-wing-hind`) | 108, 122 e 132, 122        |
| `lume-antenna-l`, `lume-antenna-r`                           | antenas                                                                   | 112, 76 e 128, 76          |
| `lume-body`, `lume-arms`, `lume-ruff`, `lume-head`           | corpo, braços, gola, cabeça                                               | sem animação               |
| `lume-eyes`, `lume-lid`                                      | olhos e pálpebras (piscar); a pálpebra fica recolhida por padrão          | topo do olho               |
| `lume-mouth`                                                 | boca                                                                      | sem animação               |
| `lume-lantern`, `lume-glow`, `lume-flame`                    | lanterna, halo e chama                                                    | centro do halo             |
| `lume-dot-1..3`, `lume-spark`                                | bolhas de pensamento ou de sono e faíscas                                 | centro de cada uma         |
| `lume-outfit-slot[data-layer="body"]`, `[data-layer="head"]` | onde os trajes entram (embaixo e em cima dos olhos)                       |                            |

**Estados e movimento:**

| Estado        | Quando aparece          | Movimento (nome no manifesto, duração)                                                                     |
| ------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `idle`        | em repouso              | respira (4,2 s), pisca (a cada 5,6 s), antenas balançam (4,8 s), asas oscilam 2,5° (3,6 s)                 |
| `reading`     | leitura ou foco         | **nenhum**: nada se mexe durante a leitura                                                                 |
| `thinking`    | IA ou busca trabalhando | pisca, antenas balançam, três bolhas acendem em sequência (1,5 s)                                          |
| `happy`       | algo concluído          | dois pulinhos de 6 px, asas batem 6 vezes (0,4 s cada), faíscas piscam                                     |
| `sleepy`      | noite ou pausa longa    | respiração lenta e funda (6 s), bolhas sobem e somem; olhos fechados e sorriso: cochila, nunca fica triste |
| `celebrating` | descoberta registrada   | a lanterna brilha três vezes (1,2 s) e fica acesa; asas batem; faíscas                                     |

A troca de estado tem um esmaecer de 220 ms. **Tudo para** (troca instantânea, sem laço) quando:
`prefers-reduced-motion: reduce`; `<html data-reduced-motion="true">` ("Reduzir animações");
`<html data-low-stimulation="true">` ("Baixa estimulação"); ou `<html data-motion="off">`. No modo
**Estudo silencioso** (`<html data-experience="quiet">` ou `data-experience-mode="quiet"`), a Lume
não aparece.

**Trajes** (`characters/lume/outfits/`): cachecol de inverno, capa de chuva (com chapéu), óculos de
leitura e chapéu de explorador. Cada arquivo tem um grupo `data-layer="body"` (abaixo dos braços e
dos adereços) e/ou `data-layer="head"` (acima dos olhos). O renderizador copia cada grupo para a
vaga de mesmo nome no estado atual; se a arte não tiver vagas (por exemplo, um PNG desenhado à mão),
o traje é sobreposto como imagem.

## 6. Arquitetura dos ativos

```text
frontend/assets/art/
  characters/lume/            lume-<estado>.svg
  characters/lume/outfits/    <traje>.svg
  stamps/  objects/  covers/  wallpapers/  empty/  icons/
frontend/js/art/manifest.js   ids semânticos -> arquivo, dimensões, alt (pt-BR), licença, animação
frontend/js/art/art.js        renderArt, mountCompanion, setCompanionState, mountArtSlots
frontend/css/art.css          estilos da arte e todo o movimento da Lume
frontend/pages/arte.html      galeria interna de revisão (noindex, sem link no app)
scripts/art/                  desenhos-fonte (build-art.mjs) e capturas (capture-review.cjs)
docs/art/                     capturas da galeria em 1x
```

**Ids.** Sempre `tipo.nome` em minúsculas com hífens: `character.lume.<estado>`,
`character.lume.outfit.<traje>`, `stamp.<evento>`, `object.<objeto>`, `cover.<capa>`,
`wallpaper.<atmosfera>`, `empty.<tela>`, `icon.<nome>`. O código e as páginas usam **sempre o id**,
nunca o caminho do arquivo.

**Entrada do manifesto.** `src` (relativo a `/assets/art/`), `width`, `height`, `alt` (pt-BR),
`license`, `animation` (lista de movimentos; vazia quando é estático) e, conforme o tipo, `title`,
`event` (selos), `tone` (`light` ou `dark`, nos fundos), `inline` (a Lume, que precisa estar no DOM
para animar) e `mask` (ícones).

**API (`frontend/js/art/art.js`).**

| Função                                                    | O que faz                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `renderArt(id, { size, decorative, alt, lazy })`          | devolve um `<img>` (ou um `<span>` com máscara, para ícones) ou `null` se o id não existir. `decorative: true` deixa `alt=""`.                         |
| `mountCompanion(el, { state, outfit, size, decorative })` | coloca a Lume em `el` como SVG em linha e devolve um controle com `setState`, `setOutfit`, `destroy` e `ready`. Decorativa por padrão (`aria-hidden`). |
| `setCompanionState(state)` / `setCompanionOutfit(outfit)` | mudam todas as Lumes montadas na página.                                                                                                               |
| `mountArtSlots(root)`                                     | preenche os ganchos `[data-art-slot]`. Roda sozinho ao carregar e observa o DOM.                                                                       |
| `getArt(id)`, `artUrl(entry)`                             | consulta ao manifesto.                                                                                                                                 |

**Ganchos nas páginas** (para quem redesenha as telas):

```html
<div data-art-slot="companion" data-art-state="reading" data-art-size="96"></div>
<div data-art-slot="empty" data-art-id="empty.library" data-art-size="240"></div>
```

Atributos aceitos: `data-art-id`, `data-art-state`, `data-art-outfit`, `data-art-size` e
`data-art-decorative="false"` (para a arte ser anunciada com o `alt` do manifesto). Mudar
`data-art-state` ou `data-art-id` depois de montado atualiza a arte. Carregue `/css/art.css` e
`<script type="module" src="/js/art/art.js">`.

**Falha suave.** Um id inexistente não desenha nada e só avisa no console em `localhost`. Um estado
ou traje desconhecido mantém o atual. Se o SVG da Lume não puder ser carregado em linha, ela aparece
como imagem parada. O SVG em linha passa por limpeza: sem `script`, `style`, `foreignObject`,
atributos `on*` ou links externos, e os ids internos ganham prefixo único.

## 7. Inventário completo

Todas as peças são originais, desenhadas para o Voz em Estudo, sob a mesma licença do projeto. Na
coluna "Movimento", "estático" significa sem animação.

| Id                                      | Arquivo (em `frontend/assets/art/`)           | Tamanho     | Estados e movimento                      | Onde aparece                                                       | Licença                 | Como substituir                                                          |
| --------------------------------------- | --------------------------------------------- | ----------- | ---------------------------------------- | ------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------ |
| `character.lume.idle`                   | `characters/lume/lume-idle.svg`               | 240 × 240   | breathe, blink, antenna-sway, wing-drift | Companhia (Início, painel de foco) via `data-art-slot="companion"` | original, Voz em Estudo | SVG 240 × 240 com as classes `lume-*` para animar; PNG fica parado (9.3) |
| `character.lume.reading`                | `characters/lume/lume-reading.svg`            | 240 × 240   | parada (nada se mexe na leitura)         | Companhia (Início, painel de foco) via `data-art-slot="companion"` | original, Voz em Estudo | SVG 240 × 240 com as classes `lume-*` para animar; PNG fica parado (9.3) |
| `character.lume.thinking`               | `characters/lume/lume-thinking.svg`           | 240 × 240   | blink, thought-dots, antenna-sway        | Companhia (Início, painel de foco) via `data-art-slot="companion"` | original, Voz em Estudo | SVG 240 × 240 com as classes `lume-*` para animar; PNG fica parado (9.3) |
| `character.lume.happy`                  | `characters/lume/lume-happy.svg`              | 240 × 240   | hop, wing-flutter, sparkle               | Companhia (Início, painel de foco) via `data-art-slot="companion"` | original, Voz em Estudo | SVG 240 × 240 com as classes `lume-*` para animar; PNG fica parado (9.3) |
| `character.lume.sleepy`                 | `characters/lume/lume-sleepy.svg`             | 240 × 240   | slow-breathe, sleep-dots                 | Companhia (Início, painel de foco) via `data-art-slot="companion"` | original, Voz em Estudo | SVG 240 × 240 com as classes `lume-*` para animar; PNG fica parado (9.3) |
| `character.lume.celebrating`            | `characters/lume/lume-celebrating.svg`        | 240 × 240   | lantern-glow, wing-flutter, sparkle      | Companhia (Início, painel de foco) via `data-art-slot="companion"` | original, Voz em Estudo | SVG 240 × 240 com as classes `lume-*` para animar; PNG fica parado (9.3) |
| `character.lume.outfit.winter-scarf`    | `characters/lume/outfits/winter-scarf.svg`    | 240 × 240   | estático                                 | Camada sobre qualquer estado da Lume                               | original, Voz em Estudo | SVG 240 × 240 com grupos `data-layer` (9.4)                              |
| `character.lume.outfit.raincoat`        | `characters/lume/outfits/raincoat.svg`        | 240 × 240   | estático                                 | Camada sobre qualquer estado da Lume                               | original, Voz em Estudo | SVG 240 × 240 com grupos `data-layer` (9.4)                              |
| `character.lume.outfit.reading-glasses` | `characters/lume/outfits/reading-glasses.svg` | 240 × 240   | estático                                 | Camada sobre qualquer estado da Lume                               | original, Voz em Estudo | SVG 240 × 240 com grupos `data-layer` (9.4)                              |
| `character.lume.outfit.explorer-hat`    | `characters/lume/outfits/explorer-hat.svg`    | 240 × 240   | estático                                 | Camada sobre qualquer estado da Lume                               | original, Voz em Estudo | SVG 240 × 240 com grupos `data-layer` (9.4)                              |
| `stamp.first-evidence`                  | `stamps/first-evidence.svg`                   | 120 × 120   | estático                                 | Evento: registrou a primeira citação verificada de uma aula        | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `stamp.own-explanation`                 | `stamps/own-explanation.svg`                  | 120 × 120   | estático                                 | Evento: escreveu uma explicação própria numa investigação          | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `stamp.revisit`                         | `stamps/revisit.svg`                          | 120 × 120   | estático                                 | Evento: voltou a uma descoberta para revê-la ou ampliá-la          | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `stamp.connection`                      | `stamps/connection.svg`                       | 120 × 120   | estático                                 | Evento: ligou descobertas de duas disciplinas diferentes           | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `stamp.first-investigation`             | `stamps/first-investigation.svg`              | 120 × 120   | estático                                 | Evento: concluiu a primeira investigação                           | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `stamp.careful-reviewer`                | `stamps/careful-reviewer.svg`                 | 120 × 120   | estático                                 | Evento: revisou cartões conferindo cada resposta                   | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `stamp.curious-question`                | `stamps/curious-question.svg`                 | 120 × 120   | estático                                 | Evento: abriu uma investigação a partir de uma pergunta própria    | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `stamp.gentle-evening`                  | `stamps/gentle-evening.svg`                   | 120 × 120   | estático                                 | Evento: estudou à noite, no próprio ritmo                          | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `stamp.first-discovery`                 | `stamps/first-discovery.svg`                  | 120 × 120   | estático                                 | Evento: registrou a primeira descoberta no caderno                 | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `stamp.deep-focus`                      | `stamps/deep-focus.svg`                       | 120 × 120   | estático                                 | Evento: concluiu uma sessão de foco planejada                      | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `stamp.shared-note`                     | `stamps/shared-note.svg`                      | 120 × 120   | estático                                 | Evento: compartilhou um material ou uma descoberta com a turma     | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `stamp.new-subject`                     | `stamps/new-subject.svg`                      | 120 × 120   | estático                                 | Evento: começou a estudar uma disciplina nova                      | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `object.desk-lamp`                      | `objects/desk-lamp.svg`                       | 160 × 160   | estático                                 | Escrivaninha (Início) e gaveta de objetos do Gabinete              | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `object.teacup`                         | `objects/teacup.svg`                          | 160 × 160   | estático                                 | Escrivaninha (Início) e gaveta de objetos do Gabinete              | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `object.pressed-flower-jar`             | `objects/pressed-flower-jar.svg`              | 160 × 160   | estático                                 | Escrivaninha (Início) e gaveta de objetos do Gabinete              | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `object.globe`                          | `objects/globe.svg`                           | 160 × 160   | estático                                 | Escrivaninha (Início) e gaveta de objetos do Gabinete              | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `object.inkwell`                        | `objects/inkwell.svg`                         | 160 × 160   | estático                                 | Escrivaninha (Início) e gaveta de objetos do Gabinete              | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `object.cactus`                         | `objects/cactus.svg`                          | 160 × 160   | estático                                 | Escrivaninha (Início) e gaveta de objetos do Gabinete              | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `object.hourglass`                      | `objects/hourglass.svg`                       | 160 × 160   | estático                                 | Escrivaninha (Início) e gaveta de objetos do Gabinete              | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `object.specimen-box`                   | `objects/specimen-box.svg`                    | 160 × 160   | estático                                 | Escrivaninha (Início) e gaveta de objetos do Gabinete              | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `cover.matcha-linen`                    | `covers/matcha-linen.svg`                     | 240 × 320   | estático                                 | Capa do Caderno de descobertas; gaveta de capas                    | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `cover.lavender-dots`                   | `covers/lavender-dots.svg`                    | 240 × 320   | estático                                 | Capa do Caderno de descobertas; gaveta de capas                    | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `cover.honey-gingham`                   | `covers/honey-gingham.svg`                    | 240 × 320   | estático                                 | Capa do Caderno de descobertas; gaveta de capas                    | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `cover.mist-marbled`                    | `covers/mist-marbled.svg`                     | 240 × 320   | estático                                 | Capa do Caderno de descobertas; gaveta de capas                    | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `cover.rose-botanical`                  | `covers/rose-botanical.svg`                   | 240 × 320   | estático                                 | Capa do Caderno de descobertas; gaveta de capas                    | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `cover.night-stars`                     | `covers/night-stars.svg`                      | 240 × 320   | estático                                 | Capa do Caderno de descobertas; gaveta de capas                    | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `wallpaper.rainy-library`               | `wallpapers/rainy-library.svg`                | 1600 × 1000 | estático                                 | Fundo da atmosfera de mesmo nome                                   | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `wallpaper.lavender-desk`               | `wallpapers/lavender-desk.svg`                | 1600 × 1000 | estático                                 | Fundo da atmosfera de mesmo nome                                   | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `wallpaper.matcha-afternoon`            | `wallpapers/matcha-afternoon.svg`             | 1600 × 1000 | estático                                 | Fundo da atmosfera de mesmo nome                                   | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `wallpaper.cozy-winter`                 | `wallpapers/cozy-winter.svg`                  | 1600 × 1000 | estático                                 | Fundo da atmosfera de mesmo nome                                   | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `wallpaper.ocean-study`                 | `wallpapers/ocean-study.svg`                  | 1600 × 1000 | estático                                 | Fundo da atmosfera de mesmo nome                                   | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `wallpaper.night-garden`                | `wallpapers/night-garden.svg`                 | 1600 × 1000 | estático                                 | Fundo da atmosfera de mesmo nome                                   | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `wallpaper.old-notebook`                | `wallpapers/old-notebook.svg`                 | 1600 × 1000 | estático                                 | Fundo da atmosfera de mesmo nome (3.5 M5)                          | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `wallpaper.dreamy-pastel`               | `wallpapers/dreamy-pastel.svg`                | 1600 × 1000 | estático                                 | Fundo da atmosfera de mesmo nome (3.5 M5)                          | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `empty.library`                         | `empty/library.svg`                           | 320 × 240   | estático                                 | Acervo sem aulas (`data-art-slot="empty"`)                         | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `empty.discoveries`                     | `empty/discoveries.svg`                       | 320 × 240   | estático                                 | Caderno de descobertas vazio (`data-art-slot="empty"`)             | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `empty.flashcards`                      | `empty/flashcards.svg`                        | 320 × 240   | estático                                 | Revisar sem cartões (`data-art-slot="empty"`)                      | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `empty.planner`                         | `empty/planner.svg`                           | 320 × 240   | estático                                 | Planejar sem tarefas (`data-art-slot="empty"`)                     | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `empty.classrooms`                      | `empty/classrooms.svg`                        | 320 × 240   | estático                                 | Turmas sem turma (`data-art-slot="empty"`)                         | original, Voz em Estudo | mesmo arquivo e tamanho, ou `src` no manifesto (9.1, 9.2)                |
| `icon.desk`                             | `icons/desk.svg`                              | 24 × 24     | estático                                 | Ícones do mundo de estudo (máscara CSS, cor do texto)              | original, Voz em Estudo | SVG 24 × 24 de traço; só a forma conta (máscara)                         |
| `icon.notebook`                         | `icons/notebook.svg`                          | 24 × 24     | estático                                 | Ícones do mundo de estudo (máscara CSS, cor do texto)              | original, Voz em Estudo | SVG 24 × 24 de traço; só a forma conta (máscara)                         |
| `icon.cabinet`                          | `icons/cabinet.svg`                           | 24 × 24     | estático                                 | Ícones do mundo de estudo (máscara CSS, cor do texto)              | original, Voz em Estudo | SVG 24 × 24 de traço; só a forma conta (máscara)                         |
| `icon.stamp`                            | `icons/stamp.svg`                             | 24 × 24     | estático                                 | Ícones do mundo de estudo (máscara CSS, cor do texto)              | original, Voz em Estudo | SVG 24 × 24 de traço; só a forma conta (máscara)                         |
| `icon.lantern`                          | `icons/lantern.svg`                           | 24 × 24     | estático                                 | Ícones do mundo de estudo (máscara CSS, cor do texto)              | original, Voz em Estudo | SVG 24 × 24 de traço; só a forma conta (máscara)                         |
| `icon.lume`                             | `icons/lume.svg`                              | 24 × 24     | estático                                 | Ícones do mundo de estudo (máscara CSS, cor do texto)              | original, Voz em Estudo | SVG 24 × 24 de traço; só a forma conta (máscara)                         |
| `icon.evidence`                         | `icons/evidence.svg`                          | 24 × 24     | estático                                 | Ícones do mundo de estudo (máscara CSS, cor do texto)              | original, Voz em Estudo | SVG 24 × 24 de traço; só a forma conta (máscara)                         |
| `icon.investigation`                    | `icons/investigation.svg`                     | 24 × 24     | estático                                 | Ícones do mundo de estudo (máscara CSS, cor do texto)              | original, Voz em Estudo | SVG 24 × 24 de traço; só a forma conta (máscara)                         |
| `icon.leaf`                             | `icons/leaf.svg`                              | 24 × 24     | estático                                 | Ícones do mundo de estudo (máscara CSS, cor do texto)              | original, Voz em Estudo | SVG 24 × 24 de traço; só a forma conta (máscara)                         |
| `icon.teacup`                           | `icons/teacup.svg`                            | 24 × 24     | estático                                 | Ícones do mundo de estudo (máscara CSS, cor do texto)              | original, Voz em Estudo | SVG 24 × 24 de traço; só a forma conta (máscara)                         |
| `icon.sparkle`                          | `icons/sparkle.svg`                           | 24 × 24     | estático                                 | Ícones do mundo de estudo (máscara CSS, cor do texto)              | original, Voz em Estudo | SVG 24 × 24 de traço; só a forma conta (máscara)                         |
| `icon.bookmark`                         | `icons/bookmark.svg`                          | 24 × 24     | estático                                 | Ícones do mundo de estudo (máscara CSS, cor do texto)              | original, Voz em Estudo | SVG 24 × 24 de traço; só a forma conta (máscara)                         |
| `icon.connection`                       | `icons/connection.svg`                        | 24 × 24     | estático                                 | Ícones do mundo de estudo (máscara CSS, cor do texto)              | original, Voz em Estudo | SVG 24 × 24 de traço; só a forma conta (máscara)                         |
| `icon.question`                         | `icons/question.svg`                          | 24 × 24     | estático                                 | Ícones do mundo de estudo (máscara CSS, cor do texto)              | original, Voz em Estudo | SVG 24 × 24 de traço; só a forma conta (máscara)                         |

Total: 65 peças no manifesto (6 estados da Lume, 4 trajes, 13 selos, 9 objetos, 6 capas, 8 papéis de
parede, 5 estados vazios e 14 ícones). O Marco 5 (personalização) acrescentou os papéis de parede de
"Caderno acadêmico antigo" (folha pautada com margem, fita marcadora e folhas prensadas, só nas
bordas) e "Pastel sonhador" (céu lilás, nuvens, lua e um arco-íris claro), para que as oito
atmosferas tenham a sua paisagem. Os papéis de parede aparecem **só na janela da escrivaninha** do
Início e nas prévias da Aparência, nunca sob texto de leitura.

## 8. Capturas de revisão

A galeria `pages/arte.html` mostra todas as peças, cada estado da Lume em movimento (176 px e
48 px) e cada traje. Ela também traz um botão para desligar o movimento e um fundo noturno para
conferir contraste. As capturas em `docs/art/` (1x, movimento desligado) são geradas com
`npm run art:screenshots` (precisa de `BROWSER_EXECUTABLE` e das dependências do frontend e do
backend):

`arte-topo.png`, `lume-estados-e-trajes.png`, `selos.png`, `selos-fundo-noite.png`, `objetos.png`,
`capas.png`, `papeis-de-parede.png`, `estados-vazios.png`, `icones.png`, `ganchos.png`.

**Controle de qualidade feito nesta entrega:** cada SVG foi renderizado no Chromium em 48, 96 e 200
a 520 px. Foram redesenhados: braços da Lume (pareciam bastões), olhar de leitura (parecia bravo),
pálpebra que não cobria o olho no piscar, seta solta no selo "Revisita", meridiano do globo fora do
lugar, braço escondido do cacto, xícara flutuando no planejador, fita confusa nos cartões e a lua do
jardim noturno (aparecia um disco escuro).

## 9. Como substituir por arte desenhada à mão

A regra geral: **trocar uma ilustração é trocar um arquivo** ou **editar uma entrada do manifesto**.
Nenhuma página precisa mudar.

### 9.1 Mesmo formato (o caminho mais simples)

1. Desenhe na mesma prancheta da tabela da seção 4 (por exemplo, 120 × 120 para um selo), com fundo
   transparente.
2. Exporte como SVG com `viewBox="0 0 L A"`, `width="L"` e `height="A"` iguais às do manifesto.
3. Salve por cima do arquivo, com o mesmo nome (por exemplo, `frontend/assets/art/stamps/revisit.svg`).
4. Rode `npm run test:art` para conferir arquivo, tamanho e segurança, e abra `/arte.html`.

### 9.2 Outro formato (PNG ou WebP) ou outro tamanho

1. Coloque o arquivo na pasta do tipo (por exemplo, `stamps/revisit.png`) e apague o SVG antigo.
2. Edite **só a entrada** em `frontend/js/art/manifest.js`: `src`, e `width`/`height` se mudarem. O
   `alt` pode ser revisto ali também.
3. Para PNG, exporte com o dobro do tamanho (por exemplo, 240 × 240 para um selo de 120) e declare no
   manifesto o tamanho lógico (120 × 120).
4. O teste de manifesto confere o `viewBox` só de arquivos SVG; ajuste o teste se um tipo inteiro
   deixar de ser SVG.

### 9.3 A Lume

- Para ela **continuar animada**, o SVG precisa ter as classes da seção 5 (no mínimo `lume-figure`,
  `lume-wing-l`, `lume-wing-r`, `lume-antenna-l`, `lume-antenna-r`, `lume-eyes`, `lume-lantern` e
  `lume-glow`) e as duas vagas `lume-outfit-slot` (`data-layer="body"` e `"head"`), na prancheta
  240 × 240 e com a cabeça no mesmo lugar (centro 120, 100), para os trajes servirem.
- As pálpebras (`lume-lid`) são opcionais: sem elas, a Lume só não pisca.
- Um PNG também funciona: troque o `src` e marque `inline: false`. A Lume aparece parada, e os trajes
  são sobrepostos como imagem.

### 9.4 Trajes

Um SVG 240 × 240 com um grupo `<g data-layer="body">` (embaixo dos braços) e/ou
`<g data-layer="head">` (por cima dos olhos), desenhado sobre a mesma anatomia. Um PNG transparente
240 × 240 também serve, e nesse caso é sobreposto por inteiro.

### 9.5 O gerador não apaga o seu desenho

Os arquivos atuais trazem o comentário `voz-art:generated`. `npm run art:build` só reescreve
arquivos que ainda têm essa marca. Um desenho substituído (sem a marca) **nunca é sobrescrito**, a
não ser com `--force`. O teste de paleta também só vale para arquivos com a marca, para que um
desenho à mão possa ter as próprias cores.

### 9.6 Arte de terceiros

Evite. Se for indispensável, use só licenças que permitem uso e modificação (CC0 ou CC BY), registre
a licença na entrada do manifesto (por exemplo, `license: 'CC BY 4.0, Fulana de Tal, <link>'`) e
acrescente o crédito em [`CREDITOS_INTERFACE.md`](./CREDITOS_INTERFACE.md).

## 10. Testes

| Verificação                                                | Onde                                   | O que garante                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:art` (parte de `npm test` e `npm run check`) | `frontend/tests/art-manifest.test.mjs` | ids únicos e no padrão, pasta certa por tipo, arquivo existente, `viewBox`/`width`/`height` iguais ao manifesto, `alt` e licença, nenhum `script`, `style`, `text`, imagem externa ou `on*`, nenhum arquivo órfão, paleta respeitada, partes da Lume presentes, leitura sem movimento, falha suave do `art.js`                                           |
| `npm run test:browser`                                     | `frontend/tests/art-check.cjs`         | todas as 61 peças carregam em `arte.html`; axe (WCAG 2.2 A/AA) sem violações no fundo claro, no escuro e em 390 px; a Lume se mexe em repouso, fica parada lendo e para com `prefers-reduced-motion`, "Reduzir animações", "Baixa estimulação" e "Movimento desligado"; ganchos `data-art-slot`, `setCompanionState`, id inexistente e Estudo silencioso |
