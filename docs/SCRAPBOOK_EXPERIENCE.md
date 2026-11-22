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

### Gabinete, Arquivo e transformações (ramo `feat/3.6-cabinet`, Marco E)

- **Gabinete de curiosidades** (era F + Pa): `gabinete.html` agora é um armário de madeira desenhado
  em CSS (`frontend/css/curiosities.css` sobre `materials.css`): cornija, fundo escuro com duas
  prateleiras e quatro gavetas com puxador e porta-etiqueta de latão: **Selos**, **Objetos de
  mesa**, **Capas** e **Espécimes** (as descobertas). Clicar, Enter ou Espaço abre a gaveta, que
  desliza para fora logo abaixo da sua frente (instantâneo com movimento reduzido); as setas andam
  entre gavetas e entre compartimentos, Home/End vão às pontas, Esc fecha e devolve o foco. A 390 px
  as gavetas ficam empilhadas. Cada compartimento mostra o item com arte do manifesto; o que ainda
  não foi encontrado aparece como contorno apagado com a dica da regra existente (e o progresso no
  modo aventura). **Inspecionar** abre uma etiqueta de museu (`<dialog>`): arte grande, nome,
  lembrança, data, aula (link), descoberta (link), como apareceu; para objetos de mesa, "Colocar na
  mesa" (mesma regra de `utils/desk.js`, troca de lugar se ocupado) e o link "Arrumar a mesa no
  Início"; para capas, o link para Aparência. O formulário "Sua mesa" saiu do Gabinete. **Vazio:**
  a estrutura inteira aparece com contornos e o cartão "Como encher o gabinete" (os quatro passos
  até a primeira descoberta), sem itens falsos. `?gaveta=stamp|object|cover|specimen` abre uma
  gaveta. **OK** (atrás da flag `discoveries`).
- **Transformação do ambiente:** as prateleiras mostram os objetos, selos e capas já encontrados
  (os outros são silhuetas claras no fundo), o fundo do armário ganha luz quando algo é encontrado
  e cada gaveta com conteúdo deixa uma ficha aparecendo pela fresta (duas quando está cheia). Tudo
  vem de `GET /api/collection` e `GET /api/discoveries`. **OK.**
- **Hierarquia de descobertas** (era Pa): o Arquivo (`descobertas.html`) é um fichário com três
  vistas em abas de papel: **Por disciplina** (grupos automáticos com o emblema da disciplina),
  **Ligações** (cada par ligado, com um fio; vermelho quando atravessa disciplinas) e **Coleções**
  (temas que a pessoa cria e enche marcando cartões; guardadas nas preferências da conta,
  `discoveryCollections`, sincronizadas como a mesa, **sem migração**). Acima, **Marcos do seu
  caminho**: primeira evidência, primeira explicação, primeira descoberta, primeira reflexão,
  primeira ponte entre disciplinas e primeira revisita, lidos dos desbloqueios (data, aula, link).
  Abaixo, a legenda "Como um cartão muda". **OK.**
- **Transformações de cartões** (era D): cada descoberta é uma ficha que muda com dados que ela já
  guarda (`frontend/js/utils/discovery-card.js`, puro e testado): **esboço a lápis** (investigação
  aberta: só a pergunta), **passado a tinta** (explicação própria + evidência conferida),
  **carimbado** (≥ 1 reflexão), **costurado com linha** (≥ 1 ligação) e **flor prensada** (≥ 1
  revisita significativa). Cada marca tem uma frase em "Por que este cartão está assim" e, quando
  falta, o que a traria; na página da descoberta aparece com a data de cada mudança; na
  investigação, o esboço diz o que falta para virar tinta. Sem pontos, sem sequências, nada some.
  **OK.**
- **Investigação**: folha de papel, perguntas em ficha pautada, evidências como fichas presas com
  fita, o cartão da pergunta ao lado das etapas. Comportamento igual. **OK.**
- **Migração pequena:** `20261124090000_discovery_archive.sql` só troca a função de leitura
  `discovery_list_admin` para devolver `question`, `reflectionCount`, `connections` e
  `firstRevisitAt` (ver `docs/migrations/DISCOVERY_ARCHIVE.md`). Sem ela, os cartões usam as
  contagens e os selos (o carimbo vem do selo "Primeira reflexão" daquela descoberta) e a vista de
  ligações pede para abrir a descoberta.
- **Limites:** o fio entre cartões é desenhado na vista Ligações (pares), não por cima da grade;
  coleções valem por conta, até 24 com 200 cartões cada; a gaveta Espécimes mostra as 12 mais
  recentes e leva ao Arquivo.
