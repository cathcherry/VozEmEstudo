# Etapa 3 de 9 — E05/E06: planejamento (primeira fatia)

**Referência:** PR #2 (Draft), branch `feat/etapa-2-biblioteca-2-0`. A `main` continua sendo a versão aprovada. **Sem migrações aplicadas ao Supabase.**

## O que já está na branch

- API autenticada sob `FEATURE_PLANNING=true` apenas: `GET /api/planning`, `POST /api/planning/goals`, `POST /api/planning/goals/:goalId/tasks`, `PATCH /api/planning/tasks/:taskId/completion`.
- Cada objetivo tem título, descrição opcional no contrato de API e data-alvo opcional; tarefas têm título, prazo opcional, conclusão e vínculo opcional a um material da mesma conta.
- Primeira interface no Painel com formulários de objetivo/tarefa e lista de progresso. O painel só aparece com `FEATURE_PLANNING=true`. Não substitui o painel existente quando a flag está OFF.
- Serviço e schema têm verificações de propriedade; a FK composta `(goal_id,user_id)` e `(material_id,user_id)` evita que tarefas vinculem outra conta. A exclusão de material apenas desassocia o material da tarefa, sem apagar a tarefa.
- Migration candidata `database/migrations/20261104203000_study_planning.sql`, preflight e postflight em `database/checks/e05-*.sql`, com testes estáticos.

## Ordem de implantação (para quando houver autorização)

1. **E03 primeiro:** validar/aplicar `20261104190000_catalog_units.sql`, executar checks E03 e obter aceite de integridade e isolamento.
2. Fazer backup/confirmar destino; executar `e05-preflight.sql` **somente leitura** e comparar totais.
3. Se E03 estiver presente, os objetos E05 não existirem e o backup estiver confirmado, solicitar aprovação explícita para executar `20261104203000_study_planning.sql` **uma única vez** no Supabase SQL Editor. Essa execução não atualiza automaticamente o histórico do Supabase CLI.
4. Rodar `e05-postflight.sql` e conferir contagens de materiais, transcrições, resumos, questões e ausência de ligações entre contas. Deixar a flag OFF até o backend implantado e testes com duas contas A/B.
5. Ativar `FEATURE_PLANNING=true` apenas em ambiente autorizado e testar criar objetivo, tarefa, vínculo de aula, conclusão, logout e isolamento A/B. Depois de aprovação, abrir a integração para a `main`.

## Não implementado / não aprovado ainda

- Subobjetivos hierárquicos, anexos externos, reordenação, edição/arquivamento de objetivos e tarefas, lembretes e métricas de produtividade.
- Teste do SQL num **PostgreSQL real**, restore de backup, teste remoto com duas contas e avaliação da interface com flags ON.
- E05/E06 **não são gates concluídos**; só temos uma primeira fatia de código em desenvolvimento.

**Decisão de risco:** manter a `main` estável, flags OFF, migrações aditivas e nenhum deploy; testar mais funcionalidades em conjunto quando houver disponibilidade. CI verde indica testes sintéticos, não operação real no Supabase.
