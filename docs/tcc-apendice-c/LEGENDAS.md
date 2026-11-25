# Apêndice C – Capturas de tela do Voz em Estudo

| Item                | Valor                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Branch              | `claude/keen-shannon-sj3ut5`                                                                              |
| Commit do front end | `879df99` (inclui o painel de foco lateral restaurado)                                                    |
| Data das capturas   | 25/11/2026                                                                                                |
| Ambiente            | Front end real da versão 0.3.1 com API simulada e dados de demonstração; **não é o ambiente de produção** |
| Navegador           | Chromium headless (Playwright), localidade `pt-BR`, fuso `America/Sao_Paulo`                              |
| Computador          | Janela de 1440 × 900 px, escala 2 (arquivos com 2880 px de largura)                                       |
| Celular             | Janela de 390 × 844 px com toque, escala 2 (arquivos com 780 px de largura); nome terminado em `_celular` |
| Temas               | Um tema por tela, para mostrar a personalização junto com cada função (ver a tabela abaixo)               |
| Script              | `node frontend/tests/support/tcc-captures.cjs` (com `BROWSER_EXECUTABLE` apontando para o Chromium)       |

## Como as imagens foram obtidas

- As telas são o código real do front end (HTML, CSS e JavaScript do repositório) rodando no
  navegador. Não há montagem, edição de imagem nem interface desenhada fora do aplicativo.
- O tema de cada tela foi escolhido pelo próprio mecanismo do aplicativo (a mesma preferência que
  a pessoa troca em Configurações › Aparência). Nenhuma cor foi alterada nas imagens.
- O backend, o Supabase e os provedores de IA **não** foram usados. As respostas da API vêm da
  simulação dos testes automatizados (`frontend/tests/support/mock-app.cjs` e `mock-quiz.cjs`). O
  script acrescenta rotas com o conteúdo das aulas de demonstração.
- A única parte real do backend executada é a rota local de mídia (FFmpeg), que gera a forma de
  onda do arquivo escolhido no envio (C.2).
- Conteúdo: aulas de demonstração de `database/demo-lessons` (crase, vacinas, internet), originais
  da equipe, licença CC BY 4.0, narração sintetizada. Resumo, questões e cartões dessas aulas foram
  **escritos pela equipe**, não gerados pelo modelo de linguagem de produção.
- A biblioteca e o Início também mostram aulas fictícias dos testes automatizados (Fotossíntese,
  Revolução Industrial etc.), que só têm título e metadados.
- Perfil fictício (“Estudante”). Nenhum dado pessoal, credencial ou token real aparece. Datas e
  horários exibidos são os do momento da captura.
- Sugestão de nota no texto do TCC: _“As capturas foram obtidas com o front end do sistema em
  execução local, com dados de demonstração e serviços externos simulados.”_

## Resumo

| Figura | Arquivo                            | Tela                                 | Tema                 | Dispositivo |
| ------ | ---------------------------------- | ------------------------------------ | -------------------- | ----------- |
| C.1    | C00_inicio.png                     | Início (painel)                      | Escrivaninha lavanda | Computador  |
| C.2    | C01_envio_aula.png                 | Nova transcrição: gravação e recorte | Planner              | Computador  |
| C.3    | C01b_envio_identificacao.png       | Nova transcrição: identificação      | Planner              | Computador  |
| C.4    | C02_processamento.png              | Processamento                        | Mesa digital         | Computador  |
| C.5    | C03_transcricao_player.png         | Aula: player e transcrição           | Jardim noturno       | Computador  |
| C.6    | C04_revisao_confirmacao.png        | Revisão da transcrição               | Sálvia               | Computador  |
| C.7    | C04b_revisao_versoes.png           | Versões da transcrição               | Sálvia               | Computador  |
| C.8    | C05_resumo.png                     | Resumo                               | Areia                | Computador  |
| C.9    | C06_questoes.png                   | Questões                             | Lavanda              | Computador  |
| C.10   | C07_biblioteca.png                 | Biblioteca                           | Oceano               | Computador  |
| C.11   | C07b_biblioteca_pasta.png          | Biblioteca: unidade                  | Oceano               | Computador  |
| C.12   | C08_flashcards.png                 | Flashcards: frente                   | Jardim noturno       | Computador  |
| C.13   | C08b_flashcards_verso.png          | Flashcards: verso                    | Jardim noturno       | Computador  |
| C.14   | C09_acessibilidade.png             | Leitura e foco (acessibilidade)      | Alto contraste claro | Computador  |
| C.15   | C10_planejamento.png               | Planejar                             | Matcha               | Computador  |
| C.16   | C11_painel_foco.png                | Painel de foco lateral               | Planner              | Computador  |
| C.17   | C12_focar.png                      | Focar                                | Jardim noturno       | Computador  |
| C.18   | C13_aulas_demonstracao.png         | Aulas de demonstração                | Escrivaninha lavanda | Computador  |
| C.19   | C13b_conta_participante.png        | Conta de participante do teste       | Escrivaninha lavanda | Computador  |
| C.20   | C14_tutorial.png                   | Tutorial guiado                      | Matcha               | Computador  |
| C.21   | C00_inicio_celular.png             | Início                               | Jardim noturno       | Celular     |
| C.22   | C03_transcricao_player_celular.png | Aula: player e transcrição           | Matcha               | Celular     |
| C.23   | C06_questoes_celular.png           | Questões                             | Jardim noturno       | Celular     |
| C.24   | C11_painel_foco_celular.png        | Painel de foco (folha inferior)      | Oceano               | Celular     |

Se preferir menos figuras no corpo do texto, um bom conjunto mínimo é C.1, C.2, C.5, C.6, C.9,
C.12, C.14, C.16 e C.22 (com C.24 ao lado de C.16); o resto pode ficar só no apêndice.

## Imagens

### Figura C.1 – C00_inicio.png

Tela inicial depois do login: saudação com a data, cartão “Continuar estudando” com o player da
última aula (forma de onda, porcentagem ouvida, última reprodução), próximas tarefas, flashcards do
dia, meta semanal de estudo e calendário do mês.

- Tema: Escrivaninha lavanda (padrão do aplicativo).
- Legenda sugerida: **Figura C.1 – Tela inicial com retomada da última aula, tarefas, flashcards e
  meta semanal. Fonte: elaborado pela autora (2026).**
- Onde usar: abertura da seção de resultados (visão geral do sistema).

### Figura C.2 – C01_envio_aula.png

“Nova transcrição”, passo 1 (Gravação e recorte), com o arquivo `aula-crase.mp3` escolhido: nome,
formato, tamanho e duração, forma de onda com alças de recorte, início e fim do trecho e audição do
trecho.

- Tema: Planner.
- Legenda sugerida: **Figura C.2 – Envio de uma gravação de aula, com forma de onda e recorte do
  trecho a transcrever. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento (fluxo de envio).

### Figura C.3 – C01b_envio_identificacao.png (página inteira)

Passo 2 (Identificação): título, disciplina, etiquetas, idioma da gravação, número de questões, a
escolha de guardar ou não o áudio depois da transcrição e a declaração de permissão de uso da
gravação.

- Tema: Planner.
- Legenda sugerida: **Figura C.3 – Identificação da aula, escolha de armazenamento e declaração de
  permissão de uso da gravação. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento (privacidade e direitos de uso) ou discussão ética.

### Figura C.4 – C02_processamento.png

Acompanhamento do processamento por etapas (envio concluído, na fila, transcrição do áudio, pronta
para revisão), com o aviso de que a pessoa pode sair e encontrar a aula na Biblioteca depois.

- Tema: Mesa digital.
- Legenda sugerida: **Figura C.4 – Acompanhamento do processamento da transcrição por etapas.
  Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento (processamento assíncrono e fila de trabalhos).

### Figura C.5 – C03_transcricao_player.png

Página da aula “Crase: quando usar o acento grave”: player com forma de onda, avanço e recuo de
10 s, legendas e velocidade; abas Transcrição, Resumo, Questões, Flashcards e Anotações; transcrição
segmentada com tempos e o trecho em reprodução destacado.

- Tema: Jardim noturno (escuro).
- Legenda sugerida: **Figura C.5 – Página da aula com player de áudio e transcrição segmentada
  sincronizada. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (tela principal de estudo).

### Figura C.6 – C04_revisao_confirmacao.png

Edição da transcrição por trechos e o botão “Confirmar e continuar”: o estudante confere o texto
antes que resumo, questões e cartões sejam gerados a partir dele.

- Tema: Sálvia.
- Legenda sugerida: **Figura C.6 – Conferência e confirmação da transcrição pelo estudante antes
  da geração dos materiais. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento (revisão humana) ou discussão sobre confiabilidade da IA.

### Figura C.7 – C04b_revisao_versoes.png

Janela “Versões da transcrição” com as revisões salvas, data e hora de cada uma e a opção de
restaurar.

- Tema: Sálvia.
- Legenda sugerida: **Figura C.7 – Histórico de versões da transcrição, com restauração de uma
  revisão anterior. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento (versionamento e rastreabilidade); opcional, junto da Figura C.6.

### Figura C.8 – C05_resumo.png

Aba Resumo: resumo da aula em tópicos (o que é crase, teste do masculino, quando não há crase,
casos especiais), com a revisão de origem indicada e as opções de versões, criar flashcards e gerar
novo resumo.

- Tema: Areia.
- Legenda sugerida: **Figura C.8 – Resumo da aula vinculado à revisão confirmada da transcrição.
  Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (materiais gerados).

### Figura C.9 – C06_questoes.png (página inteira)

Resolução de questões em tela cheia: progresso, correção a cada questão, opção de ouvir a questão,
alternativa marcada como correta e o retorno “Você acertou” com a explicação.

- Tema: Lavanda.
- Legenda sugerida: **Figura C.9 – Resolução de questões com correção imediata e explicação.
  Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (avaliação formativa).

### Figura C.10 – C07_biblioteca.png

Biblioteca organizada em pastas por disciplina (Biologia, Ciências, Física, Geografia, História,
Matemática, Português, Tecnologia), com o número de aulas de cada uma.

- Tema: Oceano.
- Legenda sugerida: **Figura C.10 – Biblioteca de aulas organizada por disciplinas. Fonte:
  elaborado pela autora (2026).**
- Onde usar: resultados (organização do acervo).

### Figura C.11 – C07b_biblioteca_pasta.png

Dentro de Português › Gramática: a unidade, o andamento e a aula de crase com a opção de abri-la.

- Tema: Oceano.
- Legenda sugerida: **Figura C.11 – Unidade dentro de uma disciplina, com a aula e o andamento.
  Fonte: elaborado pela autora (2026).**
- Onde usar: opcional, junto da Figura C.10.

### Figuras C.12 e C.13 – C08_flashcards.png e C08b_flashcards_verso.png

Revisão de flashcards do dia: frente (“O que é crase?”) e verso com a resposta e a autoavaliação
(De novo, Difícil, Bom, Fácil), que define quando o cartão volta.

- Tema: Jardim noturno (escuro).
- Legendas sugeridas: **Figura C.12 – Revisão de flashcards: frente do cartão. Fonte: elaborado
  pela autora (2026).** e **Figura C.13 – Verso do cartão com autoavaliação para a repetição
  espaçada. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (prática de recuperação e repetição espaçada). Podem ir lado a lado numa
  única figura.

### Figura C.14 – C09_acessibilidade.png (recorte da seção)

Seção “Leitura e foco” de Aparência, em quatro grupos: leitor de tela e navegação, conforto de
leitura (contraste, fonte, tamanho, espaçamento, guia de leitura), apoio ao foco e leitura em voz
alta, com prévia do texto.

- Tema: Alto contraste claro.
- Legenda sugerida: **Figura C.14 – Preferências de leitura e acessibilidade, no tema de alto
  contraste. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento ou resultados (acessibilidade e desenho inclusivo).

### Figura C.15 – C10_planejamento.png

Planejar: objetivo “Preparar a prova de Português” com prazo, progresso e tarefas ligadas às aulas,
além das abas Calendário e Tempo de estudo.

- Tema: Matcha.
- Legenda sugerida: **Figura C.15 – Planejamento de estudos com objetivos, tarefas e prazos.
  Fonte: elaborado pela autora (2026).**
- Onde usar: resultados, se o artigo tratar de autorregulação da aprendizagem.

### Figura C.16 – C11_painel_foco.png

Painel de foco aberto ao lado da aula de crase: bloco de foco em andamento (24:57), modos Foco,
Pausa, Longa e Livre, pausar e encerrar, e o tempo também no botão da barra superior. A pessoa
estuda e cronometra sem sair da aula.

- Tema: Planner.
- Legenda sugerida: **Figura C.16 – Painel de foco (técnica Pomodoro) aberto durante o estudo de
  uma aula. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (gestão do tempo e atenção). Combina bem com a Figura C.24.

### Figura C.17 – C12_focar.png

Página Focar: cronômetro de 25:00 em destaque, escolha do modo e o resumo da semana (minutos de
estudo por dia em relação à meta).

- Tema: Jardim noturno (escuro).
- Legenda sugerida: **Figura C.17 – Página de foco com cronômetro e minutos estudados na semana.
  Fonte: elaborado pela autora (2026).**
- Onde usar: opcional, junto da Figura C.16.

### Figura C.18 – C13_aulas_demonstracao.png

Topo da Biblioteca durante o período de testes: as três aulas de demonstração (Português, Ciências,
Tecnologia) com duração e conteúdo de cada uma, prontas para começar.

- Tema: Escrivaninha lavanda.
- Legenda sugerida: **Figura C.18 – Aulas de demonstração disponíveis para participantes do teste.
  Fonte: elaborado pela autora (2026).**
- Onde usar: metodologia (como os participantes experimentaram o sistema).

### Figura C.19 – C13b_conta_participante.png

Conta de participante: limites do período de testes (transcrição, gravações, resumos, questões,
flashcards) com o quanto já foi usado, acesso às aulas de demonstração e o percurso com nível e
marcos de estudo.

- Tema: Escrivaninha lavanda.
- Legenda sugerida: **Figura C.19 – Conta de participante com os limites de uso do período de
  testes. Fonte: elaborado pela autora (2026).**
- Onde usar: metodologia (condições do teste com usuários e controle de custos).

### Figura C.20 – C14_tutorial.png

Tutorial guiado mostrado na criação da conta, no passo 3 de 9 (“Biblioteca”), destacando o item do
menu com as opções Voltar e Próximo. Pode ser reaberto em Configurações.

- Tema: Matcha.
- Legenda sugerida: **Figura C.20 – Tutorial guiado apresentado no primeiro acesso. Fonte:
  elaborado pela autora (2026).**
- Onde usar: desenvolvimento (integração de novos usuários) ou resultados.

### Figura C.21 – C00_inicio_celular.png

Início no celular: menu recolhido, busca, saudação e o cartão “Continuar estudando” com o player,
seguido das próximas tarefas.

- Tema: Jardim noturno (escuro).
- Legenda sugerida: **Figura C.21 – Tela inicial em um celular. Fonte: elaborado pela autora
  (2026).**
- Onde usar: resultados (layout responsivo).

### Figura C.22 – C03_transcricao_player_celular.png

Aula de crase no celular: player com forma de onda, abas e transcrição com busca, seguir áudio,
tamanho da letra, versões e edição.

- Tema: Matcha.
- Legenda sugerida: **Figura C.22 – Página da aula com player e transcrição em um celular. Fonte:
  elaborado pela autora (2026).**
- Onde usar: resultados (layout responsivo); fica bem ao lado da Figura C.5.

### Figura C.23 – C06_questoes_celular.png (página inteira)

Questões no celular, com alternativas em cartões grandes para toque e a alternativa correta
marcada.

- Tema: Jardim noturno (escuro).
- Legenda sugerida: **Figura C.23 – Resolução de questões em um celular. Fonte: elaborado pela
  autora (2026).**
- Onde usar: opcional, junto da Figura C.9.

### Figura C.24 – C11_painel_foco_celular.png

No celular, o painel de foco abre como folha inferior sobre a aula, com o cronômetro (24:57) e o
tempo também no botão da barra superior.

- Tema: Oceano.
- Legenda sugerida: **Figura C.24 – Painel de foco como folha inferior em um celular. Fonte:
  elaborado pela autora (2026).**
- Onde usar: resultados, junto da Figura C.16.

## Observação para o texto

As figuras mostram a aparência e as funções da interface. Elas não comprovam por si a qualidade da
transcrição nem dos materiais gerados por IA em uso real, porque o conteúdo exibido é de
demonstração. Essas afirmações devem vir dos resultados do teste com participantes.
