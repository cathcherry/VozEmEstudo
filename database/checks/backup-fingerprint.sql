-- Impressão digital de um banco (SOMENTE LEITURA) para comparar o banco de origem com a cópia
-- restaurada de um backup: contagens de objetos, linhas e hashes de conteúdo. Rode nos dois e compare
-- linha a linha (diff); qualquer diferença significa que o backup NÃO está verificado.
-- Rode ANALYZE antes (as contagens de linhas usam pg_stat_user_tables).
select 'tables' k, count(*)::text v from information_schema.tables where table_schema='public'
union all select 'functions', count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
union all select 'policies', count(*)::text from pg_policies where schemaname in ('public','storage')
union all select 'rls_tables', count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity
union all select 'triggers', count(*)::text from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
union all select 'rows:'||relname, n_live_tup::text from pg_stat_user_tables where schemaname='public' and relname in ('materials','study_annotations','study_flashcards','classrooms','ai_generations','multi_lesson_materials','study_notebooks','transcription_versions')
union all select 'md5_annotations', md5(coalesce(string_agg(id::text||quote||coalesce(note_text,''), ',' order by id),'')) from public.study_annotations
union all select 'md5_flashcards', md5(coalesce(string_agg(id::text||front_text||back_text||note_type, ',' order by id),'')) from public.study_flashcards
order by 1;
