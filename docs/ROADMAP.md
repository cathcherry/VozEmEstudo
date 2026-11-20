# Roadmap e situação

O que está pronto, o que falta ativar, o que falta validar e as dívidas técnicas conhecidas.
Atualizado em 20/11/2026, após a auditoria da branch `fix/runtime-docs-consistency`.

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

## 2. Implementado, mas não ativado em produção

Código e migrations prontos; falta aplicar a migration (com autorização) e ligar a flag. Roteiro em
[ATIVACAO_RECURSOS.md](ATIVACAO_RECURSOS.md).

| Recurso                                     | Flag                     | Migration pendente |
| ------------------------------------------- | ------------------------ | ------------------ |
| Planejamento                                | `planning`               | E05                |
| Tentativas de questões e diagnóstico        | `quiz_v2`, `quiz_review` | E10, E12           |
| Flashcards e revisão espaçada               | `flashcards`             | E13                |
| Conjuntos de flashcards (Flashcards 2.0)    | `flashcard_sets`         | `flashcard_sets`   |
| Tempo e progresso de estudo                 | `study_tracking`         | E08/E09            |
| Anotações                                   | `annotations`            | E14/E15            |
| Calendário e cópias de leitura de materiais | `calendar`, `sharing`    | E18/E19            |

## 3. Migrations pendentes (nenhuma aplicada sem autorização)

| Migration                                                       | Para quê                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| E05, E10, E12, E13, E08/E09, E14/E15, E18/E19, `flashcard_sets` | Recursos da seção 2                                                          |
| `20261120120000_profile_state_hardening.sql`                    | Menos permissões do navegador em `profile_state`, formato e limite de chaves |
| `20261119140000_rls_performance.sql`                            | Desempenho das políticas de RLS e índices de chaves estrangeiras             |

## 4. Validação incompleta

- **Leitores de tela reais** (NVDA, VoiceOver, TalkBack): não testados nesta auditoria. A interface
  passa no axe (WCAG A/AA) e em percursos por teclado, o que não comprova uso com leitor de tela.
- Recursos da seção 2: só testes automáticos; precisam de teste manual depois de ativados.
- MP4 original: validado em parte (envio e reprodução); falta testar em celulares.
- Transcrição pelo Hugging Face (Whisper): mantida como alternativa, sem uso recente.
- Testes de carga e de várias abas/aparelhos ao mesmo tempo com dados reais.

## 5. Personalização 2.0 (Prompt 3) — pendências de persistência

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

## 7. Dívidas técnicas encontradas

| Item                                                                                                           | Impacto                                 | Sugestão                                                    |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| Arquivos órfãos em `audios/temp/` quando o upload termina mas a aula não é criada e a pessoa muda o formulário | Espaço no Storage                       | Tarefa periódica que apaga `temp/` sem aula há mais de 24 h |
| Repetição de geração após resposta inválida do modelo repete o custo                                           | Custo de API                            | Guardar respostas parciais por tarefa                       |
| Sem limitador de requisições HTTP global                                                                       | Abuso                                   | Limite por usuário nas rotas de geração e mídia             |
| `ai_job_executions` de tarefas de texto ficam em `pending`                                                     | Leitura confusa                         | Marcar `completed` ao terminar                              |
| `check:openapi` sem o arquivo OpenAPI                                                                          | Check desativado                        | Gerar a especificação a partir de `docs/API.md`             |
| Teste de recorte AAC depende da versão do FFmpeg                                                               | Falha conhecida na suíte                | Fixar a versão ou gerar o AAC no teste                      |
| Flag `social_basic` sem uso; `questoes.html` sem link; `catalog-panel.js` não importado                        | Código morto                            | Remover                                                     |
| `deleteOwnedMaterial` usa o bucket `'audios'` fixo                                                             | Quebra se o bucket mudar                | Usar `env.audioBucket`                                      |
| `RETRANSCRIBIR_AUDIO` sem implementação                                                                        | Enum sem uso                            | Implementar ou remover                                      |
| Cópia local mantida após sair da conta                                                                         | Privacidade em computador compartilhado | Ver item 5.1                                                |
