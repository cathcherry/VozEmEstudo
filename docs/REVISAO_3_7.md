# Revisão 3.7: funcionamento, ativação, experiência de uso e acabamento

Branch `claude/keen-shannon-sj3ut5`, a partir de `main` @ `62e73b2` (3.6). Nada foi mesclado na `main`.
Nenhuma migration foi aplicada e nenhum dado de produção foi alterado. Do banco de produção e do
staging só se leram metadados: lista de migrations e nomes e contagens de tabelas.

## 1. Referências visuais usadas

| Área             | Referência                                                                                                                                          | Observação                                                                                                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Início (painel)  | O dashboard anterior à escrivaninha: commit `30908fb` (21/11, antes de `4f2ad18`, “Início as a desk”), capturas `design-audit/before/inicio-*.jpg` | A composição foi recuperada (painel lateral único com semana, mês, disciplinas e anotações; aulas recentes em blocos; tarefas e flashcards lado a lado), por cima do código atual. Nenhum arquivo antigo foi restaurado.                                                |
| Landing          | Não há versão anterior diferente no histórico                                                                                                       | O histórico do repositório começa em `0617a8b` (19/11) e a landing já era a atual. Até `4ed1070` só mudaram as fontes e os tokens (`system.css`). A versão que você prefere deve ser anterior a este repositório. **Decisão pendente** (seção 9). |
| Login e cadastro | O próprio login atual                                                                                                                               | Cadastro e recuperação de senha passaram a usar a mesma composição do login.                                                                                                                                                                                  |

## 2. O que mudou, por área

### Compartilhado (todas as páginas)

- **Diálogos** (`frontend/js/utils/dialog-enhance.js`, aplicado em qualquer `showModal`):
  - um × visível quando o diálogo não tem o seu;
  - Esc e × fecham;
  - clique fora fecha, menos quando há texto digitado, operação em andamento (`aria-busy`) ou `data-light-dismiss="off"`;
  - botões `[data-dialog-cancel]` usam o mesmo caminho.
  - CSS: largura mínima confortável, nenhum campo mais largo que o diálogo, sem rolagem horizontal. Uma varredura que abre todos os diálogos de 12 páginas em 1440 e 390 px mede rolagem e botão de fechar; a última sobra (o input oculto de PNG da Biblioteca) foi corrigida.
- **Menus “⋯”** (`frontend/js/utils/floating-menu.js`): as opções abrem na camada superior (popover), abaixo ou acima e alinhadas à direita ou à esquerda conforme o espaço. Nenhum cartão ou lista corta o menu. Esc ou clique fora fecham, e as setas percorrem as opções.
- **Toasts** para confirmações curtas: cartões salvos, tarefas, agendamentos, notas e respostas salvas. Erros continuam visíveis e anunciados.
- **Página 404** própria para endereços de página inexistentes. A API e os arquivos continuam com 404 simples (`backend/tests/not-found-page.test.js`).
- **Setas dos `<select>`**: uma regra mais específica apagava a seta nos temas claros e a repetia em mosaico no noturno; corrigido em `system.css`.

### Início

- Sem escrivaninha e sem “Arrumar a mesa”. Os dados da mesa (`deskStarters`, `desk_layouts`) continuam guardados. O Gabinete deixou de oferecer “Colocar na mesa” (`DESK_ON_HOME = false`), e a opção “Janela da escrivaninha” de Aparência ficou oculta, com a preferência mantida.
- A coluna direita é um painel único e as colunas terminam na mesma linha: o último bloco de cada coluna cresce.
- Estados vazios curtos: “Nenhuma tarefa.”, “Nenhum cartão.”, “Nenhum estudo agendado.” e assim por diante.
- Duas colunas só quando cabem. A quebra é uma container query em `rem`, que acompanha o texto ampliado.
- A personalização foi mantida (mostrar/ocultar, ordem dentro de cada coluna, espaçamento, restaurar padrão, sincronização). Mover um bloco para a outra coluna ainda não é possível (seção 8).
- Tutorial guiado, oferecido na primeira entrada (contas com menos de 30 dias).

### Biblioteca

- Menu “⋯” de disciplinas, aulas e listas nunca cortado.
- “Nova disciplina” e “Nova unidade”: o ícone virou um campo fixo (antes o resumo parecia uma lista suspensa e sobrepunha a prévia), sem rolagem horizontal, com Cancelar e Criar alinhados.
- Seleção em uma barra compacta: contagem, “Mover para…”, “Material integrado” e ×.
- Material integrado em janela larga: cabeçalho, duas colunas que rolam (o que entra | o que gerar) e ações sempre visíveis. Textos curtos, e o motivo de uma aula ficar de fora (“transcrição ainda não confirmada”).
- Pasta: “+ Nova unidade” com rótulo e barra alinhada. Unidade ou disciplina vazia mostra “Nenhuma aula nesta unidade.” com a dica de como trazer aulas. Não aparece “estudar junto” em pasta vazia.

### Aula

- Abas fixas com fundo opaco e camada acima da folha: o texto não aparece mais por trás de “Transcrição | Resumo | …”.
- As ações ficam sob o título, que antes era espremido em três linhas.
- **Caderno** como lugar de escrever: área única, Enter cria parágrafo, barra compacta e atalhos de início de linha (`# `, `- `, `1. `, `[ ] `, `> `). Também: “Citar trecho da aula”, colagem saneada, salvamento automático com estado discreto, conflito e falha tratados, e “Destaques da aula” em lista secundária.
  - Formato salvo inalterado (os mesmos blocos), ida e volta sem perdas.
  - Blocos desconhecidos ficam preservados só para leitura.

### Questões

- Início da tentativa redesenhado: duas opções em cartões e um botão “Começar”.
- Sem a mensagem fixa “Resposta registrada…”.
  - Modo correção no final: “Salvar e avançar” só avança depois de salvar. A falha fica visível e não avança, e o gabarito nunca aparece antes de concluir.
  - Modo correção imediata: a pessoa lê a correção e segue com “Próxima”.
- Resultado com letra e texto (“Sua resposta: D — 15 / Resposta correta: A — 2”), além de ícone e palavra (“Acertou” / “Errou”). Dados antigos sem texto aparecem como “C (texto da alternativa não disponível)”. Saiu o aviso clínico/diagnóstico.
- Os prompts pedem explicações diretas, sem “a transcrição afirma…”. O trecho de apoio continua exibido à parte e obrigatório, e as versões dos prompts foram incrementadas.
- “Reportar problema” virou **“Sinalizar”**: é uma marca pessoal (ninguém recebe o aviso), e o texto agora diz isso.
- Tentativas (continuar / ver resultado) na aba Questões da aula e em `questoes.html`. A mesma página reúne as questões sinalizadas e “Gerar novas questões”.

### Flashcards (área própria; “Revisar” aposentado)

- `flashcards.html` com seções endereçáveis: Revisar cartões, Conjuntos, Criar cartão, Gerar com IA, Importar e mesclar, Aparência.
- Virar o cartão por clique ou toque, por Espaço/Enter, ou pelo botão “Virar cartão” (`aria-pressed`). A mudança é anunciada, a avaliação fica fora da área que vira e o movimento reduzido é respeitado.
- Modelos redesenhados (caderno, post-it, janela, polaroid, clássico) em versões clara, noturna e de alto contraste.
- Criação com toast ao salvar, inclusive no diálogo “Criar flashcards” da aula.
- `revisar.html` redireciona:
  - sem âncora ou `#flashcards` → `flashcards.html#revisar`
  - `#questoes` → `questoes.html`
  - `#anotacoes` → `painel.html?em=notes`
- O menu mostra “Flashcards” (só com a flag `flashcards`).
- **Busca global** encontra as anotações da própria conta no servidor (`GET /api/search`, só linhas do dono, nunca apagadas), com teste de posse no backend.

### Planejar e tempo de estudo

- Objetivo criado em um passo: o prazo é lido do texto (“até quinta-feira”) e há atalhos.
- Tarefas adicionadas dentro do cartão do objetivo; prazos em palavras (“vence amanhã”, “venceu ontem”); progresso com barra e “1 de 3”.
- Menus “⋯” no lugar de fileiras de links.
- Excluir objetivos, subobjetivos e tarefas, com confirmação. As novas rotas `DELETE` são limitadas ao dono e não mudam o esquema.
- Agendamento com dia, horário e duração resumidos em palavras, aula ligada e notas.
- Calendário com legenda e o estado vazio “Nenhum estudo agendado.”.
- Saíram textos persistentes: o aviso do cronômetro entre páginas e a introdução do Planejar. A informação foi para a Ajuda.

### Configurações, Ajuda e Privacidade

- Configurações em lista agrupada: Conta, Aparência e leitura, Idioma, Sons, Segurança, Privacidade e dados, Ajuda, Sair. Cada linha leva direto à página, ao diálogo ou à ação.
- Diálogo “Trocar senha”: com a senha atual ou por link. Usa só a API de autenticação existente e mostra os estados enviando, enviado e erro.
- “Dados neste navegador” virou uma subpágina com “Como funciona”.
- Ajuda com 16 tópicos curtos e busca instantânea (ignora acento e caixa), além de “Iniciar tour”.
- A política de privacidade continua separada e recebeu “onde seus dados ficam” e “conteúdo incorporado”.

### Perfil (cards)

- Modelos oferecidos: Texto (formatação e fundos coloridos), Checklist, Imagem, GIF (pausável), YouTube, Spotify e Seus dados.
- Saíram da criação o 3D, o HTML/CSS e o código.
- Cards antigos continuam aparecendo, só para leitura, em sandbox sem permissões, com “Copiar como texto”.
- Embeds com validação estrita (`youtube-nocookie.com/embed/<id>`, `open.spotify.com/embed/<tipo>/<id>`), nada de `innerHTML` com texto do usuário. Detalhes em [PERFIL_CARDS.md](PERFIL_CARDS.md).

### Leitura em voz alta

- **Causa provável do “só lê os títulos”:** cada parágrafo inteiro (às vezes com mais de 400 caracteres) ia como uma única fala. As vozes de rede do Chrome descartam ou cortam falas longas, e o leitor tratava o erro como “próximo bloco”. Resultado: os títulos curtos eram lidos e os parágrafos pulados.
- O que mudou:
  - O texto é dividido em trechos de até 180 caracteres, por frase.
  - A fala atual fica referenciada (o Chrome podia descartá-la).
  - Pausa e retomada recomeçam da última palavra informada.
  - Uma voz que falha é tentada de novo com a voz padrão.
- O leitor de página inteira percorre o texto visível de `<main>` por blocos. Pula botões, menus, partes recolhidas, `aria-hidden` e `.sr-only`.
- Verificado capturando o que é enviado ao `speechSynthesis`. Ouvir em navegadores reais continua pendente (o Chromium sem interface não tem vozes).

### Acesso

- Cadastro e recuperação com o mesmo layout do login (introdução e formulário). O cartão perdeu a faixa vazia de “barra de título”.

## 3. Inventário: implementado, dependências, ativo, validado

Legenda de validação: **A** teste automatizado; **UI** percurso no navegador com API simulada; **Real** com serviço real; — não houve.

O ambiente de uso é o computador da dona do projeto (`INICIAR.cmd` + `backend/.env`). **As flags `FEATURE_*` desse `.env` não são visíveis daqui.** “Banco” abaixo significa que as tabelas existem no projeto de produção `audioestudo`, conferido em 24/11 só pelos nomes das tabelas. Isso não prova que a flag esteja ligada.

| Área                                                        | Código | Depende de                                                     | Banco (produção)                                                                                 | Validação nesta revisão                                                                   |
| ----------------------------------------------------------- | ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Cadastro, login, recuperação, perfil                        | Sim    | Supabase Auth; senhas vazadas (HIBP) opcional                  | Sim (`profile_state`)                                                                            | A + UI (simulado). Login social e e-mail real: não testados                               |
| Envio, recorte, processamento                               | Sim    | Storage `audios`, worker, FFmpeg                               | Sim                                                                                              | A (FFmpeg real em `browser-check`) + UI simulada. Envio real: não                         |
| Transcrição                                                 | Sim    | Whisper (HF Space) ou AssemblyAI, chaves no `.env`             | Sim                                                                                              | A (provedores falsos). Real: não                                                          |
| Player, legendas, busca, edição e confirmação               | Sim    | `study_authoring` para palavras                                | Sim                                                                                              | A + UI                                                                                    |
| Resumos, questões, flashcards gerados                       | Sim    | Provedor de texto (Groq etc.), confirmação da transcrição      | Sim                                                                                              | A (respostas estruturadas falsas) + UI. Geração real com os novos prompts: **não**        |
| Quiz 2.0 (tentativas, correção, revisão de erros)           | Sim    | `quiz_v2`, `quiz_review`                                       | Sim                                                                                              | A + UI (`quiz-flow-check`)                                                                |
| Flashcards, conjuntos, 3.0 (modelos, mescla, .apkg)         | Sim    | `flashcards`, `flashcard_sets`, `flashcards_v3`                | Sim                                                                                              | A + UI                                                                                    |
| Biblioteca, disciplinas, unidades                           | Sim    | `catalog_units`                                                | Sim                                                                                              | A + UI                                                                                    |
| Busca global (aulas, questões, transcrições, anotações)     | Sim    | `annotations` para notas                                       | Sim                                                                                              | A (posse no backend) + UI                                                                 |
| Material integrado                                          | Sim    | `multi_lesson`, provedor de texto                              | Sim                                                                                              | A + UI. Geração real: não                                                                 |
| Anotações e caderno da aula                                 | Sim    | `annotations`, `notebooks`                                     | Sim                                                                                              | A + UI (`notebook-editor-check`)                                                          |
| Diário de estudo                                            | Sim    | `journal`                                                      | Sim. As tabelas existem, mas a migration **não aparece no histórico** de produção (aplicada fora dele) | A + UI                                                                                    |
| Planejamento, calendário, ICS                               | Sim    | `planning`, `calendar`                                         | Sim                                                                                              | A + UI (rotas DELETE novas com teste)                                                     |
| Tempo de estudo, Focar                                      | Sim    | `study_tracking`                                               | Sim                                                                                              | A + UI                                                                                    |
| Turmas, contribuições, compartilhamento                     | Sim    | `classrooms`, `sharing`                                        | Sim (vazias)                                                                                     | A + UI das telas existentes; sem mudanças nesta revisão                                   |
| Investigações, descobertas, gabinete                        | Sim    | `discoveries`                                                  | Sim (vazias)                                                                                     | A + UI (ajustados à saída da mesa)                                                        |
| Personalização, acessibilidade, idiomas                     | Sim    | —                                                              | `profile_state`                                                                                  | A + UI (temas, texto máximo, 390 px, axe)                                                 |
| Leitura em voz alta                                         | Sim    | Vozes do navegador/SO                                          | —                                                                                                | A + UI com síntese capturada. Ouvir: **pendente**                                         |
| Sons ambientes                                              | Sim    | Web Audio do navegador                                         | —                                                                                                | A + UI existentes; sem mudanças                                                           |
| Música (YouTube/Spotify) e cards do perfil                  | Sim    | CSP `frame-src` (já permite)                                   | —                                                                                                | A + UI (embeds sob a CSP do app). Reprodução real: não                                    |
| Tutorial guiado                                             | Sim    | `profile_state` (chave `guided-tour`)                          | Sim                                                                                              | A + UI                                                                                    |

Outras observações do ambiente:

- O staging (`voz-em-estudo-staging`) tem todas as migrations no histórico, inclusive `journals` e `rls_performance`.
- Na produção, `rls_performance` continua **não aplicada**, por decisão registrada em `ATIVACAO_RECURSOS.md`.

## 4. Como testar a branch no seu computador

1. GitHub Desktop: **Fetch origin**, troque para `claude/keen-shannon-sj3ut5` e depois **Pull**.
2. Feche e abra o `INICIAR.cmd`. No navegador, **Ctrl+F5**.
3. Roteiro sugerido:
   - Início (personalizar, restaurar, tutorial)
   - Biblioteca (menu perto da borda, nova disciplina, selecionar e mover, material integrado)
   - Aula (rolar com as abas, caderno, questões nos dois modos)
   - Flashcards (virar, criar)
   - Planejar (objetivo “Concluir a apresentação do TCC até quinta-feira”)
   - Configurações (trocar senha)
   - Ajuda (busca)
   - Leitura em voz alta num resumo longo
4. Não há migration nova. As rotas `DELETE` do planejamento usam as tabelas que já existem.

## 5. Testes

Ver o relatório final da sessão. Os comandos estão em [TESTING.md](TESTING.md). Verificações de navegador novas:

- `quiz-flow-check`
- `notebook-editor-check`
- `read-aloud-check`
- `profile-cards-check`
- `tour-check`
- `settings-check`

## 6. Limitações conhecidas

- Resposta salva no Quiz 2.0 não pode ser alterada (o banco recusa). Mudar isso exige migration.
- “Sinalizar” é uma marca pessoal: não existe fila de revisão nem destinatário.
- O caderno guarda texto estruturado sem negrito/itálico (o formato salvo não tem). O texto dentro da área de escrita não passa pelo tradutor de interface.
- O leitor de página inteira usa o idioma da interface, não o da aula.
- O tutorial só é oferecido a contas criadas há menos de 30 dias. Contas sem data de criação não recebem o convite.
- `presentation-check.cjs` (fora de `test:browser`) já falhava na `main` @ `62e73b2`.
- O código da escrivaninha (`desk-scene.js`, `desk.css`, `desk.js`) continua no repositório, sem uso no Início, para não perder a lógica dos dados guardados.
