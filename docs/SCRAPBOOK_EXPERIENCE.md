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
