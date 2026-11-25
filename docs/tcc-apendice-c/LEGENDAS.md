# Apêndice C – Capturas de tela do Voz em Estudo

| Item              | Valor                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| Branch            | `claude/keen-shannon-sj3ut5` (painel de foco lateral incluído)                                            |
| Data das capturas | 25/11/2026                                                                                                |
| Ambiente          | Front end real da versão 0.3.1 com API simulada e dados de demonstração; **não é o ambiente de produção** |
| Recursos ligados  | Os mesmos da produção em 25/11/2026 (inclusive caderno, turmas e flashcards por conjunto)                 |
| Navegador         | Chromium headless (Playwright), localidade `pt-BR`, fuso `America/Sao_Paulo`                              |
| Computador        | Janela de 1440 × 900 px, escala 2 (arquivos com 2880 px de largura)                                       |
| Celular           | Janela de 390 × 844 px com toque, escala 2 (arquivos com 780 px de largura); nome terminado em `_celular` |
| Total             | 46 imagens (36 no computador e 10 no celular)                                                             |
| Temas             | Um tema do aplicativo por tela, para mostrar a personalização junto com cada função                       |
| Script            | `node frontend/tests/support/tcc-captures.cjs` (com `BROWSER_EXECUTABLE` apontando para o Chromium)       |

## Como as imagens foram obtidas

- As telas são o código real do front end (HTML, CSS e JavaScript do repositório) rodando no
  navegador. Não há montagem, edição de imagem nem interface desenhada fora do aplicativo.
- O tema de cada tela foi escolhido pelo próprio mecanismo do aplicativo (a mesma preferência que
  a pessoa troca em Configurações > Aparência). Nenhuma cor foi alterada nas imagens. A página
  inicial pública tem visual próprio e não muda com o tema.
- O backend, o Supabase e os provedores de IA **não** foram usados. As respostas da API vêm da
  simulação dos testes automatizados (`frontend/tests/support/mock-app.cjs` e `mock-quiz.cjs`). O
  script acrescenta rotas com o conteúdo das aulas de demonstração.
- A única parte real do backend executada é a rota local de mídia (FFmpeg), que gera a forma de
  onda do arquivo escolhido no envio.
- Conteúdo: aulas de demonstração de `database/demo-lessons` (crase, vacinas, internet), originais
  da equipe, licença CC BY 4.0, narração sintetizada. Resumo, questões e cartões dessas aulas foram
  **escritos pela equipe**, não gerados pelo modelo de linguagem de produção. Os destaques e o
  texto do caderno foram escritos para a captura.
- A Biblioteca, o Início e as tentativas de questões também mostram aulas fictícias dos testes
  automatizados (Fotossíntese, Revolução Industrial etc.), que só têm título e metadados. As turmas
  e seus membros são fictícios.
- Perfil fictício ("Estudante"). Nenhum dado pessoal, credencial ou token real aparece. Datas e
  horários exibidos são os do momento da captura.
- Sugestão de nota no texto do TCC: _"As capturas foram obtidas com o front end do sistema em
  execução local, com dados de demonstração e serviços externos simulados."_

## Resumo

Os arquivos do .zip ficam em pastas por seção e começam pelo número da figura (`C01_…`). Entre parênteses, o nome do mesmo arquivo no repositório (`docs/tcc-apendice-c/`).

| Figura | Arquivo no .zip                                                                           | Tela                                 | Tema                                | Dispositivo |
| ------ | ----------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------- | ----------- |
| C.1    | 01_acesso_e_primeiro_uso/C01_landing.png (C15_landing.png)                                | Página inicial pública               | Própria da página                   | Computador  |
| C.2    | 01_acesso_e_primeiro_uso/C02_landing_celular.png (C15_landing_celular.png)                | Página inicial pública               | Própria da página                   | Celular     |
| C.3    | 01_acesso_e_primeiro_uso/C03_login.png (C16_login.png)                                    | Entrar                               | Sálvia                              | Computador  |
| C.4    | 01_acesso_e_primeiro_uso/C04_login_celular.png (C16_login_celular.png)                    | Entrar                               | Lavanda                             | Celular     |
| C.5    | 01_acesso_e_primeiro_uso/C05_cadastro.png (C16b_cadastro.png)                             | Criar conta                          | Sálvia                              | Computador  |
| C.6    | 01_acesso_e_primeiro_uso/C06_cadastro_celular.png (C16b_cadastro_celular.png)             | Criar conta                          | Lavanda                             | Celular     |
| C.7    | 01_acesso_e_primeiro_uso/C07_recuperar_senha.png (C28_recuperar_senha.png)                | Recuperar senha                      | Areia                               | Computador  |
| C.8    | 01_acesso_e_primeiro_uso/C08_tutorial.png (C14_tutorial.png)                              | Tutorial guiado                      | Matcha                              | Computador  |
| C.9    | 02_inicio/C09_inicio.png (C00_inicio.png)                                                 | Início (painel)                      | Escrivaninha lavanda                | Computador  |
| C.10   | 02_inicio/C10_inicio_celular.png (C00_inicio_celular.png)                                 | Início                               | Jardim noturno                      | Celular     |
| C.11   | 03_envio_e_processamento/C11_envio_aula.png (C01_envio_aula.png)                          | Nova transcrição: gravação e recorte | Planner                             | Computador  |
| C.12   | 03_envio_e_processamento/C12_envio_identificacao.png (C01b_envio_identificacao.png)       | Nova transcrição: identificação      | Planner                             | Computador  |
| C.13   | 03_envio_e_processamento/C13_processamento.png (C02_processamento.png)                    | Processamento                        | Mesa digital                        | Computador  |
| C.14   | 04_pagina_da_aula/C14_transcricao_player.png (C03_transcricao_player.png)                 | Player e transcrição                 | Jardim noturno                      | Computador  |
| C.15   | 04_pagina_da_aula/C15_transcricao_player_celular.png (C03_transcricao_player_celular.png) | Player e transcrição                 | Matcha                              | Celular     |
| C.16   | 04_pagina_da_aula/C16_revisao_confirmacao.png (C04_revisao_confirmacao.png)               | Revisão da transcrição               | Sálvia                              | Computador  |
| C.17   | 04_pagina_da_aula/C17_revisao_versoes.png (C04b_revisao_versoes.png)                      | Versões da transcrição               | Sálvia                              | Computador  |
| C.18   | 04_pagina_da_aula/C18_resumo.png (C05_resumo.png)                                         | Resumo                               | Areia                               | Computador  |
| C.19   | 04_pagina_da_aula/C19_questoes.png (C06_questoes.png)                                     | Questões                             | Lavanda                             | Computador  |
| C.20   | 04_pagina_da_aula/C20_questoes_celular.png (C06_questoes_celular.png)                     | Questões                             | Jardim noturno                      | Celular     |
| C.21   | 04_pagina_da_aula/C21_anotacoes.png (C21_anotacoes.png)                                   | Anotações: caderno e destaques       | Alto contraste claro (fundo branco) | Computador  |
| C.22   | 04_pagina_da_aula/C22_caderno.png (C21b_caderno.png)                                      | Caderno da aula aberto               | Alto contraste claro (fundo branco) | Computador  |
| C.23   | 04_pagina_da_aula/C23_anotacoes_celular.png (C21_anotacoes_celular.png)                   | Anotações                            | Sálvia                              | Celular     |
| C.24   | 04_pagina_da_aula/C24_caderno_celular.png (C21b_caderno_celular.png)                      | Caderno da aula aberto               | Sálvia                              | Celular     |
| C.25   | 05_biblioteca_e_revisao/C25_biblioteca.png (C07_biblioteca.png)                           | Biblioteca                           | Oceano                              | Computador  |
| C.26   | 05_biblioteca_e_revisao/C26_biblioteca_pasta.png (C07b_biblioteca_pasta.png)              | Biblioteca: unidade                  | Oceano                              | Computador  |
| C.27   | 05_biblioteca_e_revisao/C27_flashcards.png (C08_flashcards.png)                           | Flashcards: frente                   | Jardim noturno                      | Computador  |
| C.28   | 05_biblioteca_e_revisao/C28_flashcards_verso.png (C08b_flashcards_verso.png)              | Flashcards: verso                    | Jardim noturno                      | Computador  |
| C.29   | 05_biblioteca_e_revisao/C29_flashcards_conjuntos.png (C25_flashcards_conjuntos.png)       | Flashcards: conjuntos                | Matcha                              | Computador  |
| C.30   | 05_biblioteca_e_revisao/C30_listas_questoes.png (C23_listas_questoes.png)                 | Questões: tentativas e novas listas  | Lavanda                             | Computador  |
| C.31   | 06_planejamento_e_foco/C31_planejamento.png (C10_planejamento.png)                        | Planejar: objetivos e tarefas        | Matcha                              | Computador  |
| C.32   | 06_planejamento_e_foco/C32_calendario.png (C24_calendario.png)                            | Planejar: calendário                 | Oceano                              | Computador  |
| C.33   | 06_planejamento_e_foco/C33_tempo_estudo.png (C24b_tempo_estudo.png)                       | Planejar: tempo de estudo            | Oceano                              | Computador  |
| C.34   | 06_planejamento_e_foco/C34_painel_foco.png (C11_painel_foco.png)                          | Painel de foco lateral               | Planner                             | Computador  |
| C.35   | 06_planejamento_e_foco/C35_painel_foco_celular.png (C11_painel_foco_celular.png)          | Painel de foco                       | Oceano                              | Celular     |
| C.36   | 06_planejamento_e_foco/C36_focar.png (C12_focar.png)                                      | Focar                                | Jardim noturno                      | Computador  |
| C.37   | 07_turmas/C37_turmas.png (C27_turmas.png)                                                 | Turmas                               | Planner                             | Computador  |
| C.38   | 07_turmas/C38_turma.png (C27b_turma.png)                                                  | Turma aberta                         | Planner                             | Computador  |
| C.39   | 08_conta_e_personalizacao/C39_perfil.png (C17_perfil.png)                                 | Meu perfil                           | Lavanda                             | Computador  |
| C.40   | 08_conta_e_personalizacao/C40_perfil_celular.png (C17_perfil_celular.png)                 | Meu perfil                           | Areia                               | Celular     |
| C.41   | 08_conta_e_personalizacao/C41_configuracoes.png (C18_configuracoes.png)                   | Configurações                        | Oceano                              | Computador  |
| C.42   | 08_conta_e_personalizacao/C42_aparencia.png (C19_aparencia.png)                           | Aparência                            | Areia                               | Computador  |
| C.43   | 08_conta_e_personalizacao/C43_acessibilidade.png (C09_acessibilidade.png)                 | Leitura e foco (acessibilidade)      | Alto contraste claro                | Computador  |
| C.44   | 08_conta_e_personalizacao/C44_ajuda.png (C20_ajuda.png)                                   | Ajuda                                | Mesa digital                        | Computador  |
| C.45   | 09_programa_de_testes/C45_aulas_demonstracao.png (C13_aulas_demonstracao.png)             | Aulas de demonstração                | Escrivaninha lavanda                | Computador  |
| C.46   | 09_programa_de_testes/C46_conta_participante.png (C13b_conta_participante.png)            | Conta de participante                | Escrivaninha lavanda                | Computador  |

Se preferir menos figuras no corpo do texto, um conjunto mínimo é C.1, C.9, C.11, C.14, C.16, C.19, C.22, C.27, C.34, C.43 e C.15; o resto pode ficar só no apêndice.

## Imagens

### Acesso e primeiro uso

#### Figura C.1 – C01_landing.png

Página de apresentação vista antes do login: chamada principal, o que o aplicativo faz, botões "Começar a estudar" e "Conhecer os recursos" e links para recursos, funcionamento e o projeto.

- Tema: Própria da página. Dispositivo: computador.
- Legenda sugerida: **Figura C.1 – Página inicial pública do Voz em Estudo. Fonte: elaborado pela autora (2026).**
- Onde usar: introdução ou desenvolvimento (apresentação do sistema).

#### Figura C.2 – C02_landing_celular.png

A mesma página inicial em um celular, com o menu e a chamada reorganizados para a tela estreita.

- Tema: Própria da página. Dispositivo: celular.
- Legenda sugerida: **Figura C.2 – Página inicial pública em um celular. Fonte: elaborado pela autora (2026).**
- Onde usar: opcional, junto da figura anterior (layout responsivo).

#### Figura C.3 – C03_login.png

Tela de login com e-mail e senha, opção de mostrar a senha, "Esqueci minha senha" e "Criar conta".

- Tema: Sálvia. Dispositivo: computador.
- Legenda sugerida: **Figura C.3 – Tela de acesso à conta. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento (autenticação).

#### Figura C.4 – C04_login_celular.png

Login em um celular, com o formulário abaixo da apresentação.

- Tema: Lavanda. Dispositivo: celular.
- Legenda sugerida: **Figura C.4 – Tela de acesso à conta em um celular. Fonte: elaborado pela autora (2026).**
- Onde usar: opcional (layout responsivo).

#### Figura C.5 – C05_cadastro.png

Cadastro com e-mail, senha e confirmação, e a lista de requisitos da senha (8 caracteres, letras maiúsculas e minúsculas, número e símbolo) que é marcada enquanto a pessoa digita.

- Tema: Sálvia. Dispositivo: computador.
- Legenda sugerida: **Figura C.5 – Cadastro com requisitos de senha visíveis. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento (segurança da conta).

#### Figura C.6 – C06_cadastro_celular.png

O cadastro em um celular.

- Tema: Lavanda. Dispositivo: celular.
- Legenda sugerida: **Figura C.6 – Cadastro em um celular. Fonte: elaborado pela autora (2026).**
- Onde usar: opcional (layout responsivo).

#### Figura C.7 – C07_recuperar_senha.png

Pedido de um link por e-mail para criar uma nova senha.

- Tema: Areia. Dispositivo: computador.
- Legenda sugerida: **Figura C.7 – Recuperação de senha. Fonte: elaborado pela autora (2026).**
- Onde usar: opcional, junto do login.

#### Figura C.8 – C08_tutorial.png

Tutorial mostrado na criação da conta, no passo 3 de 9 ("Biblioteca"), destacando o item do menu, com Voltar e Próximo. Pode ser reaberto em Configurações e na Ajuda.

- Tema: Matcha. Dispositivo: computador.
- Legenda sugerida: **Figura C.8 – Tutorial guiado apresentado no primeiro acesso. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento (integração de novos usuários) ou resultados.

### Início

#### Figura C.9 – C09_inicio.png

Tela inicial depois do login: saudação com a data, cartão "Continuar estudando" com o player da última aula (forma de onda, porcentagem ouvida, última reprodução), próximas tarefas, flashcards do dia, meta semanal de estudo e calendário do mês.

- Tema: Escrivaninha lavanda. Dispositivo: computador.
- Legenda sugerida: **Figura C.9 – Tela inicial com retomada da última aula, tarefas, flashcards e meta semanal. Fonte: elaborado pela autora (2026).**
- Onde usar: abertura da seção de resultados (visão geral).

#### Figura C.10 – C10_inicio_celular.png

Início em um celular: menu recolhido, busca, saudação e o cartão "Continuar estudando", seguido das próximas tarefas.

- Tema: Jardim noturno. Dispositivo: celular.
- Legenda sugerida: **Figura C.10 – Tela inicial em um celular. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (layout responsivo).

### Envio e processamento

#### Figura C.11 – C11_envio_aula.png

Passo 1 com o arquivo aula-crase.mp3 escolhido: nome, formato, tamanho e duração, forma de onda com alças de recorte, início e fim do trecho e audição do trecho.

- Tema: Planner. Dispositivo: computador.
- Legenda sugerida: **Figura C.11 – Envio de uma gravação de aula, com forma de onda e recorte do trecho a transcrever. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento (fluxo de envio).

#### Figura C.12 – C12_envio_identificacao.png

Passo 2 (página inteira): título, disciplina, etiquetas, idioma da gravação, número de questões, escolha de guardar ou não o áudio e declaração de permissão de uso da gravação.

- Tema: Planner. Dispositivo: computador.
- Legenda sugerida: **Figura C.12 – Identificação da aula, escolha de armazenamento e declaração de permissão de uso da gravação. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento (privacidade e direitos de uso) ou discussão ética.

#### Figura C.13 – C13_processamento.png

Acompanhamento por etapas (envio concluído, na fila, transcrição do áudio, pronta para revisão), com o aviso de que a pessoa pode sair e encontrar a aula na Biblioteca depois.

- Tema: Mesa digital. Dispositivo: computador.
- Legenda sugerida: **Figura C.13 – Acompanhamento do processamento da transcrição por etapas. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento (processamento assíncrono e fila de trabalhos).

### Página da aula

#### Figura C.14 – C14_transcricao_player.png

Aula "Crase: quando usar o acento grave": player com forma de onda, avanço e recuo de 10 s, legendas e velocidade; abas Transcrição, Resumo, Questões, Flashcards e Anotações; transcrição segmentada com tempos e o trecho em reprodução destacado.

- Tema: Jardim noturno. Dispositivo: computador.
- Legenda sugerida: **Figura C.14 – Página da aula com player de áudio e transcrição segmentada sincronizada. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (tela principal de estudo).

#### Figura C.15 – C15_transcricao_player_celular.png

A mesma aula em um celular: player, abas e transcrição com busca, seguir áudio, tamanho da letra, versões e edição.

- Tema: Matcha. Dispositivo: celular.
- Legenda sugerida: **Figura C.15 – Página da aula com player e transcrição em um celular. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (layout responsivo), ao lado da figura anterior.

#### Figura C.16 – C16_revisao_confirmacao.png

Edição da transcrição por trechos e o botão "Confirmar e continuar": o estudante confere o texto antes que resumo, questões e cartões sejam gerados a partir dele.

- Tema: Sálvia. Dispositivo: computador.
- Legenda sugerida: **Figura C.16 – Conferência e confirmação da transcrição pelo estudante antes da geração dos materiais. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento (revisão humana) ou discussão sobre confiabilidade da IA.

#### Figura C.17 – C17_revisao_versoes.png

Janela com as revisões salvas, data e hora de cada uma e a opção de restaurar.

- Tema: Sálvia. Dispositivo: computador.
- Legenda sugerida: **Figura C.17 – Histórico de versões da transcrição, com restauração de uma revisão anterior. Fonte: elaborado pela autora (2026).**
- Onde usar: opcional, junto da figura anterior (rastreabilidade).

#### Figura C.18 – C18_resumo.png

Resumo da aula em tópicos (o que é crase, teste do masculino, quando não há crase, casos especiais), com a revisão de origem e as opções de versões, criar flashcards e gerar novo resumo.

- Tema: Areia. Dispositivo: computador.
- Legenda sugerida: **Figura C.18 – Resumo da aula vinculado à revisão confirmada da transcrição. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (materiais gerados).

#### Figura C.19 – C19_questoes.png

Resolução em tela cheia (página inteira): progresso, correção a cada questão, ouvir a questão, alternativa marcada como correta e o retorno com a explicação.

- Tema: Lavanda. Dispositivo: computador.
- Legenda sugerida: **Figura C.19 – Resolução de questões com correção imediata e explicação. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (avaliação formativa).

#### Figura C.20 – C20_questoes_celular.png

Questões em um celular (página inteira), com alternativas em cartões grandes para toque.

- Tema: Jardim noturno. Dispositivo: celular.
- Legenda sugerida: **Figura C.20 – Resolução de questões em um celular. Fonte: elaborado pela autora (2026).**
- Onde usar: opcional, junto da figura anterior.

#### Figura C.21 – C21_anotacoes.png

Aba Anotações (página inteira): o caderno da aula fechado e a lista "Destaques da aula", com trechos marcados na transcrição, comentários e as ações citar no caderno, ir ao destaque, ouvir o trecho e editar.

- Tema: Alto contraste claro (fundo branco). Dispositivo: computador.
- Legenda sugerida: **Figura C.21 – Destaques da transcrição com comentários e o caderno da aula. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (anotação e estudo ativo).

#### Figura C.22 – C22_caderno.png

Caderno simulado aberto, com as opções "Capa e papel" à mostra (11 capas e 7 papéis: pautado, quadriculado, pontilhado, linho, vegetal, creme envelhecido e kraft). Abaixo, o título, a barra de formatação (texto, título, subtítulo, listas, checklist, citação, citar trecho da aula) e uma página com anotações, lista numerada, citação da aula e checklist. O texto é salvo sozinho ("Salvo").

- Tema: Alto contraste claro (fundo branco). Dispositivo: computador.
- Legenda sugerida: **Figura C.22 – Caderno digital da aula, com escolha de capa e papel, formatação, citação da aula e checklist. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (anotação e organização pessoal).

#### Figura C.23 – C23_anotacoes_celular.png

O caderno fechado e os destaques em um celular.

- Tema: Sálvia. Dispositivo: celular.
- Legenda sugerida: **Figura C.23 – Destaques e caderno da aula em um celular. Fonte: elaborado pela autora (2026).**
- Onde usar: opcional (layout responsivo).

#### Figura C.24 – C24_caderno_celular.png

O caderno aberto em um celular, com a barra de formatação compacta.

- Tema: Sálvia. Dispositivo: celular.
- Legenda sugerida: **Figura C.24 – Caderno da aula em um celular. Fonte: elaborado pela autora (2026).**
- Onde usar: opcional (layout responsivo).

### Biblioteca e revisão

#### Figura C.25 – C25_biblioteca.png

Biblioteca organizada em pastas por disciplina (Biologia, Ciências, Física, Geografia, História, Matemática, Português, Tecnologia), com o número de aulas de cada uma.

- Tema: Oceano. Dispositivo: computador.
- Legenda sugerida: **Figura C.25 – Biblioteca de aulas organizada por disciplinas. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (organização do acervo).

#### Figura C.26 – C26_biblioteca_pasta.png

Dentro de Português > Gramática: a unidade, o andamento e a aula de crase.

- Tema: Oceano. Dispositivo: computador.
- Legenda sugerida: **Figura C.26 – Unidade dentro de uma disciplina, com a aula e o andamento. Fonte: elaborado pela autora (2026).**
- Onde usar: opcional, junto da figura anterior.

#### Figura C.27 – C27_flashcards.png

Revisão dos cartões do dia, com filtros por aula e conjunto, e a frente do cartão ("O que é crase?").

- Tema: Jardim noturno. Dispositivo: computador.
- Legenda sugerida: **Figura C.27 – Revisão de flashcards: frente do cartão. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (prática de recuperação).

#### Figura C.28 – C28_flashcards_verso.png

Verso com a resposta e a autoavaliação (De novo, Difícil, Bom, Fácil), que define quando o cartão volta.

- Tema: Jardim noturno. Dispositivo: computador.
- Legenda sugerida: **Figura C.28 – Verso do cartão com autoavaliação para a repetição espaçada. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados; pode ir lado a lado com a figura anterior.

#### Figura C.29 – C29_flashcards_conjuntos.png

Aba Conjuntos: o conjunto de cartões da aula de crase, com revisar, renomear, arquivar, exportar (CSV e Markdown) e excluir; atalhos para criar cartão, gerar com IA e importar.

- Tema: Matcha. Dispositivo: computador.
- Legenda sugerida: **Figura C.29 – Gerenciamento dos conjuntos de flashcards. Fonte: elaborado pela autora (2026).**
- Onde usar: opcional (organização e exportação dos cartões).

#### Figura C.30 – C30_listas_questoes.png

Página Questões: tentativas em andamento e concluídas, com continuar e ver resultado e erros, e o formulário para gerar uma nova lista a partir de uma aula transcrita.

- Tema: Lavanda. Dispositivo: computador.
- Legenda sugerida: **Figura C.30 – Histórico de tentativas e geração de novas listas de questões. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (avaliação formativa e acompanhamento dos erros).

### Planejamento e foco

#### Figura C.31 – C31_planejamento.png

Objetivo "Preparar a prova de Português" com prazo, progresso e tarefas ligadas às aulas.

- Tema: Matcha. Dispositivo: computador.
- Legenda sugerida: **Figura C.31 – Planejamento de estudos com objetivos, tarefas e prazos. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (autorregulação da aprendizagem).

#### Figura C.32 – C32_calendario.png

Calendário do mês com estudos agendados e prazos de tarefas, agenda do mês, agendar estudo e baixar o calendário (ICS).

- Tema: Oceano. Dispositivo: computador.
- Legenda sugerida: **Figura C.32 – Calendário de estudos com agenda e prazos. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (planejamento).

#### Figura C.33 – C33_tempo_estudo.png

Meta da semana, minutos por dia e o ritmo das últimas 12 semanas (média, melhor semana, semanas na meta, dias com estudo) e as aulas mais estudadas.

- Tema: Oceano. Dispositivo: computador.
- Legenda sugerida: **Figura C.33 – Acompanhamento do tempo de estudo em relação à meta semanal. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (autorregulação).

#### Figura C.34 – C34_painel_foco.png

Painel de foco aberto ao lado da aula: bloco em andamento (24:57), modos Foco, Pausa, Longa e Livre, pausar e encerrar, e o tempo também no botão da barra superior. A pessoa estuda e cronometra sem sair da aula.

- Tema: Planner. Dispositivo: computador.
- Legenda sugerida: **Figura C.34 – Painel de foco (técnica Pomodoro) aberto durante o estudo de uma aula. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (gestão do tempo e da atenção).

#### Figura C.35 – C35_painel_foco_celular.png

No celular, o painel de foco abre como folha inferior sobre a aula.

- Tema: Oceano. Dispositivo: celular.
- Legenda sugerida: **Figura C.35 – Painel de foco como folha inferior em um celular. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados, junto da figura anterior.

#### Figura C.36 – C36_focar.png

Página Focar: cronômetro de 25:00 em destaque, escolha do modo e os minutos de estudo por dia na semana.

- Tema: Jardim noturno. Dispositivo: computador.
- Legenda sugerida: **Figura C.36 – Página de foco com cronômetro e minutos estudados na semana. Fonte: elaborado pela autora (2026).**
- Onde usar: opcional, junto do painel de foco.

### Turmas

#### Figura C.37 – C37_turmas.png

Lista de turmas da pessoa (como professora e como aluna), com criar turma e entrar com código. Turmas e nomes são fictícios.

- Tema: Planner. Dispositivo: computador.
- Legenda sugerida: **Figura C.37 – Turmas: o professor publica aulas e os alunos estudam e enviam gravações. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (uso em sala de aula), se o artigo tratar disso.

#### Figura C.38 – C38_turma.png

Uma turma por dentro: aulas publicadas, envios, flashcards compartilhados, membros e materiais de apoio.

- Tema: Planner. Dispositivo: computador.
- Legenda sugerida: **Figura C.38 – Página de uma turma com aulas publicadas e materiais de apoio. Fonte: elaborado pela autora (2026).**
- Onde usar: opcional, junto da figura anterior.

### Conta e personalização

#### Figura C.39 – C39_perfil.png

Perfil com capa e avatar, "Meu percurso" (nível e pontos), números de aulas, revisões e questões, e os marcos de estudo com o progresso de cada um.

- Tema: Lavanda. Dispositivo: computador.
- Legenda sugerida: **Figura C.39 – Perfil do estudante com percurso e marcos de estudo. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (motivação e gamificação leve).

#### Figura C.40 – C40_perfil_celular.png

O perfil em um celular.

- Tema: Areia. Dispositivo: celular.
- Legenda sugerida: **Figura C.40 – Perfil do estudante em um celular. Fonte: elaborado pela autora (2026).**
- Onde usar: opcional (layout responsivo).

#### Figura C.41 – C41_configuracoes.png

Configurações agrupadas: conta e forma de acesso, aparência e leitura, idioma da interface, sons, segurança, privacidade e dados, ajuda e sair.

- Tema: Oceano. Dispositivo: computador.
- Legenda sugerida: **Figura C.41 – Configurações da conta, aparência, idioma, privacidade e ajuda. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento ou resultados.

#### Figura C.42 – C42_aparencia.png

Espaço de estudo: modo de experiência (silencioso, aconchegante, aventura) e as atmosferas com prévia, que mudam cores, ilustração e sons.

- Tema: Areia. Dispositivo: computador.
- Legenda sugerida: **Figura C.42 – Personalização do espaço de estudo com atmosferas e modos de experiência. Fonte: elaborado pela autora (2026).**
- Onde usar: resultados (personalização).

#### Figura C.43 – C43_acessibilidade.png

Recorte da seção "Leitura e foco", em quatro grupos: leitor de tela e navegação, conforto de leitura (contraste, fonte, tamanho, espaçamento, guia de leitura), apoio ao foco e leitura em voz alta, com prévia do texto.

- Tema: Alto contraste claro. Dispositivo: computador.
- Legenda sugerida: **Figura C.43 – Preferências de leitura e acessibilidade, no tema de alto contraste. Fonte: elaborado pela autora (2026).**
- Onde usar: desenvolvimento ou resultados (acessibilidade e desenho inclusivo).

#### Figura C.44 – C44_ajuda.png

Central de ajuda com busca, tópicos, o atalho para rever o tutorial e o quadro "Onde fica cada coisa".

- Tema: Mesa digital. Dispositivo: computador.
- Legenda sugerida: **Figura C.44 – Central de ajuda do aplicativo. Fonte: elaborado pela autora (2026).**
- Onde usar: opcional.

### Programa de testes

#### Figura C.45 – C45_aulas_demonstracao.png

Topo da Biblioteca durante o período de testes: as três aulas de demonstração (Português, Ciências, Tecnologia), com duração e conteúdo de cada uma.

- Tema: Escrivaninha lavanda. Dispositivo: computador.
- Legenda sugerida: **Figura C.45 – Aulas de demonstração disponíveis para participantes do teste. Fonte: elaborado pela autora (2026).**
- Onde usar: metodologia (como os participantes experimentaram o sistema).

#### Figura C.46 – C46_conta_participante.png

Limites do período de testes (transcrição, gravações, resumos, questões, flashcards) com o quanto já foi usado.

- Tema: Escrivaninha lavanda. Dispositivo: computador.
- Legenda sugerida: **Figura C.46 – Conta de participante com os limites de uso do período de testes. Fonte: elaborado pela autora (2026).**
- Onde usar: metodologia (condições do teste e controle de custos).

## Observação para o texto

As figuras mostram a aparência e as funções da interface. Elas não comprovam por si a qualidade da
transcrição nem dos materiais gerados por IA em uso real, porque o conteúdo exibido é de
demonstração. Essas afirmações devem vir dos resultados do teste com participantes.
