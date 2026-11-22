# Voz em Estudo 3.5 — auditoria de design e sistema visual (Marcos 2 e 3)

Este documento registra a auditoria feita **antes** de mexer na interface, o sistema visual que
nasceu dela e o que mudou em cada página. A direção criativa é a de
[`EXPERIENCE_VISION_3_5.md`](./EXPERIENCE_VISION_3_5.md): primeiro geometria e hierarquia, depois
identidade.

## Como as capturas foram feitas

- App simulado (`frontend/tests/support/mock-app.cjs`), com todas as flags ligadas e **dados
  sintéticos** (nenhum backend, Supabase ou provedor de IA real).
- Chromium, `deviceScaleFactor: 1`, página inteira, JPEG qualidade 72.
- Script reproduzível: `node frontend/tests/design-audit-capture.cjs <before|after> [filtro]`
  (com `BROWSER_EXECUTABLE` apontando para o Chromium).
- Larguras: 390 e 1440 px em todas as páginas; 390, 768, 1024, 1440 e 1920 px em Início,
  Biblioteca e Aula (transcrição). Estados: com dados, vazio, erro, diálogo (Personalizar o
  Início), pasta aberta, aula pendente, tema noturno e alto contraste.
- Antes: [`design-audit/before/`](./design-audit/before/) · Depois:
  [`design-audit/after/`](./design-audit/after/) (mesmos nomes de arquivo).

## 1. Problemas encontrados (antes)

### Transversais

| Área | Problema |
| --- | --- |
| CSS | ~10,8 mil linhas (≈ 500 KB) em 34 arquivos, com camadas de sobrescrita (`style.css` → `product.css` → `library.css` → `voz-redesign.css` → arquivo da página). O tema padrão `paper` era definido **quatro vezes** em arquivos diferentes; quem carregava por último ganhava. |
| Cor | Azul elétrico (`#3156d8`) como identidade, contra a paleta da visão. Fundo azul-gelo. |
| Tipografia | Títulos em Georgia 700, pretos e gigantes (`clamp(2rem,3vw,2.8rem)`), Inter no resto. Rótulos de 10–12 px (`.eyebrow` a 0,65 rem com letras espaçadas, contagens a 0,7 rem). |
| Raios | `voz-redesign.css` forçava 3 px em tudo; outros arquivos usavam 8, 10, 12, 14, 16, 18, 20, 24 e 26 px sem hierarquia. |
| Ações | "Nova transcrição" sólida na barra lateral **e** no cabeçalho do Início e da Biblioteca: duas ações primárias iguais na mesma tela. |
| Barra lateral | Itens de 48–50 px de altura, borda esquerda de 3 px no item ativo, ação primária azul ocupando o topo. Em capturas de página inteira, a barra terminava na altura da janela. |
| Barra superior | Botões de ícone com caixa e sombra, sem rótulo visível; a dica do "Modo foco" vivia em outro arquivo com outra aparência. |
| Controles | Interruptores (`role="switch"`) no envio; caixas de seleção soltas na Aparência. |
| Movimento | `card-motion.js` inclinava e levantava cartões no hover em todas as páginas (o clichê "hover em todo cartão"). |
| Cartões | Cartões dentro de cartões (aulas recentes dentro do painel, player dentro do cabeçalho da aula, grupos tingidos dentro de seções na Aparência). |

### Por página

- **Início** (`inicio-*`): título "Olá, Marina" em serifa preta; dois botões no cabeçalho
  ("Personalizar" e a primária duplicada); coluna direita como **um cartão alto** com semana,
  calendário, disciplinas e anotações — quando a principal é mais longa ou um bloco é ocultado,
  sobra um retângulo vazio; aulas recentes como 4 caixas cinza dentro de outra caixa; ícone 📁
  emoji nas disciplinas; a 390 px, a coluna direita vira uma pilha longa no fim.
- **Biblioteca** (`biblioteca-*`): identidade Finder certa, mas a janela não tinha barra de título;
  busca ocupando a largura toda; pastas como cartões com sombra (ícone dentro de caixa); caminho
  ("Biblioteca") em 0,8 rem azul; ações de pasta em botões altos; nenhuma barra de status; na pasta
  aberta, cada aula era um cartão flutuante; a 390 px o menu ⋯ da primeira pasta saía da tela.
- **Aula** (`material-*`): título quebrado em duas linhas por quatro botões em pílula à direita;
  player com borda e sombra dentro do cartão do cabeçalho; abas presas ao mesmo contêiner, painel
  colado; "Marcar aula como estudada" solto abaixo; a 390 px, botões empilhados sem ordem.
- **Envio** (`nova-transcricao-*`): interruptores para "guardar áudio/vídeo", sem dizer o estado
  em palavras.
- **Revisar / Planejar / Focar / Turmas**: filtros em linha que quebram de modo irregular; seções
  dobráveis com o triângulo padrão do navegador; frente do cartão em Georgia.
- **Configurações**: rótulo acima do título alinhado à esquerda e o título empurrado para a direita
  (geometria quebrada pelo `flex` do cabeçalho); "eyebrows" em caixa alta espaçada de 10 px; fatos
  da conta em caixas cinza dentro do cartão; navegação em pílulas.
- **Aparência**: grupos de "Leitura e foco" numa grade de duas colunas com alturas diferentes —
  "Leitor de tela" virava uma caixa alta e quase vazia; botão "Personalizar" vermelho; tema padrão
  descrito como "Branco frio e azul royal".
- **Entrar / Criar conta**: frase em bloco tingido com o mascote como adesivo solto; rótulo "ACESSO"
  em caixa alta; botões em pílula; rodapé com outra cor de fundo.

## 2. O sistema visual (o que foi criado)

Arquivo: [`frontend/css/system.css`](../frontend/css/system.css), carregado **primeiro** em todas as
páginas do app.

### Camadas de cascata

```
@layer legacy, system, pages, a11y;
```

- `legacy` — todos os arquivos antigos foram embrulhados em `@layer legacy { … }`. A ordem de
  carregamento e a especificidade deixam de decidir quem ganha.
- `system` — tokens, base, componentes e a moldura do app.
- `pages` — composições do 3.5, no fim do arquivo de cada página (`@layer pages { … }`).
- `a11y` — escolhas de acessibilidade da pessoa (fonte de leitura, fonte dos títulos, modo foco,
  menos estímulo, movimento reduzido, cores forçadas). É a última camada: nenhum estilo visual
  desfaz uma escolha de acessibilidade.

Isso permite **retirar** camadas antigas em vez de empilhar mais: `voz-redesign.css`,
`dashboard-refinement.css` e `card-motion.js` foram removidos; o `dashboard-home.css` foi
reescrito por inteiro; os interruptores do envio saíram do `upload-flow.css`.

### Tokens

| Token | Escrivaninha lavanda (padrão) | Papel |
| --- | --- | --- |
| `--ink` | `#2E2A3B` | texto |
| `--paper` | `#F7F5FB` | fundo |
| `--paper-raised` | `#FFFFFF` | superfície |
| `--paper-sunken` | `#EFEBF6` | trilhos, barras de título |
| `--lavender` / `--lavender-ink` | `#8E7CC3` / `#5A4896` | marca; texto e preenchimento de ações (7,5:1 sobre branco) |
| `--matcha` / `--matcha-ink` | `#7FA36B` / `#48683A` | progresso |
| `--honey` / `--honey-ink` | `#E2B14A` / `#7C5A12` | marcas de agenda, luz |
| `--mist` / `--mist-ink` | `#A9C4D9` / `#3D5F78` | informação, pastas |
| `--rose` / `--rose-ink` | `#D98A9B` / `#9A4357` | atenção gentil (tarefa atrasada) |
| `--error` | `#B3261E` | erro (vermelho próprio, 6:1) |

Os nomes semânticos (`--ink`, `--paper`, `--brand-ink`…) são resolvidos a partir das variáveis do
tema ativo, então **todos os temas existentes continuam funcionando** (Lavanda, Sálvia, Oceano,
Vinho, Areia, Matcha, Mesa digital, Planner, Contraste claro/escuro, Personalizado). O tema
`paper` passou a ser "Escrivaninha lavanda" e o `night` virou "Jardim noturno" (berinjela escura e
luz de lavanda).

- **Tipo**: Fraunces (eixo SOFT 100, itálico para acentos) para títulos de página e números;
  Instrument Sans para a interface. Escala 1,25: 13 · 16 · 20 · 25 · 31 · 39 px; controles densos
  a 15 px; nada abaixo de 13 px. Fontes OFL locais em `frontend/assets/fonts/`
  (`fraunces-soft-latin*.woff2`, `instrument-sans-latin*.woff2`, licenças `FRAUNCES-OFL.txt` e
  `INSTRUMENT-SANS-OFL.txt`; origem: `@fontsource-variable/*` 5.3.0).
- **Espaço**: escala de 4 px (`--space-1` … `--space-8`).
- **Raios** (poucos, com hierarquia): controle 8 px · painel 12 px · janela 18 px · pílula só em
  etiquetas.
- **Elevação**: borda clara no topo + sombra curta de contato + sombra longa e macia
  (`--elev-1/2/3`); `--recessed` para trilhos e campos. Sem vidro gratuito.
- **Foco**: anel de 2 px em `--brand-ink`, com folga de 2 px.

### Componentes

- **Botões**: primário preenchido com brilho leve no topo (um por tela); secundário em papel
  elevado com fio; ação de texto; perigo.
- **Botões de ícone com rótulo**: o nome acessível aparece como etiqueta no hover (atraso de
  350 ms) e imediatamente no foco por teclado; a etiqueta não ocupa espaço na página.
- **Controle segmentado** (`.segmented-control`): substitui os interruptores. Rádios de verdade,
  a opção escolhida é uma tecla elevada num trilho rebaixado.
- **Abas**: linha sublinhada (Aula, Revisar, Planejar).
- **Diálogos como janelas**: faixa de título desenhada pelo próprio diálogo, botão de fechar na
  faixa, título em Fraunces, fundo desfocado.
- **Menus e popovers**: uma só aparência (menu da conta, sugestões de busca, menus ⋯).
- **Estados vazios**: direção e uma ação; a ilustração fica num `data-art-slot="empty"`.
- **Moldura do app**: barra lateral como lista de origem do Finder (itens de 36 px, ícone e rótulo,
  ativo em lavanda translúcida), "Nova transcrição" como tecla elevada (não uma segunda primária),
  barra superior fina e translúcida.

### Pontos de montagem para a arte

A arte e a companhia são de outro sistema (`frontend/js/art/…`). Este trabalho só deixa os
lugares:

- `[data-art-slot="companion"]` — na escrivaninha do Início (`.dash-desk-art`), em Entrar e em
  Criar conta;
- `[data-art-slot="empty"]` — em todo estado vazio criado por `emptyState()` e `ninoNote()`.

Um slot vazio não ocupa espaço (`[data-art-slot]:empty { display: none }`).

## 3. O que mudou em cada página

| Página | Mudança | Antes / depois |
| --- | --- | --- |
| **Início** | A escrivaninha mostra **uma** próxima ação (continuar a aula, botão primário). Saiu a primária duplicada do cabeçalho. Tarefas e flashcards em dois painéis de mesma altura, com rodapés alinhados. Aulas recentes viraram uma lista no estilo Finder (título, disciplina, progresso, data). A coluna direita virou "notas na margem" escritas no papel, sem caixa: semana, mês, disciplinas e anotações separadas por fios. Assim nunca sobra um cartão alto vazio, e as colunas continuam terminando juntas. Pastas desenhadas no lugar do emoji. | `before/inicio-1440.jpg` → `after/inicio-1440.jpg`; 390: `inicio-390`; também 768/1024/1920, vazio, erro, Personalizar, noturno e contraste |
| **Biblioteca** | Uma janela Finder: faixa de título (visualização, filtros, busca à direita), barra de caminho com as ações da pasta em teclas de 32 px, tela de ícones sem caixas (destaque no hover/foco como num gerenciador de arquivos), barra de status com a contagem. Linhas para unidades e aulas. No celular, pastas em linhas (como num app de arquivos) e o menu ⋯ fica dentro da tela. Pastas na cor `--mist`. | `biblioteca-*`, `biblioteca-pasta-*`, `biblioteca-vazia-*`, `biblioteca-erro-*` |
| **Aula** | Cabeçalho no papel (voltar, título, disciplina em itálico, etiquetas); ferramentas da aula num grupo discreto; o player é uma barra de ferramentas flutuante; abas sublinhadas; o conteúdo ativo é **uma** folha de leitura. Nada de contêiner em volta de contêiner. Guia da aula como nota tingida. | `material-transcricao-*` (5 larguras), `material-resumo-*`, `material-questoes-*`, `material-flashcards-*`, `material-anotacoes-*`, `material-pendente-*`, `material-noturno-1440` |
| **Envio** | "Guardar após transcrever": `Não guardar | Guardar` em controle segmentado (áudio e vídeo), no lugar dos interruptores. | `nova-transcricao-*`, `processando-*` |
| **Revisar, Planejar, Focar, Turmas, Material integrado** | Moldura e tipografia novas; filtros como uma faixa de ferramentas; seções dobráveis como linhas com seta; frente do cartão em Fraunces. | `revisar-*`, `planejar-*`, `focar-*`, `turmas-*`, `integrado-*` |
| **Configurações** | Cabeçalho corrigido (contexto acima do título, à esquerda); painéis com linhas; fatos da conta numa linha com fios; navegação como trilho segmentado; rótulos em caixa normal, ≥ 13 px. | `configuracoes-*` |
| **Aparência** | Grupos de preferências em colunas equilibradas (sem caixa alta vazia); linhas com fios; temas como linhas com amostras; "Personalizar" como tecla discreta; tema padrão apresentado como "Escrivaninha lavanda" e escuro como "Jardim noturno". | `aparencia-*` |
| **Conta, Ajuda** | Recebem a moldura, a tipografia, os botões e os campos do sistema. | `conta-*`, `ajuda-*` |
| **Entrar, Criar conta, Recuperar senha** | A frase escrita no papel em Fraunces, sem bloco tingido; o formulário como uma pequena janela com faixa de título; sem rótulo em caixa alta; uma primária por formulário; slot da companhia. | `login-*`, `cadastro-*` |
| **Landing** | Mantém a identidade própria (`landing.css`); recebe apenas as fontes e tokens. | `landing-*` |

A cópia compartilhada (`compartilhado.html`) continua **neutra** de propósito (sempre as
preferências do visitante, nunca as de quem compartilhou) e não carrega o sistema.

## 4. Testes e acessibilidade

- `npm run test:browser` e `npm test`: ver o relatório final da entrega. As expectativas mudadas
  foram só as que o redesenho mudou de propósito: cor de fundo do tema noturno
  (`browser-check.cjs`).
- axe-core (WCAG 2.2 AA) continua limpo nas páginas verificadas; sem rolagem horizontal a 320/390 px,
  inclusive com texto a 200% (rótulos de hover fora do fluxo, botões que quebram linha, barra
  lateral que acomoda "Configurações" a 200%).
- i18n: novas frases ("Não guardar", "Guardar", nomes e descrições dos temas) em en/es/zh-CN via
  `node scripts/i18n/build-phrases.mjs scripts/i18n/design-3-5.json`.

## 5. Marco 5 — personalização: a escrivaninha, o estúdio e as atmosferas

A crítica depois dos Marcos 2 e 3 apontou três coisas: o Início ainda parecia uma página de cartões
brancos; no celular ele era muito longo (a coluna da direita virava uma pilha no fim); e a janela
da Biblioteca tinha uma área branca vazia enorme. A Aparência ainda tinha caixas de seleção.

| Antes | Depois | Capturas |
| --- | --- | --- |
| O Início começava com a saudação solta no papel e o primeiro cartão branco. | Uma **escrivaninha**: parede com a janela da atmosfera e uma prateleira, a mesa, os objetos e a Lume. A folha "Continuar estudando" repousa sobre a borda da mesa e continua sendo a ação mais visível. As colunas da cena são as colunas da página (a saudação alinha com a folha; a janela, com as notas da margem). | `escrivaninha-1440/390`, `escrivaninha-biblioteca-chuvosa-*`, `escrivaninha-inverno-*`, `escrivaninha-jardim-noturno-*`, `escrivaninha-caderno-antigo-1440`, `escrivaninha-pastel-1440`, `escrivaninha-beira-mar-1440` |
| A Lume ficava num slot vazio dentro do cartão (o sistema de arte não era carregado nas páginas). | `art.js` passa a ser carregado em toda página com sessão; a Lume mora na mesa e reage ao estudo (lendo, feliz, dormindo à noite; nunca triste). | idem |
| — | **Arrumar a mesa**: gaveta com os objetos; arrastar até um lugar ou escolher objeto → lugar pelo teclado ou toque; o objeto cai e se acomoda. | `escrivaninha-arrumando-1440/390` |
| 390 px: semana, mês, disciplinas e anotações empilhados no fim (página de ~3.200 px). | As notas da margem viram **um painel com abas**; três aulas recentes; a cena encolhe numa faixa. A página fica com ~2.300 px. | `escrivaninha-inicio-completo-390` |
| Silencioso escondia selos só nas páginas de descobertas. | **Estudo silencioso** tira a cena, a Lume e "Arrumar a mesa" em todo lugar, mantendo a saudação, a próxima ação e cada função; **aventura** mostra as investigações sob a aula. | `escrivaninha-silencioso-*`, `escrivaninha-matcha-aventura-1440` |
| Aparência: temas em lista, caixas de seleção em "Leitura e foco". | **"Seu espaço de estudo"** no topo: modo de experiência (três escolhas que dizem o que muda), modo **Simples** (oito prévias, cada uma desenhada nas cores da própria atmosfera: parede, janela, mesa, folha, botão) e modo **Estúdio** (destaque, cores, papel, janela, movimento, decoração, roupa da Lume, capa do caderno) com prévia ao vivo. As cinco opções liga/desliga viraram controles segmentados ("Desativado / Ativado"). | `estudio-simples-1440/390`, `estudio-detalhes-1440/390` |
| Biblioteca: janela com `min-height: 32rem` (branco vazio); pastas todas azuis. | A janela tem o tamanho do conteúdo (mínimo de 19rem); cada disciplina tem a sua cor de pasta (lavanda, matcha, mel, névoa, rosa, ou a cor guardada da disciplina), também nas pastinhas do Início. Identidade Finder mantida. | `biblioteca-pastas-coloridas-1440/390` |

**Pequenos gestos** (120–460 ms, parados pelo movimento reduzido): o objeto que cai na mesa, o selo
carimbado (novidade no Gabinete, linha de desbloqueio na investigação e no arquivo), a página que
vira ao abrir uma descoberta, a gaveta do Gabinete que desliza ao abrir, a gaveta da mesa.

**Composição.** Uma só coisa ousada: a sala. Tudo o mais continua quieto: a parede é um tom do
papel da atmosfera, a madeira é dessaturada e os objetos têm a mesma linha e sombra de contato do
sistema de arte. Sem gradientes decorativos, sem cartões novos.

**Acessibilidade.** A cena é decorativa (`aria-hidden`), com um resumo para leitores de tela ("Na
sua mesa: xícara de chá (mesa, à direita), …"). Arrumando, cada lugar é um botão com nome ("Colocar
globo em prateleira, à direita"); status em `aria-live`. axe sem violações no Início (1440 e 390,
com a gaveta aberta) e na Aparência (Simples e Estúdio, 1440 e 390); sem rolagem horizontal a 390 px
(`frontend/tests/personal-space-check.cjs`).

Capturas: `node frontend/tests/design-audit-capture.cjs after '^(escrivaninha|estudio|biblioteca-pastas)'`
(fuso `America/Sao_Paulo`, para a Lume não aparecer sempre dormindo no relógio UTC do contêiner).

## 6. Marco 8 — refinamento

A crítica depois do Marco 5: a cena do Início era pequena e chapada (uma faixa bege pesada, a Lume
e a janela minúsculas, a prateleira vazia); Planejar, Focar e Turmas tinham só a moldura; a seleção
na transcrição tinha um balão simples; Descobertas e Gabinete eram listas de cartões; o CSS legado
seguia grande. Capturas: `before/m8-*` (tiradas de `feat/3.5-experience` com a mesma lista) →
`after/m8-*`, a 1440 e 390 px, com
`node frontend/tests/design-audit-capture.cjs after '^m8-'`.

| Antes | Depois | Capturas |
| --- | --- | --- |
| A mesa era uma faixa bege lisa; a folha "Continuar estudando" deveria repousar sobre ela, mas um seletor `+` pulava a seção de resultados da busca e a folha ficava solta. | **Uma sala com direção de arte**: tampo de madeira com veios finos (ruído fractal esticado, em `--desk-top`, então cada atmosfera tem a sua madeira), escuro junto à parede e claro na frente; borda frontal com fio de luz e sombra projetada na página. A folha volta a repousar sobre a borda (`~` no lugar de `+`). | `m8-escrivaninha-1440/390` |
| Lume ~5,75 rem; janela 47 % × 6,75 rem; prateleira com um cacto. | Lume 1,5× (8,75 rem; 6,75 rem no celular), na frente do peitoril; janela 54 % × 8,5 rem com reflexo de vidro e o papel de parede enquadrado; prateleira com fio de madeira e livros (o quarto livro com "Bastante"); objetos numa escala só (mesa 5,1 rem, prateleira 3,7 rem), menores entre 701 e 1180 px. No celular a cena **não ficou mais alta** (297 px, a mesma altura de antes); no desktop, 16 rem em vez de 13. | `m8-escrivaninha-biblioteca-chuvosa-*` |
| — | **Luz da luminária**: com o objeto na mesa, uma poça de luz mel no tampo e na parede (`:has()`, sem JS); no tema noturno em `screen`. | `m8-escrivaninha-luminaria-*`, `m8-escrivaninha-luminaria-noite-*`, `m8-escrivaninha-jardim-noturno-*` |
| O movimento reduzido não parava a deriva da janela (a regra perdia em especificidade). | Movimento reduzido para a janela, a gaveta, o objeto que cai e o selo. | teste |
| **Planejar**: quatro botões e dois filtros em linhas soltas; objetivo = cartão com botões de borda; subobjetivo = cartão dentro do cartão; tarefas com "Editar tarefa" em caixa. | Uma faixa de ações (uma primária) e os filtros logo acima da lista, à direita. Cada objetivo é **um** painel: título em Fraunces, ações como botões de texto na mesma linha, linha de progresso matcha. Subobjetivo é um grupo com fio à esquerda, não um cartão. Tarefas são linhas pautadas (prazo vencido em rosa, concluída riscada). Calendário: mês em Fraunces; a agenda virou **uma lista pautada** (horário com fio lavanda, prazo com fio mel), não cartões. Vazio com `empty.planner`. | `m8-planejar-*`, `m8-planejar-calendario-*`, `m8-planejar-vazio-*` |
| **Focar**: dois cartões de alturas diferentes; "Seu ritmo" com quatro caixinhas e outro cartão para o gráfico. | A sessão é o painel da página (anel, modos como controle segmentado do sistema, a única primária); a semana fica **escrita na margem** (sem caixa competindo em altura). "Seu ritmo" é um painel: quatro números numa linha pautada, gráfico, tabela, aulas e o ano no rodapé. | `m8-focar-*` |
| **Turmas**: botões soltos acima de "Minhas turmas"; turmas como cartões brancos ("1 aulas"); na turma, o título da página "Turmas" maior que o nome da turma; aulas e materiais como cartões empilhados. | Ações na linha do título. Cada turma é uma **capa com lombada colorida** (tons das pastas da Biblioteca), nome em Fraunces, descrição, papel no canto, contagens com plural certo. Na turma, "Turmas" vira o h1 só para leitores de tela e o nome da turma é o título; listas são painéis de linhas; em telas largas os materiais de apoio ficam numa coluna ao lado das aulas. Vazio com `empty.classrooms`. | `m8-turmas-*`, `m8-turma-*`, `m8-turmas-vazia-*` |
| Balão de seleção "Destacar / Comentar", sempre acima, sem teclado. | **Barra de ferramentas da seleção** (`selection-toolbar.js`): tinta sobre o papel, ícone e palavra, seta para o trecho. Destacar, **Anotar** e **Investigar** (com `discoveries` e aula confirmada; abre `investigar.html?aula=…&trecho=…` e a pergunta começa com o trecho). Fica acima do trecho, ou abaixo quando não cabe ou a seleção veio do toque (onde o menu do sistema fica em cima), e nunca o cobre. **Shift+F10** ou a tecla de menu abre e foca a primeira ação; setas, Home/End; Esc fecha e devolve o foco. Alternativa para quem não conhece o atalho: o botão "Ações do trecho selecionado" logo antes do texto (aparece ao receber foco, como um link de pular). | `m8-selecao-*` |
| **Descobertas**: cartões com borda lavanda. | Um **caderno pautado**: uma página com linha de margem rosa e costura na lombada; cada descoberta escrita sobre as pautas, com o dia na margem e os selos carimbados em tinta (levemente girados). Vazio com `empty.discoveries`. | `m8-descobertas-*`, `m8-descobertas-vazio-*` |
| **Gabinete**: painéis com cartões dentro; itens bloqueados coloridos; rádios visíveis no modo de experiência. | Um **gabinete de curiosidades**: cada tipo é uma gaveta com frente de madeira, plaqueta de nome e puxador de latão; os itens ficam em compartimentos de uma bandeja; o que falta encontrar é um contorno apagado no compartimento. Modo de experiência no controle segmentado do sistema. | `m8-gabinete-*` |

### Poda do CSS legado

Regras dentro de `@layer legacy` cujo seletor **não pode casar com nada**: alguma classe ou id
que não aparece em nenhum HTML ou JS do front-end (com cuidado com nomes montados em JS, como
`is-${estado}` ou `'tone-' + cor`: o prefixo vivo mantém a regra). Seletores com `:is/:where/:has`
foram mantidos; classes dentro de `:not()` não contam. Em listas de seletores, só os mortos saíram.
Conferência: 68 capturas de página inteira (34 telas × 390/1440, com movimento reduzido) antes e
depois, comparadas pixel a pixel — só diferenças de antisserrilhado de 1 px, as mesmas que duas
capturas seguidas do código antigo já mostram; `npm run check` e `npm run test:browser` passam.

| Arquivo | Antes (bytes) | Depois | Diferença |
| --- | --- | --- | --- |
| `product.css` | 34.857 | 13.607 | −21.250 |
| `style.css` | 59.289 | 52.219 | −7.070 |
| `library.css` | 34.011 | 30.570 | −3.441 |
| `personalization.css` | 37.923 | 36.427 | −1.496 |
| `workflow.css` | 6.585 | 5.203 | −1.382 |
| `academic.css` | 7.316 | 6.060 | −1.256 |
| `profile-redesign.css` | 23.237 | 22.193 | −1.044 |
| `tool-pages.css` | 32.681 | 31.899 | −782 |
| `quiz-v2.css` | 3.153 | 2.641 | −512 |
| `landing.css` | 20.627 | 20.278 | −349 |
| `marque.css` | 4.075 | 3.762 | −313 |
| `settings-redesign.css` | 13.906 | 13.594 | −312 |
| `learning-tools.css` | 7.376 | 7.154 | −222 |
| `study-authoring.css` | 9.255 | 9.120 | −135 |
| `material-refinement.css` (parte legada) | 45.379 | 45.266 | −113 |
| `history-redesign.css` | 10.544 | 10.496 | −48 |
| **16 arquivos** | **350.214** | **310.489** | **−39.725 (−11,3 %)** |

O que **não** foi feito, por ser arriscado sem um teste visual por regra: apagar regras legadas
que ainda casam com elementos mas são sobrescritas pela camada `pages` (a maior parte do que
sobra em `style.css`, `library.css`, `tool-pages.css` e `material-refinement.css`).

### Testes

`frontend/tests/refinement-check.cjs` (em `npm run test:browser`): a cena (veios, sombra, Lume ≥
1,4× um objeto, janela generosa, folha sobre a borda, cena do celular ≤ 300 px, luz da luminária,
nenhuma animação com movimento reduzido, axe a 1440 e 390); Planejar (tarefas e calendário), Focar,
Turmas e uma turma sem rolagem horizontal a 390 px e axe a 390 e 1440; estados vazios com a arte
certa; Descobertas e Gabinete (390/1440, axe); a barra da seleção pelo teclado (Shift+F10, setas,
Home/End, Esc, o botão alternativo, Destacar salva), sem cobrir a seleção a 1440 e 390, Investigar
só com a flag e com o trecho na investigação, axe. i18n: `scripts/i18n/refinement-3-5.json`.

## 7. O que fica para depois

- ~~Planejar (calendário), Focar e Turmas ainda usam composições antigas por dentro~~ — feito no
  Marco 8. Ainda antigos por dentro: os diálogos de Turmas (publicar, convidar, enviar) e as abas
  Envios/Membros, que só herdaram as listas pautadas.
- ~~A Aparência ainda tem caixas de seleção~~ — feito no Marco 5 (rádios "true"/"false" convertidos
  para booleano em `preferences.js`).
- A escrivaninha poderia mostrar o papel de parede também atrás da página (hoje só na janela, por
  decisão: nunca sob texto de leitura). Objetos de mesa ainda não têm variações por atmosfera, e o
  papel de parede "Escrivaninha lavanda" é um interior (luz e luminária), não uma paisagem: na
  janela ele lê como luz; um desenho de paisagem próprio para a janela ficaria melhor.
- O CSS legado ainda é grande: o próximo passo é remover regras que casam mas são sobrescritas,
  arquivo por arquivo, com capturas por regra.
- A seção "Sua mesa" do Gabinete ainda é um formulário de seleção (a mesa de verdade se arruma no
  Início).
- Player fixo ao rolar a aula.
