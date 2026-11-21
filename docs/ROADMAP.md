# Roadmap e situação

O que está pronto, o que falta ativar, o que falta validar e as dívidas técnicas conhecidas.
Atualizado em 21/11/2026 (Personalização 2.0, idiomas e validação dos recursos ativados).

Legenda de validação: **automático** = testes com Postgres em memória (PGlite), API com Supabase
simulado e navegador (Playwright + axe); **manual** = usado de verdade em produção.

## 1. Implementado e testado (em uso)

| Recurso                                                                      | Validação                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| Envio com recorte, MP3 compacto e upload retomável                           | Automático; manual (19–20/11)                          |
| Transcrição com AssemblyAI (assíncrona, sem reenvio pago em repetições)      | Automático; manual                                     |
| Conferência humana: edição, versões, avisos, confirmação                     | Automático; manual                                     |
| Fronteira da confirmação (resumos, listas e cartões só da versão confirmada) | Automático (inclusive chamadas diretas à API)          |
| Resumos nomeados (7 formatos) e listas de questões `questions-v2.1`          | Automático; manual                                     |
| Busca global, Biblioteca, pastas com Editar/Remover                          | Automático; manual                                     |
| Exportação (PDF, Markdown, TXT) e compartilhamento de listas                 | Automático                                             |
| Recuperação de tarefas interrompidas (reserva com renovação)                 | Automático                                             |
| Regras de senha e verificação de senhas vazadas                              | Automático                                             |
| Sincronização de perfil e preferências sem sobrescrever dados mais novos     | Automático (duas contas, troca de conta, concorrência) |

## 2. Migrado em produção, aguardando flag e teste manual

Migrations aplicadas em 20/11/2026 com autorização, uma por vez. As funções do banco foram testadas em
produção com contas reais (numa transação desfeita, sem deixar dados). Falta ligar a flag no
`backend/.env` e testar pela interface. Detalhes em [ATIVACAO_RECURSOS.md](ATIVACAO_RECURSOS.md).

| Recurso                                     | Flag                     | Implementado | Migrado     | Ligado            | Teste automático | Verificado manualmente |
| ------------------------------------------- | ------------------------ | ------------ | ----------- | ----------------- | ---------------- | ---------------------- |
| Planejamento                                | `planning`               | ✅           | ✅ E05      | pendente (`.env`) | ✅ + integrado   | ❌                     |
| Tentativas de questões e diagnóstico        | `quiz_v2`, `quiz_review` | ✅           | ✅ E10, E12 | pendente (`.env`) | ✅ + integrado   | ❌                     |
| Flashcards e revisão espaçada               | `flashcards`             | ✅           | ✅ E13      | pendente (`.env`) | ✅ + integrado   | ❌                     |
| Conjuntos de flashcards (Flashcards 2.0)    | `flashcard_sets`         | ✅           | ✅          | pendente (`.env`) | ✅ + integrado   | ❌                     |
| Tempo e progresso de estudo                 | `study_tracking`         | ✅           | ✅ E08/E09  | pendente (`.env`) | ✅ + integrado   | ❌                     |
| Anotações                                   | `annotations`            | ✅           | ✅ E14/E15  | pendente (`.env`) | ✅ + integrado   | ❌                     |
| Calendário e cópias de leitura de materiais | `calendar`, `sharing`    | ✅           | ✅ E18/E19  | pendente (`.env`) | ✅ + integrado   | ❌                     |

Também aplicada: `profile_state_hardening` (menos permissões do navegador em `profile_state`, formato e
limite de chaves). Para desfazer a ativação: `database/rollback/20261120_feature_activation_undo.sql`.

## 3. Migrations pendentes (nenhuma aplicada sem autorização)

| Migration                            | Para quê                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `20261119140000_rls_performance.sql` | Desempenho das políticas de RLS (13 avisos) e índices de 14 chaves estrangeiras. Não aprovada ainda |

## 4. Validação incompleta

- Matriz atualizada em 21/11/2026, com o que cada teste cobre e o que falta testar à mão:
  [VALIDACAO_RECURSOS.md](VALIDACAO_RECURSOS.md).

- **Leitores de tela reais** (NVDA, VoiceOver, TalkBack): não testados nesta auditoria. A interface
  passa no axe (WCAG A/AA) e em percursos por teclado, o que não comprova uso com leitor de tela.
- Recursos da seção 2: testes automáticos e teste integrado das funções em produção; falta teste
  manual pela interface, com login real, depois de ligar as flags.
- MP4 original: validado em parte (envio e reprodução); falta testar em celulares.
- Transcrição pelo Hugging Face (Whisper): mantida como alternativa, sem uso recente.
- Testes de carga e de várias abas/aparelhos ao mesmo tempo com dados reais.

## 5. Personalização 2.0

**Feito em 21/11/2026** (branch `feat/personalization-2-0`, testes automáticos; falta uso real):
Personalizar o Início (mostrar/ocultar, ordem, densidade, restaurar), perfil com modos de
visualização e edição (menu por teclado, duplicar, ocultar, larguras, blocos com dados reais,
seções ocultáveis), modos de estudo em Aparência e idioma da interface (pt-BR, en, es, zh-CN, com
cobertura parcial descrita em [IDIOMAS.md](IDIOMAS.md)). Tudo pela `profile_state` existente, sem
migration. Detalhes: [SESSAO_DESENVOLVIMENTO.md](SESSAO_DESENVOLVIMENTO.md).

### Pendências de persistência (continuam abertas)

Requisitos levantados na auditoria (sem implementar aqui, para não criar duas fontes de verdade):

1. **Sair da conta** deveria oferecer "apagar dados deste navegador" (cópias de `voz-cloud-v1:*`,
   `voz-study-v1:*`, IndexedDB do perfil), avisando se há mudanças pendentes.
2. **Preferências por conta**: as chaves de aparência são compartilhadas pelo navegador; hoje o app
   lembra o dono e protege a conta nova, mas a aparência ainda aparece na tela de login com o tema
   da última conta. Guardar sob a chave da conta resolve.
3. **Estado de sincronização visível** em Configurações (pendente / salvo / conflito resolvido) e
   botão "sincronizar agora".
4. **Relógio do aparelho**: "edição mais recente" usa a hora do aparelho; aparelhos com relógio muito
   errado podem perder a disputa. Usar a hora do servidor (função RPC) resolveria.
5. **Tags e tema de leitura no servidor**: as tags vivem no histórico de estudo (`profile_state`);
   se virarem filtros do servidor (busca, compartilhamento), devem migrar para uma tabela própria.
6. Página `compartilhado.html` sem tema nem preferências de acessibilidade de quem abre o link.

## 6. Gamificação 2.0 (Prompt 4)

Hoje XP, níveis e marcos são **provisórios**, calculados no navegador, e a página diz isso. Não dão
acesso a nada. O desenho com validação no servidor (eventos verificados, emissão idempotente,
conquistas próprias, importação do histórico como provisório, avatares liberados por RPC) está em
[GAMIFICACAO_2_0_DESIGN.md](GAMIFICACAO_2_0_DESIGN.md). Depende de E10, E12, E13 e E08/E09 para ter
eventos além de aulas e confirmações.

## 6.1 Situação em 21/11/2026 (sessão de continuação)

Resolvido: tradução de quase toda a interface (en, es, zh-CN; ver [IDIOMAS.md](IDIOMAS.md)),
preferências por conta e por dispositivo, indicador de sincronização, apagar dados da conta no
navegador (§5.1, §5.2 e §5.3 abaixo), cópia pública com as preferências do visitante (§5.6),
duração exata de AAC (teste de recorte portátil), bucket configurável ao excluir aula, testes de
flags desligadas, limites por conta nos pedidos caros, CSP opcional, guia de hospedagem
([HOSPEDAGEM.md](HOSPEDAGEM.md)).

Proposta (não aplicada, pede aprovação): usar a **hora do servidor** na disputa de edições de
`profile_state` — um `default now()`/trigger em `updated_at` e uma RPC de gravação condicional —
para que relógios errados de aparelhos não percam edições (§5.4).

## 6.2 Polimento de UI/UX (22/11/2026)

**Feito** (branch `feat/personalization-2-0`, testado em navegador simulado a 1280 e 390 px):

- **Tempo de estudo** (Planejar e aula): anel de foco com um único botão Iniciar/Pausar/Retomar,
  modos Foco/Pausa/Livre em chips, pontos de ciclos concluídos, Nino no anel (parado com
  movimento reduzido), gráfico de colunas da semana com a meta. Meta, fuso e sincronização foram
  para um diálogo (engrenagem); o diálogo abre sozinho se houver conflito. A atualização dos
  indicadores é automática (saiu "Atualizar indicadores").
- **Objetivos e tarefas**: criação em diálogo (nenhum formulário fica aberto na página); estado
  vazio em cartão com a primeira ação; "Nova tarefa" começa pelo título com o objetivo já escolhido
  e deixa subobjetivo, aula e link a um clique; filtros numa linha discreta; confirmações num aviso
  que some sozinho.
- **Calendário**: navegação por mês (‹ › Hoje), grade compacta com pontos ao lado da agenda,
  "Agendar estudo" como botão principal que abre um diálogo, agenda vazia com ação.
- **Revisar › Flashcards**: "Gerar cartões com IA" e "Criar cartão manualmente" viraram botões que
  abrem diálogos (antes ficavam escondidos em seções recolhidas); filtros numa linha.
- **Estados vazios** (`ninoNote`): Nino e o texto no mesmo cartão, com título e ação opcionais,
  em todas as abas que usam o componente.

**Propostas futuras (não implementadas):**

1. Atalho "Iniciar foco" no Início que abre o cronômetro já pronto (hoje: Início › Sua semana ›
   Detalhes › Iniciar foco).
2. Duração de foco e pausa configuráveis (ex.: 50/10) e pausa longa a cada 4 focos; hoje o
   relógio tem 25/5 fixos e o servidor valida esses tipos.
3. Contagem de ciclos guardada na conta (hoje é só da visita).
4. Sons ambientes e aviso sonoro ao fim do foco (pedem um sistema de áudio próprio e opção de
   desligar; fora do escopo desta sessão).
5. Arrastar para mover horários no calendário e visão semanal com blocos de horário.
6. Revisar o "Organizar meus cartões" (gerenciador em formulário) para edição direto no cartão.
7. Páginas de Configurações e Conta ainda usam seções recolhidas para itens técnicos; estão no
   lugar certo, mas podem ganhar o mesmo tratamento visual de cartões.

## 7. Dívidas técnicas encontradas

| Item                                                                                                           | Impacto                                 | Sugestão                                                    |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| Arquivos órfãos em `audios/temp/` quando o upload termina mas a aula não é criada e a pessoa muda o formulário | Espaço no Storage                       | Tarefa periódica que apaga `temp/` sem aula há mais de 24 h |
| Repetição de geração após resposta inválida do modelo repete o custo                                           | Custo de API                            | Guardar respostas parciais por tarefa                       |
| Sem limitador global (há limite **por conta e por processo** desde 21/11)                                      | Abuso                                   | Limite por usuário nas rotas de geração e mídia             |
| `ai_job_executions` de tarefas de texto ficam em `pending`                                                     | Leitura confusa                         | Marcar `completed` ao terminar                              |
| `check:openapi` sem o arquivo OpenAPI                                                                          | Check desativado                        | Gerar a especificação a partir de `docs/API.md`             |
| ~~Teste de recorte AAC depende da versão do FFmpeg~~ (resolvido: duração contada por quadros)                  | Falha conhecida na suíte                | Fixar a versão ou gerar o AAC no teste                      |
| Flag `social_basic` sem uso; `questoes.html` sem link; `catalog-panel.js` não importado                        | Código morto                            | Remover                                                     |
| ~~`deleteOwnedMaterial` usa o bucket `'audios'` fixo~~ (resolvido: `SUPABASE_AUDIO_BUCKET`)                    | Quebra se o bucket mudar                | Usar `env.audioBucket`                                      |
| `RETRANSCRIBIR_AUDIO` sem implementação                                                                        | Enum sem uso                            | Implementar ou remover                                      |
| Cópia local mantida após sair da conta                                                                         | Privacidade em computador compartilhado | Ver item 5.1                                                |
