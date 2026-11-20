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
4. [Painel](#4-painel)
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

Princípio central: **nada é gerado sem a transcrição confirmada pela pessoa**. Resumos, questões e
cartões guardam a revisão de origem; se a transcrição muda depois, eles aparecem como
"desatualizados" em vez de sumirem.

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

- **Barra lateral**: Painel, Nova transcrição, Biblioteca e Configurações. Pode ser recolhida, ou
  trocada por uma **barra inferior** (Aparência › Navegação).
- **Barra superior**: busca na Biblioteca, atalho para Aparência, **Modo foco** (Alt+F, com A−/A+),
  e o menu da conta (Perfil, Configurações, Sair).
- **Atalhos**: `?` abre a lista de atalhos de teclado.
- **Nino**, o mascote, aparece em estados vazios e becos sem saída (busca sem resultado, link
  expirado, pasta vazia) com poses diferentes.

## 4. Painel

Página: `painel.html`.

- "Olá, {nome}", atalho **Nova transcrição**, **Seu último estudo**, **Aulas recentes**,
  **Suas disciplinas** e **Assuntos revisitados**.
- **Busca global** (`GET /api/search`): procura em títulos de aulas, enunciados de questões e na
  transcrição, sem diferenciar acentos. Mostra sugestões enquanto se digita (setas e Esc); o
  resultado abre em abas (Aulas, Questões, Transcrições) que só aparecem quando têm resultados.
  Termos encontrados ficam em negrito, e o resultado de transcrição abre a aula já no trecho.
  Gabaritos nunca entram na busca.
- Painéis que dependem de flags (e de migrations ainda não aplicadas em produção):
  - **Meu planejamento** (`planning`, E05): objetivos, subobjetivos e tarefas com prazo, aula
    relacionada e link de apoio; filtros, ordenação manual e conclusão.
  - **Flashcards** (`flashcards`, E13): revisão do dia com espaçamento (De novo / Difícil / Bom /
    Fácil), criar cartão, gerar cartões com IA, organizar, histórico de revisões. Com
    `flashcard_sets`: **Conjuntos de flashcards** (ver, renomear, arquivar, excluir, exportar CSV
    ou Markdown).
  - **Tempo e progresso de estudo** (`study_tracking`, E08/E09): sessões de estudo livre ou
    Pomodoro (25/5), meta semanal, fuso horário, sincronização entre aparelhos.
  - **Anotações e destaques** (`annotations`, E14/E15): busca nas anotações de todas as aulas.
  - **Calendário de estudos** (`calendar`, E18/E19): mês, horários ligados a aulas e tarefas,
    exportação **.ics**.

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
   - O trecho é convertido em **MP3 mono compacto** (~0,5 MB/min) e enviado ao Supabase Storage por
     **upload retomável**: blocos de 6 MB; se a conexão cair, o envio continua de onde parou.
   - O progresso aparece em porcentagem; se a conexão não voltar, a mensagem explica e nada é perdido.

## 6. Processamento

Página: `processando.html`.

- Acompanha a tarefa: Envio concluído → Na fila → Transcrição do áudio → Pronta para revisão.
- Pode-se sair da página; a aula aparece na Biblioteca quando terminar.
- Ao final, o áudio é **apagado** ou **guardado** conforme a escolha do envio, e são gerados três
  **avisos de conteúdo** (adequação educacional, relação com a disciplina, suspeita factual).
- Falhas temporárias são repetidas automaticamente (3 tentativas); a página mostra
  **Tentar novamente** quando necessário.

## 7. Biblioteca

Página: `historico.html`.

- Busca, visualização em **Grade** ou **Lista**, e **Filtros**: por aula ou por tipo de recurso,
  disciplina, tag, situação (prontos, em processamento, com erro), progresso de estudo e ordenação.
- Menu **⋯** de cada aula: Abrir material, Editar transcrição, Organizar, Ver questões, Gerar novas
  questões, Mover para pasta, Excluir material (com confirmação).
- **Organizar**: título, disciplina, pasta/unidade e até 12 tags extras.
- **Pastas** (`catalog_units`, E03): disciplinas e unidades como pastas, criação com **+**,
  arrastar-e-soltar aulas, ícone PNG personalizado.
  - Menu **⋯** da disciplina: **Editar** (nome e ícone) e **Remover**. Remover nunca apaga aulas:
    elas vão para "Sem disciplina", e as unidades da disciplina são removidas.

## 8. Página da aula (material)

Página: `material.html`. Cabeçalho com **Organizar**, **Exportar** e **Compartilhar**; player; três
abas: **Transcrição | Resumo | Questões** (setas/Home/End; endereços `#transcricao`, `#resumo`,
`#questoes`).

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
- **Tempo de estudo** (`study_tracking`): o mesmo cronômetro do Painel.

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
- **Meus cards**: blocos personalizáveis (templates, texto, código, HTML/CSS próprio, incorporação de
  YouTube ou Spotify).
- **Meu percurso / Marcos de estudo**: conquistas como "Primeira aula", com XP e níveis; alguns
  avatares do Nino são desbloqueados pelos marcos.

## 11. Configurações e aparência

- `configuracoes.html`: dados da conta, forma de acesso, atalhos para Aparência, Privacidade e Ajuda,
  e **Enviar link para trocar a senha**.
- `aparencia.html`:
  - **Temas prontos**: Claro, Lavanda, Sálvia, Oceano, Vinho, Areia, Escuro, Contraste claro,
    Contraste escuro.
  - **Personalizar**: cores de fundo, detalhes e letras, e fonte; o contraste é corrigido
    automaticamente quando fica ilegível.
  - **Meus temas**: salvar, aplicar, atualizar e excluir temas próprios.
  - **Leitura e foco**: modo para leitores de tela, modo foco, barra lateral ou inferior, menos
    estímulos visuais, movimento reduzido, contraste reforçado, fonte de leitura (Verdana, Atkinson
    Hyperlegible, Lexend, OpenDyslexic), tamanho do texto (90–200%), espaçamento, guia de leitura
    (régua ou foco no trecho) e comprimento das linhas.
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
- Auditorias automáticas com axe-core fazem parte dos testes de navegador. Não há validação com
  leitores de tela reais registrada além de [accessibility-integrated-test.md](accessibility-integrated-test.md).

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

| Dado                                                        | Onde                                                                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Aulas, transcrições, versões, resumos, questões, avisos     | Banco Supabase (servidor)                                                                                      |
| Áudio do trecho                                             | Storage `audios`; apagado após transcrever, salvo se a pessoa pediu para guardar                               |
| Vídeo MP4 original                                          | Storage `study-videos` (se guardado)                                                                           |
| Preferências de aparência e leitura                         | Navegador + tabela `profile_state` (sincronizadas)                                                             |
| Histórico de estudo (posição, respostas, revisão concluída) | Navegador + `profile_state`; com `study_tracking`, também nas tabelas de estudo                                |
| Foto e capa do perfil                                       | Storage `profile-media` + cópia no navegador (IndexedDB); se o envio falhar, fica pendente e sincroniza depois |
| Tags extras da Biblioteca                                   | Somente no navegador                                                                                           |
| Ícones de pasta                                             | `profile-media` + `profile_state`                                                                              |

---

## Disponibilidade por recurso

Situação do banco de produção `audioestudo` conferida em 20/11/2026. "Pronto" = as tabelas
necessárias existem; basta a flag no `backend/.env`. "Falta migration" = ligar a flag sem aplicar a
migration faz as rotas responderem `SCHEMA_UPGRADE_REQUIRED`.

| Recurso                                                     | Flag                           | Migration necessária                                   | Produção        |
| ----------------------------------------------------------- | ------------------------------ | ------------------------------------------------------ | --------------- |
| Envio, transcrição, revisão, resumo, questões (base)        | —                              | 001 + E02                                              | Pronto          |
| Busca global                                                | —                              | 001 + E02                                              | Pronto          |
| Transcrição assíncrona (AssemblyAI), legendas por palavra   | `ASR_PROVIDER=assemblyai`      | `ai_executions`                                        | Pronto          |
| Pastas (disciplinas e unidades), Editar/Remover disciplina  | `catalog_units`                | E03                                                    | Pronto          |
| Guardar MP4 original, player de vídeo                       | `mp4_retention`                | E07 (`material_videos_table` + correção das políticas) | Pronto          |
| Listas nomeadas, resumos nomeados, quantidade personalizada | `study_authoring`              | `study_authoring`                                      | Pronto          |
| Compartilhar lista de questões                              | `sharing` + `study_authoring`  | `study_authoring`                                      | Pronto          |
| Compartilhar cópia do material                              | `sharing`                      | E18/E19 (`calendar_sharing`)                           | Falta migration |
| Planejamento                                                | `planning`                     | E05                                                    | Falta migration |
| Tentativas e diagnóstico de questões                        | `quiz_v2`, `quiz_review`       | E10, E12                                               | Falta migration |
| Flashcards e conjuntos                                      | `flashcards`, `flashcard_sets` | E13, `flashcard_sets`                                  | Falta migration |
| Tempo e progresso de estudo                                 | `study_tracking`               | E08/E09                                                | Falta migration |
| Anotações                                                   | `annotations`                  | E14/E15                                                | Falta migration |
| Calendário                                                  | `calendar`                     | E18/E19                                                | Falta migration |
| Perfil, marcos, preferências sincronizadas                  | —                              | `profile_state` (proposta aplicada)                    | Pronto          |

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
