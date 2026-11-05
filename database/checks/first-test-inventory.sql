-- Inventário somente de leitura para o SQL Editor. Não instala nem corrige nada.
-- AUSENTE/PARCIAL requer análise do preflight; PRESENTE não significa homologado.
-- Não retorna conteúdo de aulas, contas, chaves, caminhos de objetos ou tokens.
begin read only;
with expected(module, table_name, required_columns) as (values
  ('catalog_units', 'study_subjects', array['id','user_id']),
  ('catalog_units', 'study_units', array['id','subject_id']),
  ('catalog_units', 'materials', array['id','subject_id','unit_id']),
  ('planning', 'study_goals', array['id','user_id']),
  ('planning', 'study_subgoals', array['id','goal_id']),
  ('planning', 'study_tasks', array['id','reference_url','sort_order','completed_at']),
  ('quiz_v2', 'quiz_sessions', array['id','batch_id']),
  ('quiz_v2', 'quiz_session_answers', array['session_id','question_id']),
  ('quiz_review', 'quiz_sessions', array['id','kind','source_session_id']),
  ('quiz_review', 'quiz_session_items', array['session_id','question_id']),
  ('flashcards', 'study_flashcards', array['id','due_at']),
  ('flashcards', 'study_flashcard_reviews', array['id','request_id']),
  ('mp4_retention', 'material_videos', array['material_id','storage_path','clip_start_ms','clip_end_ms']),
  ('study_tracking', 'study_settings', array['user_id','timezone']),
  ('study_tracking', 'study_progress', array['material_id','version']),
  ('study_tracking', 'study_sessions', array['id','last_sequence']),
  ('study_tracking', 'study_time_credits', array['session_id','sequence']),
  ('annotations', 'study_annotations', array['id','source_revision_id','version']),
  ('calendar', 'study_calendar_events', array['id','version']),
  ('calendar', 'study_tasks', array['id','due_date']),
  ('sharing', 'material_shares', array['id','token_hash','expires_at','revoked_at'])
), inventory as (
  select e.*, c.oid, c.relrowsecurity,
    array(select col from unnest(e.required_columns) col where not exists (
      select 1 from pg_attribute a where a.attrelid=c.oid and a.attname=col and not a.attisdropped
    )) missing_columns
  from expected e left join pg_namespace n on n.nspname='public'
  left join pg_class c on c.relnamespace=n.oid and c.relname=e.table_name and c.relkind in ('r','p')
)
select module, table_name,
  case when oid is null then 'AUSENTE' when cardinality(missing_columns)>0 then 'PARCIAL' else 'PRESENTE' end schema_status,
  missing_columns, relrowsecurity rls,
  case when oid is not null then has_table_privilege('anon',oid,'SELECT') end anon_select,
  case when oid is not null then has_table_privilege('authenticated',oid,'SELECT') end authenticated_select,
  case when oid is not null then has_table_privilege('service_role',oid,'SELECT') end server_select
from inventory order by module,table_name;

-- Todas estas funções devem existir e ser exclusivas do servidor, exceto a versão E02.
with expected(signature) as (values
  ('public.current_permission_version()'),
  ('public.study_reorder_tasks(uuid,uuid,uuid[])'),
  ('public.quiz_submit_answer_admin(uuid,uuid,uuid,integer)'),
  ('public.quiz_finish_session_admin(uuid,uuid)'),
  ('public.quiz_create_review_session_admin(uuid,uuid,text)'),
  ('public.study_review_flashcard_admin(uuid,uuid,integer,uuid)'),
  ('public.study_save_progress_admin(uuid,uuid,integer,uuid,jsonb)'),
  ('public.study_start_session_admin(uuid,uuid,uuid,text)'),
  ('public.study_tick_session_admin(uuid,uuid,integer,boolean,boolean)'),
  ('public.study_save_settings_admin(uuid,integer,text)'),
  ('public.study_overview_admin(uuid)'),
  ('public.study_save_annotation_admin(uuid,uuid,uuid,integer,uuid,jsonb)'),
  ('public.study_list_annotations_admin(uuid,uuid,text,integer)'),
  ('public.study_save_calendar_admin(uuid,uuid,integer,uuid,jsonb)'),
  ('public.study_calendar_feed_admin(uuid,timestamp with time zone,timestamp with time zone,date,date,integer)'),
  ('public.study_create_share_admin(uuid,uuid,uuid,uuid,text,uuid,boolean,boolean,integer,text)'),
  ('public.study_resolve_share_admin(text)')
), functions as (select signature,to_regprocedure(signature)::oid oid from expected)
select signature,oid is not null present,
  case when oid is not null then has_function_privilege('anon',oid,'EXECUTE') end anon_execute,
  case when oid is not null then has_function_privilege('authenticated',oid,'EXECUTE') end authenticated_execute,
  case when oid is not null then has_function_privilege('service_role',oid,'EXECUTE') end server_execute
from functions order by signature;

select to_regclass('public.materials') is not null base_present,
  to_regclass('public.material_permissions') is not null e02_permissions_present,
  to_regclass('public.transcription_confirmations') is not null e02_confirmations_present,
  to_regclass('public.content_warnings') is not null e02_warnings_present,
  to_regclass('supabase_migrations.schema_migrations') is not null migration_ledger_present;
-- SQL manual pode não aparecer no ledger. Conferir o schema e o histórico do SQL Editor.
select id,public,file_size_limit,allowed_mime_types from storage.buckets
where id in ('audios','study-videos') order by id;
-- Caso SUPABASE_AUDIO_BUCKET tenha outro nome, conferir esse bucket no painel Storage.
rollback;
