# Apêndice C – Capturas de tela do Voz em Estudo

| Item | Valor |
| --- | --- |
| Branch | `claude/keen-shannon-sj3ut5` |
| Commit | `c62ae6d060c78c89eac4869d5f958d1c726f7ed1` (o front end é idêntico ao do commit anterior `e55551e`; o último commit altera só o backend) |
| Data das capturas | 24/11/2026 |
| Ambiente | Front end real da versão 0.3.1 (`frontend/package.json`) com API simulada e dados de demonstração; **não é o ambiente de produção** |
| Navegador | Chromium headless (Playwright), localidade `pt-BR`, fuso `America/Sao_Paulo` |
| Janela | 1440 × 900 px, `deviceScaleFactor` 2 (arquivos com 2880 px de largura) |
| Tema | Tema claro padrão do aplicativo (“Escrivaninha lavanda”), o mesmo em todas as imagens |
| Script | `node frontend/tests/support/tcc-captures.cjs` (com `BROWSER_EXECUTABLE` apontando para o Chromium) |

## Como as imagens foram obtidas

- As telas são o código real do front end (HTML, CSS e JavaScript do repositório) rodando no
  navegador. Não há montagem, edição de imagem nem interface desenhada fora do aplicativo.
- O backend, o Supabase e os provedores de IA **não** foram usados. As respostas da API vêm da
  simulação usada nos testes automatizados (`frontend/tests/support/mock-app.cjs` e
  `mock-quiz.cjs`), sem alteração desses arquivos. O script acrescenta, por cima da simulação,
  rotas que entregam o conteúdo das aulas de demonstração.
- A única parte real do backend executada é a rota local de mídia (`/api/media`, FFmpeg), que lê
  o arquivo escolhido no envio e gera a forma de onda (C01), como no teste `browser-check.cjs`.
- Conteúdo: aulas de demonstração de `database/demo-lessons` (crase, vacinas, internet), originais
  da equipe, licença CC BY 4.0, narração sintetizada (espeak-ng + MBROLA). Transcrição com tempos
  medidos no próprio áudio; resumo, questões e cartões **escritos pela equipe**, não gerados pelo
  LLM de produção. O áudio tocado no player é o `audio.mp3` real da aula (3min08).
- A biblioteca também mostra as aulas fictícias dos testes automatizados (Fotossíntese, Revolução
  Industrial etc.), que só têm título e metadados.
- Perfil fictício e neutro (“Estudante”, `estudante@exemplo.test`). Nenhum dado pessoal, credencial
  ou token real aparece. Datas e horários exibidos são os do momento da captura.

## Imagens

### C01_envio_aula.png
Tela “Nova transcrição”, passo 1 (Gravação & recorte), com o arquivo `aula-crase.mp3` já
escolhido: nome, formato, tamanho e duração, forma de onda com alças de recorte, campos de início e
fim do trecho, ouvir trecho, usar o arquivo inteiro e baixar trecho.

- Legenda sugerida: **Figura C.1 – Envio de uma gravação de aula, com forma de onda e recorte do
  trecho a transcrever. Fonte: elaborado pela autora (2026).**
- Onde usar: seção de desenvolvimento (fluxo de envio) ou de resultados (funcionalidades).

### C01b_envio_identificacao.png (página inteira)
Passo 2 (Identificação): título, disciplina, tags, quantidade de questões, idioma da gravação,
opção de guardar o áudio do trecho e a **declaração de permissão de uso** marcada (texto real da
declaração, `backend/src/config/permission-declaration.js`), com o painel “Privacidade e
armazenamento”.

- Legenda sugerida: **Figura C.2 – Identificação da aula e declaração de permissão de uso da
  gravação antes do envio. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento (requisitos de privacidade e direitos de uso) ou discussão ética.

### C02_processamento.png
Tela de processamento com um trabalho em andamento: “Transcrevendo o áudio…”, tempo decorrido e as
etapas Envio concluído → Na fila → Transcrição do áudio (atual) → Pronta para revisão. O estado do
trabalho (`EM_EXECUCAO`, etapa `TRANSCRICAO`) é fornecido pela API simulada.

- Legenda sugerida: **Figura C.3 – Acompanhamento do processamento da transcrição por etapas.
  Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento (processamento assíncrono / fila de trabalhos).

### C03_transcricao_player.png
Página da aula com o player (forma de onda, 00:14 de 03:07), abas Transcrição, Resumo, Questões,
Flashcards e Anotações, e a transcrição em trechos com marcação de tempo. O trecho atual
(00:11–00:19) aparece destacado porque o áudio real foi tocado até 14 s e pausado.

- Legenda sugerida: **Figura C.4 – Página da aula com player de áudio e transcrição segmentada
  com marcações de tempo; o trecho em reprodução fica destacado. Fonte: elaborado pela autora
  (2026).**
- Onde usar: resultados (tela principal de estudo).

### C04_revisao_confirmacao.png
Aula ainda com “Revisão pendente”: modo de conferência da transcrição, com os trechos editáveis
(revisão 2), o botão “Salvar alterações” e, ao final, “Confirmar e continuar” (“Confirmar registra
que você conferiu esta revisão”). Resumo, questões e cartões só usam a versão confirmada.

- Legenda sugerida: **Figura C.5 – Conferência e confirmação da transcrição pelo estudante antes
  da geração dos materiais de estudo. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento (revisão humana / “human-in-the-loop”) ou discussão sobre
  confiabilidade da IA.
- Observação: a barra “Editando a revisão 2” é fixa no topo; acima dela, o cabeçalho translúcido
  do aplicativo deixa entrever, desfocado, o trecho que rolou para baixo dele. É o comportamento
  normal da interface.

### C04b_revisao_versoes.png
Diálogo “Versões da transcrição”: revisões 2 (atual, sem restauração) e 1 (com “Restaurar”).

- Legenda sugerida: **Figura C.6 – Histórico de versões da transcrição, com restauração de uma
  revisão anterior. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento (versionamento e rastreabilidade).

### C05_resumo.png
Aba Resumo: “Resumo da aula” com versão, revisão de origem e data; seções com títulos, listas,
negrito e itálico; botões Versões, Criar flashcards, Gerar novo resumo e ouvir (leitura em voz alta).

- Legenda sugerida: **Figura C.7 – Resumo da aula vinculado à revisão confirmada da transcrição.
  Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (materiais gerados).
- Observação: o texto é o resumo escrito pela equipe para a aula de demonstração, no formato que o
  app usa para resumos gerados; não foi produzido pelo LLM.

### C06_questoes.png (página inteira)
Lista de questões (`responder.html`) no modo “Correção a cada questão”: questão 1 de 8 respondida,
alternativa B marcada como “Sua resposta · correta”, explicação e o “Trecho da aula” que fundamenta
a resposta.

- Legenda sugerida: **Figura C.8 – Resolução de questões com correção imediata, explicação e
  trecho da aula como evidência. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (avaliação formativa).

### C07_biblioteca.png
Biblioteca em pastas por disciplina (Biologia, Ciências, Física, Geografia, História, Matemática,
Português, Tecnologia), busca, “Nova disciplina” e total de aulas.

- Legenda sugerida: **Figura C.9 – Biblioteca de aulas organizada por disciplinas. Fonte:
  elaborado pela autora (2026).**
- Onde usar: resultados (organização do acervo).

### C07b_biblioteca_pasta.png
Pasta Português › Gramática aberta: progresso da unidade e a aula “Crase: quando usar o acento
grave” com duração e estado (“Ainda não iniciado”).

- Legenda sugerida: **Figura C.10 – Unidade dentro de uma disciplina, com a aula e o andamento do
  estudo. Fonte: elaborado pela autora (2026).**
- Onde usar: opcional, junto da Figura C.9.

### C08_flashcards.png e C08b_flashcards_verso.png
Revisão de hoje: cartão da aula de crase na frente (“O que é crase?”) e, na segunda imagem, o verso
com os botões de autoavaliação (De novo, Difícil, Bom, Fácil) usados na repetição espaçada.

- Legendas sugeridas: **Figura C.11 – Revisão de flashcards: frente do cartão. Fonte: elaborado
  pela autora (2026).** e **Figura C.12 – Verso do cartão e autoavaliação para a repetição
  espaçada. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados. Valor acadêmico: **sim**, mostra a prática de recuperação e a repetição
  espaçada derivadas da aula. Se houver limite de figuras, basta C08b (contém frente e verso).

### C09_acessibilidade.png (recorte da seção)
Seção “Leitura e foco” de Aparência: modo para leitores de tela, modo foco, navegação, menos
estímulos visuais, movimento reduzido, contraste reforçado, fonte de leitura (incl. Atkinson
Hyperlegible, Lexend, OpenDyslexic), tamanho do texto (90% a 200%), espaçamento, guia de leitura,
comprimento das linhas, prévia e leitura em voz alta com velocidade da voz.

- Legenda sugerida: **Figura C.13 – Preferências de leitura e acessibilidade. Fonte: elaborado
  pela autora (2026).**
- Onde usar: desenvolvimento ou resultados (acessibilidade / desenho inclusivo). Valor acadêmico:
  **sim**, é a melhor evidência visual das decisões de acessibilidade.

### C10_planejamento.png
Planejar › Objetivos e tarefas: objetivo “Preparar a prova de Português” com progresso (1 de 3,
33%), subobjetivo com prazo, tarefas vinculadas à aula (uma concluída) e prazos relativos.

- Legenda sugerida: **Figura C.14 – Planejamento de estudos com objetivos, tarefas e prazos
  vinculados às aulas. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados. Valor acadêmico: **moderado**; útil se o artigo trata de
  autorregulação/organização do estudo; caso contrário, é a primeira candidata a sair.

## Capturas não feitas e por quê

- **Ambiente de produção**: não há backend real nem credenciais neste ambiente; todas as imagens
  usam a API simulada.
- **Transcrição e geração reais por IA**: nenhuma imagem mostra saída do ASR ou do LLM de
  produção; o conteúdo é o das aulas de demonstração.
- **Avisos preliminares da IA** (adequação educacional, relação com a disciplina, suspeita
  factual): a simulação devolve a aula sem avisos, então o painel não aparece em C04.
- **Aba Questões da página da aula**: preferiu-se a tela de resolução (C06), que mostra a
  correção; a aba só lista as listas e tentativas.
- **Versões em celular e tema escuro**: fora do escopo pedido (mesmo tema e mesma janela em todas).

## Implementado × habilitado (feature flags)

- As capturas usam o conjunto de flags dos testes (`allFlags` de `mock-app.cjs`): ligados
  `planning`, `flashcards`, `flashcard_sets`, `study_tracking`, `annotations`, `calendar`,
  `sharing`, `study_authoring`, `catalog_units`, `quiz_v2`, `quiz_review`; desligados
  `flashcards_v3`, `multi_lesson`, `discoveries`, `journal`, `public_testing`.
- Em `backend/.env.example` **todas** essas flags vêm `false`. Planejamento, flashcards,
  unidades da biblioteca, questões v2 etc. existem no código, mas só aparecem numa implantação que
  as habilite. Este ambiente não permite saber quais estão ligadas em produção.
- O botão “Gerar com IA” (C08) e “Gerar novo resumo” (C05) aparecem, mas não foram acionados.

## Diferenças em relação ao que uma descrição do Apêndice C poderia esperar

- O app chama o envio de “Nova transcrição” (não “envio de aula”), em três passos: Gravação &
  recorte, Identificação, Processamento.
- O processamento não mostra porcentagem: só a etapa informada pelo servidor (decisão de projeto).
- O destaque durante a reprodução é **por trecho**, não por palavra: as aulas de demonstração não
  têm tempos por palavra (`words: null`).
- A revisão é um fluxo explícito: a aula fica “Revisão pendente” até o estudante confirmar; o
  histórico de versões lista revisões e permite restaurar, sem comparação lado a lado.
- A narração das aulas de demonstração é sintetizada; a transcrição não veio do ASR de produção.
