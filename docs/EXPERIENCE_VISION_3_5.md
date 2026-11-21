# Voz em Estudo 3.5: visão da experiência

> Um mundo pessoal de estudo: a escrivaninha de quem aprende, que cresce com o que essa pessoa descobre.

Este documento é a **direção criativa única** do ciclo 3.5. Design, arte, personalização, jogo e som
partem daqui, para que as partes formem **uma** experiência.

## 1. Por que alguém abriria o Voz em Estudo sem precisar?

Quem estuda chega cansado, ansioso, perdido ou curioso. O app responde a isso de três jeitos:

1. **Começar é fácil.** A primeira tela mostra *uma* próxima ação clara: continuar a aula, revisar 6 cartões ou retomar uma investigação. Não mostra um painel de métricas.
2. **O espaço é seu.** A escrivaninha, o caderno e o gabinete guardam a sua história de estudo: o que você entendeu, quando e com que esforço.
3. **Descobrir tem valor.** Uma descoberta vira um registro no caderno, um selo e às vezes um objeto que volta para a mesa. O objeto é uma **lembrança do aprendizado**, não um prêmio por clique.

O que **não** fazemos: sequências que punem pausas, plantas que morrem, personagem triste,
notificações de culpa, funções acadêmicas ou de acessibilidade presas a recompensas, ou métricas
que contam tempo de tela como mérito.

## 2. Metáfora escolhida: a escrivaninha, o caderno e o gabinete

Avaliamos jardim, atlas, constelação, biblioteca e gabinete de curiosidades. A escolhida combina
**três objetos de uma única escrivaninha**, porque cada um corresponde a uma parte real do produto:

| Objeto | No produto | Cresce com |
| --- | --- | --- |
| **A escrivaninha** (o Início) | a próxima ação, a aula em curso, a companhia, a atmosfera | objetos colocados pela pessoa e a luz da atmosfera |
| **O caderno de descobertas** (Arquivo de Descobertas) | conceitos que a pessoa investigou, com trechos verificados das aulas, explicação própria, ligações e revisitas | páginas, selos e anotações |
| **O gabinete** (Coleções) | gavetas com selos, espécimes, objetos de mesa, capas, papéis de parede e trajes | itens desbloqueados por eventos de aprendizagem verificados |

O jardim foi descartado porque plantas "morrem" quando a pessoa para, o que contraria o princípio
de nunca punir. A constelação foi descartada por ser abstrata demais para objetos colocáveis. O
atlas fica como ideia futura para as ligações entre disciplinas.

## 3. Companhia: **Lume**, a mariposa bibliotecária

Personagem original. Mariposas vão em direção à luz, e a curiosidade também. Lume carrega uma
pequena lanterna e um marcador de página.

- **Forma:** corpo redondo e macio (lavanda), asas largas com veios em matcha, antenas que lembram duas penas, olhos grandes e calmos. Traço contínuo e fino, cor chapada com sombreado suave, sem contornos pretos grossos.
- **Personalidade:** calma, curiosa, um pouco desastrada. Nunca cobra nada e nunca fica triste com ausências.
- **Estados** (o sistema de arte refere sempre o estado, nunca o arquivo):

  | Estado | Quando aparece |
  | --- | --- |
  | `idle` | respira e pisca |
  | `reading` | durante a leitura ou o foco |
  | `thinking` | enquanto a IA ou a busca trabalham |
  | `happy` | depois de algo concluído |
  | `sleepy` | à noite ou em pausas longas: dorme, **sem tristeza** |
  | `celebrating` | numa descoberta registrada: um breve brilho da lanterna |

- **Trajes colecionáveis:** cachecol de inverno, capa de chuva, óculos de leitura e chapéu de explorador.
- **Lugar:** pequeno, num canto da escrivaninha ou do painel de foco. Nunca cobre conteúdo. Some no modo *Estudo silencioso*.

O cãozinho leitor atual (`mascot-reading.png`) continua como avatar padrão do perfil, para dar
continuidade.

## 4. Linguagem visual

**Princípio:** primeiro geometria e hierarquia, depois identidade artística. *Desktopcore* com
papelaria: janelas e painéis no espírito do Finder e do Aqua (barra de título discreta, controles
táteis e brilho leve), sobre papel de caderno. Nada de cartões dentro de cartões.

- **Paleta** (tokens; as atmosferas trocam os valores, não os nomes):

  | Token | Cor | Papel |
  | --- | --- | --- |
  | `--ink` | `#2E2A3B` | tinta berinjela, nunca preto puro |
  | `--paper` | `#F7F5FB` | papel lavanda-acinzentado, não creme |
  | `--paper-raised` | `#FFFFFF` | superfície elevada |
  | `--lavender` | `#8E7CC3` | marca e foco |
  | `--matcha` | `#7FA36B` | progresso e conquista calma |
  | `--honey` | `#E2B14A` | luz da lanterna e recompensas, com parcimônia |
  | `--mist` | `#A9C4D9` | informação |
  | `--rose` | `#D98A9B` | atenção gentil; erros usam um vermelho próprio, acessível |

  O azul elétrico atual sai da identidade.
- **Tipografia:** títulos em **Fraunces** (serifa macia, eixo SOFT, itálico expressivo); interface e texto em **Instrument Sans**. Inter fica como reserva, e Atkinson e OpenDyslexic continuam nos modos de acessibilidade.
  - Escala em proporção 1,25, com o corpo a partir de 16 px e nada abaixo de 13 px.
  - Títulos de página em tamanho editorial, cor `--ink` e peso médio. Fim dos títulos pretos gigantes.
  - Todas as fontes são OFL e ficam locais, em `frontend/assets/fonts`, com a licença ao lado.
- **Controles:**
  - botões de ícone com dica e rótulo que aparece no hover ou no foco;
  - controles segmentados no lugar de interruptores;
  - barras de ferramentas flutuantes e popovers;
  - diálogos com cara de janela.
  - Uma única ação primária por tela.
- **Movimento:** pequeno e artesanal. Lume pisca, uma página vira, uma gaveta abre, um selo é carimbado, um cartão desliza para o álbum. A duração fica entre 120 e 400 ms. Com `prefers-reduced-motion`, ou com "Animações: desligadas", tudo isso vira troca instantânea. Nada se mexe durante a leitura.

## 5. Modos de experiência (a mesma base de dados)

| Modo | O que muda |
| --- | --- |
| **Estudo silencioso** | interface limpa, sem Lume, sem decoração e sem elementos de jogo visíveis. O progresso continua sendo registrado |
| **Estudo aconchegante** (padrão) | atmosfera, Lume pequena, objetos na mesa, selos no caderno |
| **Estudo aventura** | investigações em destaque, gabinete e campanhas visíveis, mais pequenas celebrações |

Trocar de modo nunca apaga nada.

## 6. Jogo com sentido (resumo; detalhes em `RPG_GAMIFICATION_3_5.md`)

O ciclo é: Pergunta → Investigação → Entendimento → Descoberta pessoal → Novas ligações.

- **Investigação:** uma pergunta real sobre uma aula confirmada. As etapas são:
  1. explorar os trechos;
  2. reunir evidências, que são citações conferidas no banco;
  3. explicar com as próprias palavras;
  4. aplicar, respondendo questões ou cartões;
  5. refletir.
- **Descoberta:** o registro que nasce da investigação e evolui com revisitas, novas ligações e novas evidências.
- **Colecionáveis:** cada um tem uma regra que diz **qual evento de aprendizagem** o liberou. Por exemplo, o selo "Primeira evidência" sai quando a pessoa registra a primeira citação verificada. O selo e o objeto mostram a data e a aula de origem. Tudo é idempotente, de propriedade do servidor, e nada se perde com pausas.
- **Cautela:** o progresso diz o que a pessoa *fez* (investigou, explicou, revisou), nunca que ela "domina" o assunto.

## 7. Atmosferas

Atmosferas disponíveis: Biblioteca chuvosa, Escrivaninha lavanda, Tarde de matcha, Inverno
aconchegante, Estudo à beira-mar, Jardim noturno, Caderno acadêmico antigo e Pastel sonhador.

Cada uma combina paleta, papel de parede ilustrado, objetos de mesa, traje da Lume, tratamento da
interface e uma mistura sonora opcional. O som **nunca toca sozinho**. Tudo é ajustável depois de
escolhido, e há "menos distrações" sem perder função.

## 8. Som

O som ambiente é **procedural** (Web Audio), gerado no navegador. Sons disponíveis: chuva, ondas,
vento, floresta, lareira, trovão distante, água corrente, grilos, biblioteca e café.

- Não há arquivos de terceiros, então não há questões de licença.
- O mixer é compacto, num popover.
- O volume abaixa sozinho quando o áudio da aula toca.
- Música por meios oficiais: incorporações do YouTube e do Spotify. Nada é baixado nem retransmitido. A troca de página interrompe a música, e a limitação é documentada.

## 9. Arte

- Toda arte vem por um **manifesto central**, com IDs semânticos (`character.lume.idle`, `stamp.first-evidence`, `object.desk-lamp`, `cover.matcha-linen`, `wallpaper.rainy-library`, `empty.library`), dimensões e licença. Trocar uma ilustração por um desenho feito à mão é trocar um arquivo.
- Arte original em SVG, desenhada para este projeto.
- Esta sessão não tem ferramenta de geração de imagens; isso fica registrado em `ART_DIRECTION_AND_ASSETS.md`. Ativos de terceiros só entram com licença verificada e registrada.
