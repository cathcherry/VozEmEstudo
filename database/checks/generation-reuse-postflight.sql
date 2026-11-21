-- Gerações reutilizáveis — postflight (somente leitura).
-- Esperado: jobs_after = jobs_before; generations = 0; rls_enabled = true; no_browser_access = true;
-- live_key_index = true; functions_server_only = true.
select
  (select count(*) from public.processing_jobs) as jobs_after,
  (select count(*) from public.ai_generations) as generations,
  (select relrowsecurity from pg_class where oid = 'public.ai_generations'::regclass) as rls_enabled,
  not has_table_privilege('authenticated', 'public.ai_generations', 'select')
    and not has_table_privilege('anon', 'public.ai_generations', 'select') as no_browser_access,
  exists (select 1 from pg_indexes where indexname = 'ai_generations_live_key') as live_key_index,
  not has_function_privilege('authenticated', 'public.begin_generation_admin(uuid,text,text,uuid,text,uuid[],text,text,uuid,boolean,integer)', 'execute') as functions_server_only;
