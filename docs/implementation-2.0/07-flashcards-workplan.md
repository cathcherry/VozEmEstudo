# Etapa 5 de 9 — E13: Flashcards e revisão espaçada

> ⚠️ **Documento histórico.** Plano/runbook da etapa; afirmações como "nenhuma migration aplicada" refletem a data em que foi escrito. Para a situação atual, veja [BANCO_DE_DADOS.md](../BANCO_DE_DADOS.md).


**Estado:** implementação da etapa 5 concluída em código; aguardando homologação integrada. Versão de desenvolvimento salva na branch `feat/etapa-2-biblioteca-2-0`, PR #2 em rascunho. **Nenhum SQL foi aplicado ao Supabase.** A flag `FEATURE_FLASHCARDS=false` por padrão.

## Funcionalidades preparadas

- Criação manual de cartão de pergunta e resposta, com vínculo opcional a uma aula da própria conta.
- Edição e arquivamento de cartões, sem exclusão destrutiva; cartões arquivados não aparecem na fila de revisão.
- Visualização de cartões vencidos: revelar verso e avaliar a lembrança usando **De novo**, **Difícil**, **Bom** ou **Fácil**.
- Histórico persistente de revisões consultável pela API (50 mais recentes por cartão); agendamento armazenado no Supabase, não no navegador.
- Algoritmo SRS simples, inspirado em revisões por intervalo, **não é implementação validada cientificamente de SM-2/FSRS**. `De novo` agenda +10 minutos; as outras notas ampliam intervalos conforme repetições e fator de facilidade, limitados a 3650 dias. Qualquer horário mostrado usa o fuso do dispositivo.
- Reenvios usam `requestId` único para idempotência. A função SQL bloqueia a linha do cartão enquanto calcula o próximo intervalo e impede dupla atualização com o mesmo ID.
- Consultas em páginas de **100 cartões**, com navegação anterior/próxima no gerenciador e contagem total. Filtros por aula e por situação (ativos/arquivados); a fila de revisão sempre considera apenas cartões ativos e vencidos. O filtro por aula também restringe a fila de revisão.
- Histórico visível ao selecionar um cartão no gerenciador: até 50 revisões recentes, nota atribuída, data e próxima revisão agendada naquele momento. Respostas atrasadas de outra seleção são descartadas.
- Uma revisão já confirmada é removida da fila local mesmo quando a atualização seguinte falha; a interface distingue falha de confirmação de falha ao atualizar a lista.

## Segurança, ambiente e aplicação

1. Este módulo não usa novas dependências locais. Ele só requer backend Node já existente e Supabase.
2. **Dependência:** E03 e E05/E06 aprovadas no banco real; E13 usa a FK composta `(material_id,user_id)` da E05. Não depende da E10/E12 para funcionar, mas **respeitar a ordem geral de migrations** ao instalar tudo.
3. Fazer backup restaurável, confirmar projeto correto e executar `database/checks/e13-preflight.sql` no **SQL Editor** (somente leitura).
4. Se o schema estiver compatível e houver aprovação explícita, executar **uma única vez** `database/migrations/20261104234500_flashcards.sql`, transação `BEGIN/COMMIT`. A execução via SQL Editor não registra a migration automaticamente no ledger do CLI.
5. Executar `database/checks/e13-postflight.sql`: contagens legadas inalteradas, RLS ligada, usuários `anon/authenticated` sem acesso direto às novas tabelas e RPC, `service_role` autorizado, zero vínculos de outra conta.
6. Só depois disso ativar `FEATURE_FLASHCARDS=true` em ambiente de teste e validar contas A/B: criar com e sem aula, tentar vincular aula de B, editar, arquivar, reativar, rever em notas distintas e voltar após nova sessão; reproduzir duas requisições com mesmo `requestId` para checar idempotência.
7. Aprovar merge para `main` **somente depois** do teste integrado e aceite humano. Se o módulo falhar, voltar a flag OFF; não fazer `DROP` dos dados para “reverter”.

## Limitações

- A geração por IA usa exclusivamente a transcrição confirmada, com prévia e conferência humana antes de salvar cada cartão. Não importa cartões de resumos ou questões; não há salvamento automático em lote.
- Não há upload de imagens/arquivos nem conjunto de cartões compartilháveis.
- O algoritmo ainda não foi calibrado com dados de aprendizado, o SQL é exercitado com **PostgreSQL embarcado (PGlite)** no CI, mas **não foi validado no Supabase real**, com o schema e as permissões efetivas do projeto. Os testes não substituem a homologação integrada.
- Dados persistidos podem ser usados entre dispositivos **após o backend, migration e flag serem implantados e validados**.

## Continuação da etapa 5 — paginação e histórico

A API `GET /api/flashcards` mantém `filter=due|all` e passa a aceitar `materialId` (UUID), `status=all|active|archived` e `offset` (inteiro de 0 a 1.000.000). A resposta inclui `offset`, `limit`, `total` e `cards`. O padrão continua sendo a fila de vencidos, com `offset=0`. Ordenação estável por data e ID; todo acesso segue restrito ao `user_id` autenticado. `status` só altera o gerenciador (`filter=all`); a fila `due` é sempre ativa. Não há nova migration nesta continuação.

A navegação usa páginas de 100 registros; a fila carrega mais cartões conforme as avaliações são confirmadas. Atualizações concorrentes em outros dispositivos podem mudar a composição entre páginas. Histórico limitado às 50 revisões mais recentes por cartão. A geração de cartões por IA e a personalização de resumos foram acrescentadas na conclusão abaixo.

Validação direcionada: testes de validação, escopo da consulta, limites da paginação, navegação até o cartão 101, filtros, descarte de histórico atrasado e falha de recarga após revisão confirmada. Executar `node --test backend/tests/flashcards.test.js frontend/tests/flashcard-ui.test.mjs` com as dependências normais do projeto. Esses testes usam APIs simuladas e DOM isolado; não comprovam integração com Supabase ou aparência em navegador real.


## Conclusão da implementação — prévia por IA e resumos personalizados

A etapa 5 está **concluída em código para o escopo descrito aqui**, sem homologação no ambiente real. A integração com Groq e Supabase, a aparência em navegador real e o aceite continuam pendentes; não equivalem à conclusão da implementação.

### Flashcards por IA

- `POST /api/flashcards/preview` está dentro da flag `FEATURE_FLASHCARDS` e da autenticação existentes. Corpo estrito: `materialId`, `sourceRevisionId` (UUIDs), `count` (5, 10 ou 20; padrão 5). Nenhum texto enviado pelo navegador serve como fonte.
- Antes de chamar o provedor, verifica propriedade da aula, permissão vigente e confirmação da revisão atual. A leitura é da versão imutável dessa transcrição. A revisão pode tornar-se antiga durante a geração, mas a prévia permanece identificada pela revisão originalmente selecionada.
- A resposta informa aula, ID/número da revisão, modelo, versão do prompt e até a quantidade solicitada de sugestões (`front`, `back`, `evidence`). Campos, comprimentos, duplicatas e existência literal do trecho na fonte são validados. Uma referência literal **não comprova correção semântica**, qualidade pedagógica ou veracidade do conteúdo da aula.
- Fonte vazia ou acima de 80 mil caracteres é recusada, sem truncamento silencioso. Uma geração por conta pode ficar em andamento por processo do backend; não é um limitador de uso distribuído nem uma cota de consumo.
- No Painel, selecionar a aula e gerar prévia. Cada sugestão mostra resposta e trecho de apoio. **Editar este cartão no formulário** copia frente, verso e vínculo com a aula para o formulário manual existente; o estudante confere, altera e salva individualmente. Nada é salvo pela geração. A prévia é temporária; os cartões salvos são cartões editáveis comuns, com vínculo à aula, sem afirmação de proveniência imutável da sugestão após a edição.
- Falhas permitem nova tentativa e preservam o formulário manual. O conteúdo da IA é renderizado como texto, sem interpretação de HTML. Modo de serviços simulados retorna um exemplo explicitamente marcado como demonstração, sem chamar o provedor.

### Resumos personalizados

- Na aula, escolher **parágrafos ou tópicos**, e extensão **breve, intermediária ou detalhada**. As opções se aplicam tanto à primeira geração quanto à atualização.
- `POST /api/materials/:materialId/summaries` aceita `options: {format: paragraphs|topics, length: short|standard|detailed}` além de `sourceRevisionId` e `idempotencyKey`. Sem `options`, preserva os parâmetros legados para compatibilidade com reenvios de jobs existentes.
- As opções são validadas, armazenadas em `processing_jobs.params.summaryOptions` e usadas pelo worker. A fonte confirmada, o versionamento, a proteção contra reenvio e os commits transacionais existentes são preservados. A chave de tentativa no navegador inclui formato e extensão. Os controles ficam bloqueados durante a geração.
- Prompt `summary-v2`; orçamento de saída: 900/1800/3500 tokens conforme extensão. As opções orientam o modelo, sem garantir tamanho exato. Não há prompt livre nem acréscimo de conhecimento externo. Versões anteriores são preservadas pelo fluxo existente.

### Banco, publicação e validação

Esta conclusão não cria nem altera migrations: usa a tabela E13 de cartões, as revisões E02 e os parâmetros JSON dos jobs existentes. A migration E13 continua pendente no Supabase. Nenhum deploy ou merge na `main` foi feito. As preferências de resumo são parte do fluxo existente de resumos, disponíveis quando este código de frontend/backend/worker for implantado em conjunto; não possuem flag separada.

Validação local: lint do backend e módulos de frontend alterados, mais **28 testes direcionados** (backend e DOM). Cobrem isolamento de conta, fonte confirmada, falhas do provedor, saídas inválidas, concorrência por conta, opções de resumo, prévia sem salvamento, HTML tratado como texto, cópia para edição, paginação, histórico e retomada de revisão. Chamadas à IA e ao banco são simuladas nesses testes. O GitHub Actions da versão publicada deve ser conferido separadamente.

Para homologar junto às demais etapas, acrescentar ao roteiro: conta A não gera cartões da aula de B; revisão não confirmada é recusada; gerar com Groq real e conferir trechos; editar/salvar uma sugestão e revisar em outra sessão; gerar os seis formatos/extensões de resumo e conferir preservação do histórico e da revisão-fonte. Isso não exige Docker nem instalação adicional no computador da responsável.
