-- Material integrado (Marco C) — postflight (somente leitura).
-- Esperado: generations_after = generations_before; confirmations_after = confirmations_before;
-- records = 0; jobs = 0; rls_enabled = true; no_browser_access = true; functions_server_only = true;
-- snapshot_frozen = true. Depois do cache (opcional): cache_applied = true e cache_rls_enabled = true;
-- sem o cache, cache_applied = false e cache_rls_enabled = null (a geração funciona sem ele).
select
  (select count(*) from public.ai_generations) as generations_after,
  (select count(*) from public.transcription_confirmations) as confirmations_after,
  (select count(*) from public.multi_lesson_materials) as records,
  (select count(*) from public.multi_lesson_jobs) as jobs,
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.multi_lesson_materials'::regclass, 'public.multi_lesson_jobs'::regclass)) as rls_enabled,
  not has_table_privilege('authenticated', 'public.multi_lesson_materials', 'select')
    and not has_table_privilege('anon', 'public.multi_lesson_materials', 'select')
    and not has_table_privilege('authenticated', 'public.multi_lesson_jobs', 'select')
    and not has_table_privilege('anon', 'public.multi_lesson_jobs', 'select') as no_browser_access,
  not has_function_privilege('authenticated', 'public.multi_lesson_resolve_admin(uuid,text,uuid[])', 'execute')
    and not has_function_privilege('anon', 'public.multi_lesson_attach_admin(uuid,uuid,uuid,text,text,uuid[],text[],jsonb,uuid,text,integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.multi_lesson_claim_job_admin(text,integer)', 'execute') as functions_server_only,
  exists (select 1 from pg_trigger where tgname = 'multi_lesson_materials_sources_immutable'
    and tgrelid = 'public.multi_lesson_materials'::regclass) as snapshot_frozen,
  to_regclass('public.knowledge_maps') is not null as cache_applied,
  (select relrowsecurity from pg_class where oid = to_regclass('public.knowledge_maps')) as cache_rls_enabled;
