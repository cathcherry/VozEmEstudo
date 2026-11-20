# Etapa 3 de 9 — E05/E06: planejamento (terceira fatia)

> ⚠️ **Documento histórico.** Plano/runbook da etapa; afirmações como "nenhuma migration aplicada" refletem a data em que foi escrito. Para a situação atual, veja [BANCO_DE_DADOS.md](../BANCO_DE_DADOS.md).


**Referência:** PR #2 (Draft), branch `feat/etapa-2-biblioteca-2-0`. A `main` continua sendo a versão aprovada. **Sem migrações aplicadas ao Supabase.**

## O que já está na branch

- API autenticada sob `FEATURE_PLANNING=true`: `GET /api/planning`, `POST /api/planning/goals`, `PATCH /api/planning/goals/:goalId`, `POST /api/planning/goals/:goalId/subgoals`, `POST /api/planning/goals/:goalId/tasks`, `PATCH /api/planning/tasks/:taskId`, `PATCH /api/planning/tasks/:taskId/completion`. Todos os updates são filtrados por `user_id`.
- Cada objetivo tem título, descrição opcional no contrato de API, data-alvo e situação (`active`, `completed`, `archived`); há **subobjetivos de um nível** com título e prazo. Tarefas têm título, prazo, conclusão e vínculo opcional a um material/subobjetivo da mesma conta e do mesmo objetivo.
- Painel com formulários de objetivo, subobjetivo e tarefa; edição inline de metas, **edição de subobjetivos**, edição de tarefas e vínculos, filtros, ordenação (prazo, recentes, título e **ordem manual persistida**) e progresso. Há controles de subir/descer acessíveis na ordem manual, sem arrastar e soltar. O painel só aparece com `FEATURE_PLANNING=true`.
- Serviço e schema verificam propriedade. As FKs compostas `(goal_id,user_id)`, `(material_id,user_id)` e `(subgoal_id,goal_id,user_id)` bloqueiam vínculos entre contas/metas. Exclusão futura de material desassocia a aula da tarefa, sem apagar a tarefa. O usuário não pode escolher arbitrariamente `user_id` na API.
- Migration candidata **ainda não aplicada** `database/migrations/20261104203000_study_planning.sql`, atualizada para subobjetivos, campo `reference_url`, `sort_order` e RPC `study_reorder_tasks` de atualização atômica, executável só por `service_role`. Preflight e postflight em `database/checks/e05-*.sql`. **Usar somente a versão final atual do arquivo**, nunca cópia anterior; o SQL Editor não acompanha commits.

## Ordem de implantação (para quando houver autorização)

1. **E03 primeiro:** validar/aplicar `20261104190000_catalog_units.sql`, executar checks E03 e obter aceite de integridade e isolamento.
2. Fazer backup/confirmar destino; executar `e05-preflight.sql` **somente leitura** e comparar totais.
3. Se E03 estiver presente, os objetos E05 não existirem e o backup estiver confirmado, solicitar aprovação explícita para executar `20261104203000_study_planning.sql` **uma única vez** no Supabase SQL Editor. Essa execução não atualiza automaticamente o histórico do Supabase CLI.
4. Rodar `e05-postflight.sql` e conferir contagens de materiais, transcrições, resumos, questões e ausência de ligações entre contas. Deixar a flag OFF até o backend implantado e testes com duas contas A/B.
5. Ativar `FEATURE_PLANNING=true` apenas em ambiente autorizado e testar criar e editar objetivos/subobjetivos, criar/editar tarefa, vínculo de aula e URL HTTPS, filtros, conclusão, ordem manual com recarga da página, logout e isolamento A/B. Tentar ordenar tarefas de outra meta/conta ou duplicar IDs deve ser negado. Conferir grants e inexistência de RPC para `anon`/`authenticated`. Depois de aprovação, abrir a integração para a `main`.

## Não implementado / não aprovado ainda

- Faltam exclusão de subobjetivos e metas, **upload de arquivos anexados** (foi implementado apenas link HTTPS), arrastar e soltar, lembretes e métricas de produtividade. A ordem manual é persistida por uma RPC transacional, mas **não foi validada no Supabase real**.
- Teste do SQL num **PostgreSQL real**, restore de backup, teste remoto com duas contas e avaliação da interface com flags ON.
- E05/E06 **não são gates concluídos**; código e migration candidata estão na branch, mas a execução no Supabase e os testes com flags ligadas continuam pendentes.

**Decisão de risco:** manter a `main` estável, flags OFF, migrações aditivas e nenhum deploy; testar mais funcionalidades em conjunto quando houver disponibilidade. CI verde indica testes sintéticos, não operação real no Supabase.
