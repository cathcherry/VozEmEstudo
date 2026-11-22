# Experiência scrapbook: o que foi planejado e o que existe de verdade

## 1. Análise de lacunas (estado em 22/11/2026, antes desta sessão)

Categorias:

| Cat. | Significado |
| --- | --- |
| **D** | só na documentação |
| **P** | desenhado e não implementado |
| **Pa** | parcial |
| **F** | implementado atrás de flag |
| **E** | implementado, mas escondido pela navegação |
| **OK** | funcional e acessível |

| Ideia | Onde foi proposta | Estado real | Cat. |
| --- | --- | --- | --- |
| Arquivo de Descobertas (caderno de descobertas) | `EXPERIENCE_VISION_3_5.md` §2 e §6 | Páginas `descobertas.html` e `investigar.html` prontas e testadas. A flag `discoveries` está **desligada** e a migration `20261123090000_discoveries.sql` **não estava aplicada em produção**. Por isso a pessoa **não conseguia abrir** | F |
| Gabinete de curiosidades | vision §2 | `gabinete.html` com gavetas que só listam itens, sem inspecionar um objeto. Mesma flag e mesma migration. Sem uma investigação concluída, o gabinete fica vazio | F + Pa |
| Hierarquia e progressão de descobertas | vision §6, `RPG_GAMIFICATION_3_5.md` | Só versões, ligações entre descobertas e revisitas. **Não há** grupos, coleções temáticas nem marcos | Pa |
| Transformações (objetos e ambiente que evoluem) | vision §1 ("cresce com o que essa pessoa descobre") | **Nunca implementado**. A mesa recebe objetos, mas nenhum objeto, página ou cartão muda de estado | D |
| Elementos de scrapbook (washi tape, adesivos, papéis, molduras, carimbos aplicáveis) | vision §4 ("papelaria") | **Não existem**. Há só a textura de papel (liso, pontos, quadriculado) e os selos como recompensa, que não se aplicam a nada | D |
| Capas de caderno escolhíveis | vision §2 | 6 capas SVG e a escolha de capa só para o caderno de descobertas (atrás da flag). O caderno da aula (Notes 3.0) não tem capa | Pa + F |
| Caderno da aula bonito | Notes 3.0 | Funcional (blocos, autosave, destaques), mas aparece como um editor comum dentro da aba Anotações, sem cara de caderno | Pa |
| Diário de estudo / scrapbook pessoal | pedido do usuário | **Não existe** | D |
| Ícones coerentes | vision §4 | 14 ícones de arte mais ícones antigos misturados. O seletor de ícone de disciplina é genérico | Pa |
| Atmosferas, estúdio, escrivaninha, modos | M5 | Funcionais e acessíveis (Início, Aparência). Bug: objeto único continua disponível depois de colocado | OK + bug |
| Lume, selos, objetos, capas, papéis de parede | M4 | Arte existe. Na interface aparecem só Lume e os objetos da mesa; o resto está escondido pela flag | OK / F |

**Conclusão honesta.** Quase toda a parte "colecionar, descobrir, decorar" ficou atrás de uma flag
desligada e de uma migration não aplicada em produção. A parte "scrapbook" (papéis, fitas, adesivos,
molduras, diário) nunca foi construída, e nenhuma transformação foi implementada.

## 2. O que esta sessão entrega

As seções seguintes são preenchidas à medida que as entregas ficam acessíveis no app.

### Ativos, ícones e materiais (ramo `feat/3.6-assets`)

- **Ícones coerentes** (era Pa): um só pacote licenciado para os ícones de função, Phosphor Icons
  2.1.1 (MIT), peso duotone, num sprite (`frontend/js/utils/icons.js`, `npm run icons:build`).
  Substitui os desenhos misturados do shell de todas as páginas do app, dos menus da Biblioteca, do
  player, da leitura em voz alta, do cronômetro e dos sons ambientes. **OK.**
- **Seletor de ícone de disciplina** (era genérico): grade de 24 emblemas ilustrados originais, com
  nome, acessível pelo teclado, em "Nova disciplina", "Editar" e "Nova unidade". Fica salvo onde
  os ícones PNG já ficavam; pastas antigas ganham o emblema que o nome sugere, sem migração. **OK.**
- **Elementos de scrapbook** (era D): 79 peças SVG originais no manifesto (papéis, fitas washi,
  adesivos, molduras, divisores, etiquetas, capas) e os primitivos de material em CSS
  (`frontend/css/materials.css`). **Pa:** as peças existem, estão na galeria `arte.html` e
  documentadas, mas ainda não há uma tela onde a pessoa as aplique numa página (diário).

### Caderno da aula e Diário de estudo (ramo `feat/3.6-journal`, Marco D)

- **Caderno da aula bonito** (era Pa): na aula, o botão **"Caderno da aula"** no cabeçalho abre a
  aba Anotações com o caderno. O caderno aparece fechado, como uma **capa** (arte `cover.*`, com o
  título do caderno escrito na plaqueta em letra manuscrita); clicar na capa (ou Enter/Espaço)
  abre o caderno, com a capa girando a partir da lombada (instantâneo com movimento reduzido).
  Aberto: lombada de tecido na cor da capa, página empilhada com margem e **fita marcadora**,
  **abas de papel** para cada título principal (pular para a seção), **divisor desenhado**
  (`divider.sprig`) antes de cada nova seção, títulos em letra manuscrita (Caveat, OFL, local) e
  texto em Instrument Sans, citações e destaques citados como **fichas presas com fita washi**, com
  a cor do destaque como traço de marca-texto. "Capa e papel" escolhe uma das 11 capas e um dos 7
  papéis com **prévia ao vivo** (o caderno muda na hora). Fica salvo **por aula e por conta** nas
  preferências sincronizadas (`profile_state`, chave `notebook-looks`), porque o corpo do caderno
  (Notes 3.0) é validado estritamente e não aceita outros campos; nenhum caderno existente muda.
  "Abrir meu Diário de estudo" leva ao diário (só com a flag `journal`). **OK** (com a flag
  `notebooks`, como antes).
- **Diário de estudo** (era D): página nova `diario.html` (sem item na barra lateral ainda; a
  navegação "Seu espaço" entra na integração). **Estante** com os diários de frente sobre
  prateleiras de madeira; **"Novo diário"** cria e abre um diário e já pede o nome; **Renomear** e
  **Capa** (diálogo com capa grande e grade de capas; o livro muda na hora). Cada diário tem
  páginas de **5 modelos**: Página de caderno (texto em linhas + citação), Colagem (três fotos com
  moldura, desenho e legenda + nota), Ficha de conceito (termo, definição, exemplo, citação), Linha
  do tempo (até 8 momentos) e Página livre. **Papel** por página (7, prévia na hora). **Decorar**:
  adesivos, fitas washi, molduras, etiquetas, divisores e — só se a pessoa já encontrou algum no
  Gabinete — selos; até 24 por página. Arrastar com mouse ou dedo (encaixe em 1 % e nas guias de
  ¼, ½ e ¾); pelo teclado, Tab até a decoração, **setas** movem (Shift: 5 %), **R** gira 5°,
  **+ / −** mudam o tamanho, **Delete** remove; tudo anunciado para leitores de tela. O texto fica
  sempre por cima das decorações, com um halo de papel, então continua legível. **Ligações** a
  aulas e descobertas da própria conta aparecem como bilhetes no pé da página; uma **citação só é
  salva com a fonte** (uma das ligações). Páginas viram com animação curta (instantânea com
  movimento reduzido). **Modo silencioso** e a opção **"Página limpa"** mostram só papel e texto.
  Salva sozinho, com versão por página e repetição segura. **F**: atrás da flag `journal`
  (`FEATURE_JOURNAL=false` por padrão) e da migration `20261124090000_journals.sql`, que é
  **somente staging** (não aplicada em produção). Sem a migration, a página diz que o diário ainda
  não foi habilitado.
- **Capturas**: `docs/design-audit/after/3-6-diario-*` e `3-6-caderno-*` (1440 e 390 px).
- **Ainda não**: fotos enviadas pela pessoa (as molduras mostram desenhos do manifesto), reordenar
  páginas pela interface (a API aceita `position`), dupla página aberta lado a lado, decorações no
  caderno da aula (lá só capa, papel, abas e divisores) e um item de navegação para o diário.
