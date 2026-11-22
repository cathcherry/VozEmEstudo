# Mapa de CSS — Voz em Estudo

## Objetivo

Prevenir conflitos de aparência entre telas sem reescrever o design atual. O histórico já contém regras compartilhadas e modificadores de página; esta etapa define responsabilidade antes de mudanças graduais. **Não houve unificação integral de todas as folhas de estilo.**

## Arquivo responsável

| Arquivo | Responsabilidade | Alterações permitidas |
| --- | --- | --- |
| `frontend/css/style.css` | Variáveis, temas, reset/base e componentes legados | Manutenção global estritamente necessária; evitar novas regras exclusivas de uma página |
| `frontend/css/marque.css` | Marca, logo e identidade compartilhada | Regras de marca reutilizadas em várias páginas |
| `frontend/css/product.css` | Componentes visuais compartilhados do produto | Componentes reutilizáveis com classe específica, evitando seletores de elemento genéricos |
| `frontend/css/library.css` | Componentes da biblioteca e organização de materiais | Elementos da biblioteca; escopo de página ao alterar aparência local |
| `frontend/css/academic.css` | Upload, material e conferência acadêmica | Estilos acadêmicos sem interferir em autenticação |
| `frontend/css/system.css` | **3.5:** tokens, base, componentes e moldura; declara as camadas `legacy, system, pages, a11y` e carrega primeiro | Ver `docs/DESIGN_AUDIT_3_5.md`; arquivos antigos ficam em `@layer legacy`, composições novas em `@layer pages` |
| `frontend/css/materials.css` | **3.6:** materiais esqueuomórficos (papel, capas, fita, gavetas…) e o seletor de emblemas; importado por `system.css` na camada `system` | Novos materiais e variantes; nunca regras de página. Ver [Materiais (3.6)](#materiais-36) |
| `frontend/css/journal.css` | **3.6 (Marco D):** composição de `diario.html` (estante, livro com lombada, página, decorações, bandeja, páginas virando), camada `pages` | Regras do Diário de estudo |
| `frontend/css/lesson-notebook.css` | **3.6 (Marco D):** o caderno da aula (Notes 3.0) como caderno de verdade (capa fechada, lombada, página, abas, divisores, fichas com washi), camada `pages`, carregado por `material.html` | Regras do caderno da aula |
| `frontend/css/auth-pages.css` | Login, cadastro, recuperação, senha e notificações de autenticação | **Fonte de verdade de ajustes das três páginas**, com `body.auth-page`; carregada por último |

## Regras de alteração

1. **Preservar o design existente:** não mudar tipografia, cores, tamanhos ou layout global apenas para corrigir uma tela.
2. **Escopar seletores locais:** usar `body.auth-page`, `body.app-page`, `body[data-page="..."]` ou classes próprias de componente. Evitar `h1`, `button`, `input`, `section` globais em novos ajustes.
3. **Um proprietário por regra nova:** alterações de login/cadastro/recuperação pertencem a `auth-pages.css`; não criar outro `auth-layout.css`, `auth-toast.css` ou `password-controls.css`.
4. **Respeitar o carregamento:** mudanças locais de páginas devem vir depois das regras gerais. Não usar `!important` para vencer um conflito sem inspecionar a cascata; o arquivo de autenticação já contém exceções pontuais históricas.
5. **Regressão barata:** `npm test` na raiz inclui `node frontend/tests/auth-style-check.mjs`. O teste confere estrutura e ordem de CSS das três páginas; não é screenshot nem avaliação visual completa.
6. **Aprimorar incrementalmente:** ao alterar cada módulo E03–E21, mover ou isolar somente as regras tocadas e registrar o motivo. Sem refatoração massiva em uma entrega de correção de CI.


7. **Formatação gradual:** o CI executa lint e testes essenciais; `npm run format:check` permanece disponível, mas a dívida de Prettier acumulada não impede esta etapa. Ao editar um componente novo, formate somente os arquivos alterados, sem uma reorganização global.

## Aceite desta etapa

Os seletores de autenticação seguem isolados em `auth-pages.css`, o fluxo de teste passa a verificá-los automaticamente e alterações futuras têm responsável definido. A organização integral das demais páginas fica para os módulos em que forem editadas; não há alegação de que conflitos de CSS foram totalmente eliminados.

## Materiais (3.6)

`frontend/css/materials.css` entra em todas as páginas pelo `@import` no topo de `system.css`
(camada `system`), então a camada `a11y` continua vencendo. Direção de arte e referências:
[`ART_DIRECTION_AND_ASSETS.md`](./ART_DIRECTION_AND_ASSETS.md) §11 e §12. Exemplos ao vivo, no claro
e no escuro: seção "Materiais (CSS)" de `/arte.html`.

**Regra de uso.** Objetos decorativos e colecionáveis (capa, fita, polaroide, gaveta) podem ter
volume. Controles de função continuam leves: borda de luz em cima e sombra curta (os componentes de
`system.css`). Fita, marcador e argolas são sempre decorativos (`aria-hidden="true"`).

| Classe | Variantes | Exemplo |
| --- | --- | --- |
| `.paper` | `data-paper="ruled\|grid\|dot\|kraft\|linen\|vellum\|aged"`; `data-edge="deckle\|torn"` | `<div class="paper" data-paper="ruled">…</div>` |
| `.page-stack` | soma-se a `.paper` | `<div class="paper page-stack">` |
| `.book-cover` | `data-cover="cloth-lavender\|leather-matcha\|linen-mist\|kraft\|night"`; filho `.book-cover-label` (`data-relief="embossed"`) | `<div class="book-cover" data-cover="kraft"><span class="book-cover-label">Campo</span></div>` |
| `.binder-rings` | filhos `<i>` | `<div class="binder-rings" aria-hidden="true"><i></i><i></i><i></i></div>` |
| `.tab-strip` / `.paper-tab` | `aria-selected="true"` ou `aria-current="page"`; `data-tint="lavender\|matcha\|honey\|rose\|mist"` | `<div class="tab-strip" role="tablist"><button class="paper-tab" role="tab" aria-selected="true">Notas</button></div>` |
| `.bookmark-ribbon` | `data-tint="lavender\|matcha\|honey"` (rosa por padrão) | dentro de um `.paper` |
| `.washi` | `data-tape="lavender-dots\|matcha-stripes\|honey-gingham\|rose-floral\|mist-grid\|kraft\|stars\|check"`; `--tilt`, `--tape-length` | `<span class="washi" data-tape="kraft" style="--tilt:-4deg" aria-hidden="true"></span>` |
| `.index-card` | — | `<div class="index-card"><strong>Mitose</strong> …</div>` |
| `.polaroid` | `--tilt`; primeiro filho é a imagem; `figcaption` | `<figure class="polaroid"><img …><figcaption>…</figcaption></figure>` |
| `.envelope` | `data-airmail` | `<div class="envelope" data-airmail></div>` |
| `.drawer` | filhos `.label-holder` e `.drawer-pull`; `aria-expanded="true"` deixa a gaveta aberta | `<button class="drawer"><span class="label-holder">Selos</span><span class="drawer-pull"></span></button>` |
| `.label-holder` | — | porta-etiqueta de latão |
| `.embossed-label` | `data-tint="matcha\|rose\|ink"` (lavanda por padrão) | etiqueta de rotuladora |
| `.mat-scope` | `data-tone="dark"` | prévia com superfície própria (galeria, cartões de tema) |
| `.cover-face` | filhos `<img>` (arte `cover.*`) e `.cover-face-label` | capa com o título escrito na plaqueta (fonte `--font-hand`, tamanho pela largura da capa) |
| `.swatch` / `.swatch-radio` / `.swatch-paper` | `.swatch-paper.paper[data-paper]`; `.cover-radio` para capas | amostras de papel e capa como botões de opção, com anel de seleção e de foco |

**Fonte manuscrita.** `--font-hand` (Caveat, OFL, local) só em títulos de caderno e diário; o
texto continua em Instrument Sans.

**Tokens.** `--mat-sheet`, `--mat-rule`, `--mat-margin`, `--mat-dot`, `--mat-kraft`, `--mat-cream`,
`--mat-wood*`, `--mat-brass*`, `--mat-pewter*`, `--mat-lift-1`, `--mat-lift-2`, `--mat-noise` e
`--mat-noise-opacity`. Derivam das cores do tema; `[data-theme="night"]` e `custom` têm valores
próprios. **Acessibilidade:** sem animação automática; a gaveta e o seletor param com movimento
reduzido; em alto contraste (`data-high-contrast`, temas `contrast-*`) e em cores forçadas, textura,
máscara, inclinação e sombra somem e fica uma borda.

### Ícones de interface

Use `icon(name)` ou `iconMarkup(name)` de `frontend/js/utils/icons.js` (Phosphor duotone, sprite em
`/assets/icons/sprite.svg`). O elemento recebe a classe `.ui-icon`: cor do texto, camada clara em
`--icon-tint` / `--icon-tint-opacity`. Não escreva `<svg>` de ícone à mão nem use emoji como ícone.
Para um ícone novo: acrescente o nome semântico ao mapa e rode `npm run icons:build`.
