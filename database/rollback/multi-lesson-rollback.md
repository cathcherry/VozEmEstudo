# Reversão — Material integrado (`20261121170000_multi_lesson.sql` e `20261121171000_knowledge_map_cache.sql`)

1. **Sem perda de dados:** `FEATURE_MULTI_LESSON=false` e reiniciar API e worker.
   - As rotas `/api/multi-lesson` deixam de existir (404) e o worker para de ler a fila multiaula.
   - Pedidos que estavam na fila ficam parados. Se houver gerações `running` ligadas a eles, a chave
     fica ocupada até a reversão completa (passo 3) ou até religar a flag.
2. **Exportar** antes de qualquer remoção:
   `select * from public.multi_lesson_materials;`, `select * from public.multi_lesson_jobs;` e,
   se existir, `select * from public.knowledge_maps;`.
3. **Liberar as chaves** de gerações multiaula ainda vivas (não apaga resultados):

```sql
update public.ai_generations set status = 'failed', error_code = 'MULTI_LESSON_ROLLBACK',
  updated_at = now(), completed_at = now()
where kind = 'multi_lesson' and status in ('pending', 'running');
```

4. **Remover o cache** (opcional e independente; destrutivo, só com backup e autorização). Pode ser
   removido sozinho: a geração continua funcionando, só sem reaproveitar mapas.

```sql
begin;
drop function public.knowledge_map_put_admin(uuid, uuid, text, text, jsonb, text);
drop function public.knowledge_map_get_admin(uuid, uuid[], text, text);
drop table public.knowledge_maps;
commit;
```

5. **Remover o material integrado** (destrutivo, só com backup e autorização):

```sql
begin;
drop function public.multi_lesson_fail_job_admin(uuid, text, text, timestamptz);
drop function public.multi_lesson_complete_job_admin(uuid, text, jsonb, text);
drop function public.multi_lesson_job_sources_admin(uuid, text);
drop function public.multi_lesson_renew_lease_admin(uuid, text);
drop function public.multi_lesson_claim_job_admin(text, integer);
drop function public.multi_lesson_delete_admin(uuid, uuid);
drop function public.multi_lesson_attach_admin(uuid, uuid, uuid, text, text, uuid[], text[], jsonb, uuid, text, integer);
drop function public.multi_lesson_list_admin(uuid, integer);
drop function public.multi_lesson_get_admin(uuid, uuid);
drop function public.multi_lesson_resolve_admin(uuid, text, uuid[]);
drop table public.multi_lesson_jobs;
drop table public.multi_lesson_materials;
drop function public.multi_lesson_freeze_sources();
commit;
```

Nenhum dado existente foi transformado por estas migrations. As linhas `kind = 'multi_lesson'` de
`ai_generations` ficam como histórico (e contam no orçamento do dia em que foram criadas).
