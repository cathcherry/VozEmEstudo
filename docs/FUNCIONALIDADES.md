# Funcionalidades do Voz em Estudo

Referência completa do que o aplicativo faz hoje, página por página. Para cada recurso indicamos
quando ele depende de uma **flag** (`FEATURE_*` no `backend/.env`) e de uma **migration** no banco.
A tabela [Disponibilidade](#disponibilidade-por-recurso) no fim diz o que já pode ser ligado no banco
de produção (`audioestudo`) e o que ainda depende de migrations não aplicadas.

> Atualizado em 20/11/2026, a partir do código da branch `feat/study-authoring-followups`
> (main + verificação de senhas). Detalhes técnicos: [API](API.md), [Banco de dados](BANCO_DE_DADOS.md),
> [Configuração](CONFIGURACAO.md), [Provedores de IA](AI_PROVIDERS.md).

## Sumário

1. [Visão geral do fluxo](#1-visão-geral-do-fluxo)
2. [Conta e acesso](#2-conta-e-acesso)
3. [Estrutura comum das páginas](#3-estrutura-comum-das-páginas)
4. [Início, Revisar e Planejar](#4-início-revisar-e-planejar)
5. [Nova transcrição (envio)](#5-nova-transcrição-envio)
6. [Processamento](#6-processamento)
7. [Biblioteca](#7-biblioteca)
8. [Página da aula (material)](#8-página-da-aula-material)
9. [Responder questões](#9-responder-questões)
10. [Perfil e marcos de estudo](#10-perfil-e-marcos-de-estudo)
11. [Configurações e aparência](#11-configurações-e-aparência)
12. [Acessibilidade](#12-acessibilidade)
13. [Compartilhamento público](#13-compartilhamento-público)
14. [Ajuda e privacidade](#14-ajuda-e-privacidade)
15. [Onde cada dado fica salvo](#15-onde-cada-dado-fica-salvo)
16. [Disponibilidade por recurso](#disponibilidade-por-recurso)
17. [Limitações conhecidas](#limitações-conhecidas)

---

## 1. Visão geral do fluxo

```
Gravação (áudio ou vídeo)
  → recorte no navegador (até ~54 min)            nova-transcricao.html
  → envio do trecho em MP3 compacto (retomável)   Supabase Storage
  → transcrição automática (worker + ASR)          processando.html
  → conferência humana: editar, avisos, confirmar  material.html › Transcrição
  → resumos, listas de questões, flashcards        material.html › Resumo / Questões
  → estudo: responder, revisar, exportar, compartilhar
```

### Fronteira da confirmação humana

| Etapa                                                                          | Precisa de confirmação? | Observação                                                                                                                                            |
| ------------------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transcrição automática                                                         | Não                     | Gera a versão 1 (imutável)                                                                                                                            |
| **Avisos de conteúdo** (adequação, relação com a disciplina, suspeita factual) | **Não**                 | Gerados logo após a transcrição para **ajudar** na conferência; ficam presos à versão analisada e podem ser refeitos ("Analisar novamente")           |
| Edição e restauração                                                           | Não                     | Cada mudança cria uma nova versão; a confirmação anterior deixa de valer para a versão atual                                                          |
| **Resumos e listas de questões**                                               | **Sim**                 | Só a versão **atual e confirmada**; o banco recusa outra (`TRANSCRIPTION_CONFIRMATION_REQUIRED` / `REVISION_CONFLICT`), mesmo em chamada direta à API |
| **Flashcards gerados por IA**                                                  | **Sim**                 | A prévia exige a versão atual confirmada; salvar cartões gerados exige que aquela versão tenha sido confirmada                                        |
| Cartões criados à mão                                                          | Não                     | Não usam IA                                                                                                                                           |

Cada resultado guarda a versão de origem. Se a transcrição muda depois, os resultados antigos não
mudam: aparecem como "desatualizados". Repetir uma tarefa já concluída não duplica o resultado.

## 2. Conta e acesso

Páginas: `login.html`, `cadastro.html`, `recuperar-senha.html`, `auth-callback.html`.

- **Entrar** com e-mail e senha, ou **Continuar com Google / GitHub** (aparecem só os provedores
  listados em `OAUTH_PROVIDERS`; ver [CONFIGURAR_LOGIN_SOCIAL.md](CONFIGURAR_LOGIN_SOCIAL.md)).
- **Criar conta**: a senha precisa cumprir as regras configuradas no Supabase (mínimo de 8,
  minúscula, maiúscula, número e símbolo). As cinco regras aparecem abaixo do campo e vão sendo
  marcadas enquanto a pessoa digita.
- **Senhas vazadas**: antes de enviar, a senha é conferida no _Have I Been Pwned_ por k-anonimato
  (só os 5 primeiros caracteres do hash SHA-1 saem do navegador). Senha vazada é recusada; se o
  serviço estiver fora do ar, a conferência é pulada. Substitui o recurso equivalente do Supabase,
  que só existe no plano Pro.
- **Esqueci minha senha**: envia o e-mail de recuperação; o link abre a etapa "Nova senha" com as
  mesmas regras.
- Erros de senha fraca do Supabase aparecem em português.
- O login conversa direto com o Supabase Auth (PKCE); o backend só valida o token em cada chamada.

## 3. Estrutura comum das páginas

- **Barra lateral**, organizada por atividade:
  - **Nova transcrição** (botão no topo): enviar uma aula.
  - **Início**: o que estudar agora (visão geral).
  - **Biblioteca**: todas as aulas; cada aula é onde se estuda.
  - **Revisar**: flashcards, tentativas de questões e anotações (aparece se ao menos um desses
    recursos estiver ativo).
  - **Planejar**: objetivos e tarefas, calendário e tempo de estudo (aparece se ao menos um desses
    recursos estiver ativo).
  - **Configurações**, no rodapé do menu.

  O menu pode ser recolhido, ou trocado por uma **barra inferior** (Aparência › Navegação); no modo
  foco, os mesmos destinos ficam no atalho de navegação do modo foco.

- **Barra superior**: busca na Biblioteca, atalho para Aparência, **Modo foco** (Alt+F, com A−/A+),
  e o menu da conta (Perfil, Configurações, Sair).
- **Atalhos**: `?` abre a lista de atalhos de teclado.
- **Nino**, o mascote, aparece em estados vazios e becos sem saída (busca sem resultado, link
  expirado, pasta vazia) com poses diferentes.

## 4. Início, Revisar e Planejar

### Início (`painel.html`)

Visão geral em duas colunas que terminam juntas; nada é editado aqui.

- **Coluna principal**: "Olá, {nome}" e a data; **Continuar estudando** (última aula, disciplina,
  trecho ouvido, **Continuar aula**); **Próximas tarefas** e **Flashcards** lado a lado, cada um com
  a contagem no título, um link "Ver todas/Ver todos" e no máximo um botão (Adicionar tarefa,
  Revisar N cartões); **Aulas recentes** (até 6) com **Mais revisitados**.
- **Coluna da direita** (um painel contínuo): **Sua semana** (minutos, meta e barras por dia),
  **o mês** com o dia de hoje e pontos nos dias com estudo ou prazo, os próximos 3 itens e
  **Agendar estudo**; **Suas disciplinas**; **Anotações**.
- Cartões de recursos desligados não aparecem. Sem dados, o cartão diz para que serve em uma frase e
  oferece um primeiro passo, sem mascote e sem números zerados ou gráficos vazios.
- Com o menu lateral visível, **Nova transcrição** fica só no menu; em telas estreitas e no modo
  foco, também ao lado da saudação. Em telas médias a coluna da direita vira um bloco de duas
  colunas (calendário de um lado); no celular, tudo em uma coluna.
- **Personalizar** (ao lado da saudação) abre uma folha lateral: mostrar ou ocultar cada cartão
  opcional (tarefas, flashcards, aulas recentes, semana, agenda, disciplinas, anotações), mover os
  blocos dentro da coluna com ↑/↓, escolher o **espaçamento dos cartões** (confortável/compacto) e
  **Restaurar padrão**. Tudo vale na hora e fica salvo na conta (`profile_state`, chave
  `dashboard-layout`); sem conexão, vale neste aparelho e sincroniza depois. "Continuar
  estudando", o menu e a conta nunca podem ser ocultados. Uma conta nova (ou outra conta no mesmo
  navegador) vê o layout padrão.

**Busca global** (`GET /api/search`): títulos, enunciados de questões e transcrição, sem diferenciar
acentos, com sugestões enquanto se digita. Resultados em abas (Aulas, Questões, Transcrições e, com
`annotations`, **Anotações**) que só aparecem quando têm resultados; o botão da aba Anotações abre
Revisar › Anotações com a mesma busca. Gabaritos nunca entram na busca.

### Revisar (`revisar.html`)

Uma aba por recurso ativo, com endereço próprio (`#flashcards`, `#questoes`, `#anotacoes`):

- **Flashcards** (`flashcards`): revisão do dia (De novo / Difícil / Bom / Fácil, com o foco
  acompanhando a revisão pelo teclado); **Gerar cartões com IA** e **Criar cartão manualmente**
  (recolhidos); **Organizar meus cartões** (filtros, edição, arquivar, excluir, histórico) e, com
  `flashcard_sets`, **Conjuntos de flashcards** (renomear, arquivar, exportar CSV ou Markdown).
- **Questões** (`quiz_v2`): todas as tentativas, em andamento (**Continuar tentativa**) e concluídas
  (**Ver resultado e erros**, onde fica "Refazer apenas as questões erradas").
- **Anotações** (`annotations`): busca e paginação em todas as anotações, com link para a aula.

### Planejar (`planejar.html`)

Abas `#tarefas`, `#calendario`, `#tempo`:

- **Objetivos e tarefas** (`planning`): **Novo objetivo / Nova tarefa / Novo subobjetivo** abrem um
  formulário de cada vez; cada objetivo tem **Adicionar tarefa** e **Adicionar subobjetivo** com o
  objetivo já escolhido. Filtros, ordem manual, edição, aula relacionada e link de apoio.
- **Calendário** (`calendar`): mês, agenda do dia, **Agendar estudo** (recolhido até ser pedido),
  edição, horário ligado a tarefa e exportação **.ics**.
- **Tempo de estudo** (`study_tracking`): cronômetro (estudo livre ou Pomodoro 25/5), minutos por
  dia; **Meta semanal e fuso horário** e **Sincronização** recolhidos (abrem sozinhos num conflito).

Links diretos usados pelo Início: `planejar.html?criar=objetivo|tarefa#tarefas`,
`planejar.html?criar=horario#calendario`, `revisar.html?acao=revisar#flashcards`,
`revisar.html?busca=…#anotacoes`. Com todas as flags de uma página desligadas, ela explica que o
recurso não está ativo.

## 5. Nova transcrição (envio)

Página: `nova-transcricao.html`. Três etapas: **Gravação & recorte → Identificação → Processamento**.

1. **Gravação & recorte**
   - Arraste ou escolha um arquivo: MP4, MOV, WebM, MP3, WAV, M4A, AAC, OGG ou FLAC, até 100 MB
     e 2 horas.
   - O servidor inspeciona o arquivo (duração, se tem vídeo, forma de onda).
   - Player com recorte: alças na forma de onda, campos de início/fim, **Ouvir trecho**,
     **Usar arquivo inteiro**. O trecho para transcrição pode ter **até ~54 minutos**.
   - **Baixar trecho** salva o recorte (MP3, ou MP4 se houver vídeo).
2. **Identificação**
   - Título, Disciplina, quantidade inicial de questões (3/5/10/20) e tags.
   - **Idioma da gravação** (quando o provedor permite: automático, português, inglês, espanhol,
     chinês).
   - **Guardar após transcrever**: o áudio do trecho e, com `mp4_retention`, o **vídeo MP4
     original** inteiro (para assistir com legendas depois).
   - **Declaração de permissão** obrigatória (a pessoa declara que pode usar a gravação). Se o
     texto da declaração mudar, é preciso confirmar de novo.
3. **Revisar envio → Enviar e transcrever**
   - **No servidor (backend)**: o arquivo escolhido é enviado à API para inspeção e recorte; o FFmpeg
     devolve o trecho em **MP3 mono compacto** (~0,5 MB/min). Nada é guardado no servidor nessa etapa
     (pasta temporária apagada em seguida).
   - **Direto ao Storage**: o navegador envia esse MP3 ao Supabase Storage por **upload retomável**
     (blocos de 6 MB; se a conexão cair, continua de onde parou) e só então a API registra a aula.
   - O mesmo identificador da aula é reaproveitado em novas tentativas: um envio repetido reutiliza
     o arquivo já enviado em vez de duplicá-lo.
   - O progresso aparece numa barra; se a conexão não voltar, a mensagem explica e nada é perdido.

## 6. Processamento

Página: `processando.html`.

- Acompanha a tarefa: Envio concluído → Na fila → Transcrição do áudio → Pronta para revisão.
- Pode-se sair da página; a aula aparece na Biblioteca quando terminar.
- Ao final, o áudio é **apagado** ou **guardado** conforme a escolha do envio, e são gerados os três
  **avisos de conteúdo** (antes da confirmação, para ajudar na conferência).
- Com a AssemblyAI, a tarefa espera o serviço externo entre consultas (a cada ~15 s). A página mostra
  "Transcrevendo o áudio…" durante essa espera; **não é uma falha**.
- Falhas temporárias (rede, serviço indisponível, resposta inválida) são repetidas automaticamente,
  até 3 tentativas; a página mostra "Aguardando nova tentativa (tentativa n de 3)". Esgotadas, mostra
  o erro e **Tentar novamente**.
- Se o worker for fechado no meio de uma tarefa, ela é retomada depois de 10 minutos
  (`WORKER_STALE_LEASE_SECONDS`).
- O envio à AssemblyAI é registrado antes de acontecer: uma repetição continua a mesma transcrição
  em vez de pagar outra.

## 7. Biblioteca

Página: `historico.html`.

- Busca, visualização em **Grade** ou **Lista**, e **Filtros**: por aula ou por tipo de recurso,
  disciplina, tag, situação (prontos, em processamento, com erro), progresso de estudo e ordenação.
- Menu **⋯** de cada aula: Abrir aula, Editar transcrição, Editar informações, Ver questões, Gerar novas
  questões, Mover para pasta, Excluir material (com confirmação).
- **Editar informações**: título, disciplina, pasta/unidade e até 12 tags extras.
- **Pastas** (`catalog_units`, E03): disciplinas e unidades como pastas, criação com **+**,
  arrastar-e-soltar aulas, ícone PNG personalizado.
  - Menu **⋯** da disciplina: **Editar** (nome e ícone) e **Remover**. Remover nunca apaga aulas:
    elas vão para "Sem disciplina", e as unidades da disciplina são removidas.

## 8. Página da aula (material)

Página: `material.html`. Cabeçalho com **Editar informações** (título, disciplina e tags, na
Biblioteca), **Exportar** e **Compartilhar**; player; **etapas de estudo**; três abas:
**Transcrição | Resumo | Questões** (setas/Home/End; endereços `#transcricao`, `#resumo`,
`#questoes`). Depois do conteúdo: **Cronômetro de estudo** (aberto) e **Anotações e destaques desta
aula** (recolhido), quando as flags estão ligadas, e **Marcar aula como estudada**.

### Etapas de estudo

Mostra onde a aula está e o próximo passo, com um único botão principal:
**1 Conferir transcrição → 2 Resumo → 3 Questões → 4 Flashcards** (a 4ª só com
`flashcards` + `flashcard_sets`). Cada etapa leva à aba correspondente; resumo, questões e
flashcards ficam travados até a transcrição ser confirmada (nesse momento, a ação da página já é
"Conferir transcrição" / "Confirmar e continuar"). O próximo passo usa os botões existentes:
**Gerar resumo**, **Criar questões** (abre "Gerar lista de questões"), **Responder a lista** e
**Criar flashcards**. Questões contam como feitas quando há resposta registrada ou tentativa na
conta. Com tudo feito: "Aula estudada" e o link para Revisar.

### Player

- Áudio ou vídeo (se o MP4 original foi guardado), velocidade 0,75×–2×, ±10 s, forma de onda,
  tela cheia, teclas Espaço/K e ←/→.
- **Legendas**: desligadas, por trecho ou **palavra a palavra** (quando o provedor fornece tempos de
  palavra); tamanho, cor e fundo ajustáveis.
- **Remover vídeo** apaga o MP4 guardado.

### Aba Transcrição

- Texto em trechos com horário; clicar ou Enter no horário toca a partir dali, e o trecho atual
  acompanha a reprodução.
- **Buscar na transcrição** com navegação entre resultados; os termos ficam em negrito.
- **Editar transcrição** → salvar cria uma nova **versão**; **Versões** permite restaurar qualquer
  versão anterior (como nova versão, sem apagar histórico).
- **Pontos para conferir**: os três avisos de conteúdo, com citações, e **Analisar novamente**.
- **Confirmar e continuar**: confirma a revisão atual. É o que libera resumo, questões e cartões.
- **Anotações** (`annotations`): destacar um trecho em amarelo, verde ou azul com uma nota; editar,
  arquivar, ir ao destaque. A anotação fica presa à versão em que foi feita.

### Aba Resumo

- **Gerar resumo** com:
  - Nome da versão.
  - Formato: narrativo, anotações com títulos, tópicos, definições e conceitos-chave, comparativo,
    cronológico, causa e efeito.
  - Extensão: breve, padrão ou detalhado.
  - Linguagem: padrão, ou simples com glossário.
  - Prioridades (opcional): conceitos, terminologia, processos, causas, comparações, datas,
    exemplos, argumentos, preparação para prova.
- **Versões** do resumo e **Renomear esta versão** (`study_authoring`).
- **Ouvir resumo** (leitura em voz alta).
- **Criar flashcards** (`flashcards` + `flashcard_sets`): conjunto novo ou existente, quantidade
  (até 50), estilo (pergunta e resposta, termo e definição, explicação concisa), dificuldade e foco.
  A prévia mostra cada cartão com o trecho de apoio; é possível editar, **Rejeitar**, **Gerar
  outro** e só então **Salvar cartões**.

### Aba Questões

- **Gerar lista**:
  - Nome da lista (`study_authoring`).
  - Quantidade: 3, 5, 10, 20 ou **Outra quantidade** (até 40 por padrão, configurável até 100 com
    `MAX_QUESTION_LIST_COUNT`). O botão **i** sugere uma quantidade adequada ao tamanho da aula.
  - Dificuldades (básico, intermediário, avançado) e habilidades cognitivas (recordação,
    compreensão, interpretação, aplicação, análise, causa e efeito, avaliação crítica, síntese).
  - Avançado: foco temático, distribuição (intercalada ou do mais fácil ao mais difícil),
    questões de listas anteriores (evitar repetir, priorizar conceitos novos ou permitir repetição
    para revisão) e feedback ao responder.
  - Formato disponível: múltipla escolha com uma resposta correta. (Verdadeiro/falso, resposta curta
    e aberta ainda não existem.)
- Como a lista é gerada (pipeline `questions-v2.1`): a IA lista os conceitos da aula, o sistema
  monta um plano de cobertura (conceito × habilidade × dificuldade), a IA escreve uma questão por
  vaga com um **trecho literal de apoio**, e o sistema descarta questões sem apoio na transcrição,
  repetidas ou com a mesma resposta. Uma rodada de reposição preenche vagas vazias. No máximo três
  chamadas à IA por lista; se faltar conteúdo, a lista sai menor e explica o motivo.
- Cada lista mostra **Responder/Continuar/Responder de novo**, **Ver questões** (com acertos e erros
  da última tentativa) e **Ouvir questões**.
- Menu **⋯ Ações da lista**: Renomear, **Compartilhar** (link de leitura sem gabarito, validade de
  1, 7 ou 30 dias, revogável) e Exportar.

### Exportar

Escolha do conteúdo e do formato em um único diálogo:

- Conteúdo: transcrição confirmada (com ou sem horários), uma versão do resumo, minhas anotações,
  listas como **folha do aluno** (sem respostas), **gabarito** (com explicações) ou **relatório da
  última tentativa** (`quiz_v2`), e conjuntos de flashcards.
- Formatos: **PDF** (pela impressão do navegador, página A4), **Markdown**, **TXT** e **CSV de
  flashcards** (compatível com Anki/Quizlet).

### Outros

- **Compartilhar** (`sharing`, E18/E19): cópia de leitura da transcrição e/ou do resumo, por 1, 7 ou
  30 dias, revogável.
- **Marcar revisão concluída** (e desfazer).
- **Tempo de estudo** (`study_tracking`): o mesmo cronômetro de Planejar › Tempo de estudo.

## 9. Responder questões

Página: `responder.html`.

- Sem `quiz_v2`: responde questão a questão e vê a correção na hora.
- Com `quiz_v2` (E10): **tentativas** registradas; feedback **após cada questão** ou **só ao
  finalizar**; ver pendentes; tentativas anteriores; **Ouvir questão**. O gabarito fica escondido
  enquanto há uma tentativa com feedback adiado em aberto.
- Com `quiz_review` (E12): **Resultado e revisão** com diagnóstico e **Refazer apenas as questões
  erradas**.

## 10. Perfil e marcos de estudo

Página: `conta.html`.

- Avatar (8 poses do Nino, foto ou GIF até 8 MB), capa, nome exibido, instituição, curso, objetivo
  e "sobre mim".
- **Visualização e edição**: a página abre limpa, sem alças, menus ou botões de arrumação, e sem os
  blocos e seções ocultos. **Personalizar perfil** liga o modo de edição, com uma barra fixa
  (Adicionar bloco, Mostrar tudo, Concluir; Esc também sai).
- **Meus cards**: blocos personalizáveis (templates, texto, código, HTML/CSS próprio sem scripts,
  incorporação de YouTube ou Spotify) e **Seus dados**: blocos com dados reais — aulas recentes,
  disciplinas favoritas (por acessos), objetivos ativos com tarefas feitas (`planning`) e minutos da
  semana com a meta (`study_tracking`). Sem dados, o bloco diz isso; nada é inventado.
- No modo de edição, o menu ⋯ de cada bloco tem Editar, Duplicar, Ocultar/Mostrar, Mover para
  cima/baixo, quatro larguras e Remover (com confirmação) — tudo por teclado; arrastar e
  redimensionar continuam para mouse e toque. **Sobre mim**, **Meu percurso** e **Marcos de estudo**
  podem ser ocultados (chave `profile-layout`).
- **Meu percurso / Marcos de estudo**: conquistas como "Primeira aula", com XP e níveis; alguns
  avatares do Nino são desbloqueados pelos marcos.
  - **Provisório**: pontos e conquistas são calculados **no navegador**, a partir do número de aulas
    (vindo do servidor) e de dados de estudo locais (revisões, respostas, minutos). O servidor não os
    verifica nem os usa para liberar nada; a própria página avisa isso. Marcos de aparelhos
    diferentes são combinados. Desenho da versão verificada: [GAMIFICACAO_2_0_DESIGN.md](GAMIFICACAO_2_0_DESIGN.md).

## 11. Configurações e aparência

- `configuracoes.html`: dados da conta, forma de acesso, atalhos para Aparência, Privacidade e Ajuda,
  e **Enviar link para trocar a senha**.
- `aparencia.html`:
  - **Modos de estudo**: Leitura confortável, Foco profundo e Revisão rápida aplicam várias
    preferências de uma vez; depois, cada uma pode ser ajustada. Um modo nunca diminui o texto nem
    desliga movimento reduzido, contraste reforçado, modo para leitores de tela ou leitura em voz alta.
  - **Idioma** da interface: português (padrão), inglês, espanhol ou chinês simplificado. Só muda a
    interface; conteúdo das aulas e o que a pessoa escreveu ficam como estão. Cobertura em
    [IDIOMAS.md](IDIOMAS.md) — os outros idiomas ainda não traduzem todas as telas, e a página avisa.
  - **Temas prontos**: Claro, Lavanda, Sálvia, Oceano, Vinho, Areia, Escuro, Contraste claro,
    Contraste escuro.
  - **Personalizar**: cores de fundo, detalhes e letras, e fonte; o contraste é corrigido
    automaticamente quando fica ilegível.
  - **Meus temas**: salvar, aplicar, atualizar e excluir temas próprios.
  - **Leitura e foco**: modo para leitores de tela, modo foco, barra lateral ou inferior, menos
    estímulos visuais, movimento reduzido, contraste reforçado, fonte de leitura (Verdana, Atkinson
    Hyperlegible, Lexend, OpenDyslexic), tamanho do texto (90–200%), espaçamento, guia de leitura
    (régua ou foco no trecho), comprimento das linhas e espaçamento dos cartões.
  - **Leitura em voz alta**: desligada, ícones discretos ou em todo o site; velocidade da voz.
- As preferências são aplicadas antes da página aparecer (sem "piscar") e sincronizadas com a conta.

## 12. Acessibilidade

- **Modo para leitores de tela**: interface simplificada e linear; o atalho para ligá-lo é o segundo
  link de "pular", alcançado já no primeiro Tab.
- **Leitura em voz alta** com as vozes do próprio navegador/sistema: botão discreto em resumos e
  questões, ou em todo o site (Alt+L lê a página). O bloco lido fica destacado.
- Navegação completa por teclado (abas, menus ⋯, player, recorte, diálogos); Esc fecha menus.
- Legendas configuráveis, fontes para dislexia, régua de leitura, contraste reforçado e movimento
  reduzido.
- Diálogos nativos (`<dialog>`): o resto da página fica inerte; Esc fecha. Diálogos abertos a partir
  de um menu ⋯ devolvem o foco ao botão do menu ao fechar.
- Arrastar aulas para pastas tem alternativa por teclado ("Mover para pasta" no menu ⋯).
- Regiões de aviso (`aria-live`) só anunciam mudanças reais: o estado do processamento não se repete
  a cada consulta, o percentual do envio fica numa barra de progresso (não anunciada a cada bloco) e
  as legendas palavra a palavra não são anunciadas.
- A leitura em voz alta do app é independente dos leitores de tela; no modo para leitores de tela
  os controles dela ficam ocultos.

**Como foi validado**: auditorias automáticas com axe-core (WCAG A/AA) nas páginas e diálogos
principais, percursos por teclado nos testes de navegador e testes de DOM. **Não houve teste com
leitores de tela reais (NVDA, VoiceOver, TalkBack)** nesta auditoria; o registro anterior está em
[accessibility-integrated-test.md](accessibility-integrated-test.md). Pendências em
[ROADMAP.md](ROADMAP.md#4-validação-incompleta).

## 13. Compartilhamento público

Página: `compartilhado.html` (não exige login).

- Abre uma **cópia de leitura** de um material (transcrição/resumo) ou uma **folha de questões** sem
  respostas, a partir de um link com token.
- O servidor guarda só o hash do token; links expiram (1/7/30 dias) e podem ser revogados.
- **Imprimir / salvar PDF**. Link expirado ou revogado mostra uma mensagem com o Nino.

## 14. Ajuda e privacidade

- `ajuda.html`: onde encontrar cada coisa, como transcrever, como estudar, foco e personalização,
  onde os dados ficam, sincronização, áudio e revisão.
- `privacidade.html`: o que é enviado, quais serviços externos são usados (nomes vindos da
  configuração do servidor), uso da gravação e preferências locais.

## 15. Onde cada dado fica salvo

| Dado                                                                        | Onde                                                                                                           |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Aulas, transcrições, versões, resumos, questões, avisos                     | Banco Supabase (servidor)                                                                                      |
| Áudio do trecho                                                             | Storage `audios`; apagado após transcrever, salvo se a pessoa pediu para guardar                               |
| Vídeo MP4 original                                                          | Storage `study-videos` (se guardado)                                                                           |
| Preferências de aparência e leitura                                         | Navegador + tabela `profile_state` (sincronizadas)                                                             |
| Histórico de estudo (posição, respostas, revisão concluída)                 | Navegador + `profile_state`; com `study_tracking`, também nas tabelas de estudo                                |
| Foto e capa do perfil                                                       | Storage `profile-media` + cópia no navegador (IndexedDB); se o envio falhar, fica pendente e sincroniza depois |
| Tags extras da Biblioteca (no histórico de estudo de cada aula)             | Navegador + `profile_state` (sincronizadas)                                                                    |
| Ícones de pasta                                                             | `profile-media` + `profile_state`                                                                              |
| Layout do Início (`dashboard-layout`) e seções do perfil (`profile-layout`) | `profile_state` + cópia no navegador (sincronizados, edição mais recente)                                      |
| Idioma da interface e espaçamento dos cartões                               | Junto das preferências de aparência (`profile_state`, chave `preferences`)                                     |

Regras da sincronização (`profile_state`):

- Cada conta só lê e grava as próprias linhas (RLS do Supabase, testado com duas contas).
- Uma gravação nunca sobrescreve às cegas uma versão mais nova da conta: o histórico de estudo, os
  marcos e os ícones de pasta são **combinados** (nada de outro aparelho se perde); as demais chaves
  ficam com a **edição mais recente** (pela hora da edição, não do envio).
- Sem conexão, a mudança fica pendente neste navegador e é enviada depois.
- **Conta e dispositivo**: aparência, idioma e densidade escolhidos **sem conta** (tela de entrada) são
  as preferências do dispositivo. Ao sair, o navegador volta a elas — a próxima pessoa não vê o tema
  nem o idioma da conta anterior. Uma conta sem preferências salvas começa das do dispositivo; uma
  conta que volta recupera as próprias (da cópia na conta, aplicadas logo após entrar). Sem
  preferências do dispositivo, só as necessidades de acessibilidade (tamanho do texto, contraste,
  movimento, leitor de tela, fonte de leitura) ficam na tela de entrada.
- Ao trocar de conta no mesmo navegador, as preferências não salvas da conta anterior esperam por ela
  e não vão para a nova conta.
- **Configurações › Sincronização e dados neste navegador** mostra o estado real (tudo salvo,
  sincronizando, pendente, sem conexão, falha) a partir do que está pendente; "Sincronizar agora"
  aparece só quando há o que enviar.
- **Sair** não apaga nada do navegador. **Apagar dados desta conta neste navegador e sair** remove só
  as cópias desta conta (localStorage e IndexedDB), nunca as de outras contas nem as preferências do
  dispositivo; avisa se há mudanças não enviadas e oferece sincronizar antes.
- Limite: "edição mais recente" usa a hora do aparelho; um relógio muito errado pode perder a disputa
  (a hora do servidor exigiria uma função no banco — proposta no ROADMAP).

---

## Disponibilidade por recurso

Situação do banco de produção `audioestudo` conferida em 20/11/2026. "Banco pronto" quer dizer
apenas que **as tabelas existem**: o recurso ainda precisa da flag no `backend/.env` e de um teste
manual. "Falta migration": com a flag ligada, o `INICIAR.cmd` recusa iniciar e lista o que falta (e,
se o servidor for iniciado de outro jeito, só as rotas daquele recurso respondem `503`). Matriz
completa (código, banco, dependências, validação e limitações) e roteiro de ativação em
[ATIVACAO_RECURSOS.md](ATIVACAO_RECURSOS.md).

| Recurso                                                     | Flag                           | Migration necessária                                   | Banco de produção |
| ----------------------------------------------------------- | ------------------------------ | ------------------------------------------------------ | ----------------- |
| Envio, transcrição, revisão, resumo, questões (base)        | —                              | 001 + E02                                              | Banco pronto      |
| Busca global                                                | —                              | 001 + E02                                              | Banco pronto      |
| Transcrição assíncrona (AssemblyAI), legendas por palavra   | `ASR_PROVIDER=assemblyai`      | `ai_executions`                                        | Banco pronto      |
| Pastas (disciplinas e unidades), Editar/Remover disciplina  | `catalog_units`                | E03                                                    | Banco pronto      |
| Guardar MP4 original, player de vídeo                       | `mp4_retention`                | E07 (`material_videos_table` + correção das políticas) | Banco pronto      |
| Listas nomeadas, resumos nomeados, quantidade personalizada | `study_authoring`              | `study_authoring`                                      | Banco pronto      |
| Compartilhar lista de questões                              | `sharing` + `study_authoring`  | `study_authoring`                                      | Banco pronto      |
| Compartilhar cópia do material                              | `sharing`                      | E18/E19 (`calendar_sharing`)                           | Falta migration   |
| Planejamento                                                | `planning`                     | E05                                                    | Falta migration   |
| Tentativas e diagnóstico de questões                        | `quiz_v2`, `quiz_review`       | E10, E12                                               | Falta migration   |
| Flashcards e conjuntos                                      | `flashcards`, `flashcard_sets` | E13, `flashcard_sets`                                  | Falta migration   |
| Tempo e progresso de estudo                                 | `study_tracking`               | E08/E09                                                | Falta migration   |
| Anotações                                                   | `annotations`                  | E14/E15                                                | Falta migration   |
| Calendário                                                  | `calendar`                     | E18/E19                                                | Falta migration   |
| Perfil, marcos, preferências sincronizadas                  | —                              | `profile_state` (proposta aplicada)                    | Banco pronto      |

Ordem de pré-requisitos e riscos de cada migration: [BANCO_DE_DADOS.md](BANCO_DE_DADOS.md).

## Limitações conhecidas

- Formatos de questão: só múltipla escolha com uma resposta.
- `social_basic` é uma flag declarada sem uso.
- `questoes.html` (gerador antigo) não tem mais link; `gabarito.html` e `leitura.html` apenas
  redirecionam.
- Não há limitador de requisições HTTP global; existem apenas limites internos (2 conversões de
  mídia simultâneas, uma geração de cartões por pessoa, 3 chamadas de IA por lista).
- A verificação de senhas vazadas roda no navegador; quem chamar o Supabase diretamente não passa
  por ela (as regras de senha do Supabase continuam valendo).
- `compartilhado.html` não aplica temas nem preferências de acessibilidade de quem abre o link.
- A tarefa `RETRANSCRIBIR_AUDIO` existe no enum, mas não tem implementação.
