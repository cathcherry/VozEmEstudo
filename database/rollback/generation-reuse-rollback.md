# Reversão — Gerações reutilizáveis (`20261121160000_generation_reuse.sql`)

1. **Sem perda de dados:** `FEATURE_GENERATION_REUSE=false` e reiniciar API e worker.
   - Os pedidos voltam ao fluxo anterior: cada pedido vira um job.
   - Jobs com `params.generationId` continuam rodando normalmente; o worker só deixa de registrar a conclusão na tabela.
2. **Exportar** `select * from public.ai_generations;` antes de qualquer remoção. Isso é só histórico: os resumos e listas continuam em `summary_versions` e `question_batches`.
3. **Remover** (destrutivo, só com backup e autorização):

```sql
begin;
drop function public.fail_generation_admin(uuid, text);
drop function public.complete_generation_admin(uuid, jsonb);
drop function public.attach_generation_job_admin(uuid, uuid);
drop function public.begin_generation_admin(uuid, text, text, uuid, text, uuid[], text, text, uuid, boolean, integer);
drop table public.ai_generations;
commit;
```

Nenhum dado existente foi transformado por esta migration, então a remoção não afeta materiais, jobs ou resultados.
