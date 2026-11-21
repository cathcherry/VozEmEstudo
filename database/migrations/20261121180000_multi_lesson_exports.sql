-- Voz em Estudo 3.4 / Material integrado: questões tentáveis e conjunto de flashcards — MIGRACAO
-- CANDIDATA (nao aplicada em producao).
-- Depende de: 20261121170000_multi_lesson (multi_lesson_materials), 20261119120000_study_authoring
-- (commit_question_list_admin, listas nomeadas), 20261121150000_flashcards_3_0
-- (study_create_flashcard_deck_admin) e, por elas, E02 (processing_jobs, confirmacoes).
-- Aditiva: uma tabela nova (vazia) e funcoes novas; nada existente e removido, substituido ou
-- transformado. As funcoes existentes sao apenas CHAMADAS (mesmas validacoes de sempre).
-- O que cria:
--   * multi_lesson_exports: o registro de proveniencia "este material integrado virou esta lista
--     de questoes / este conjunto de flashcards". Uma linha por (material integrado, tipo): um
--     segundo clique devolve o que ja existe; o request_id torna o POST idempotente.
--   * multi_lesson_export_questions_admin: transforma as questoes integradas numa lista de questoes
--     comum (question_batches/questions), ancorada na primeira aula de origem ainda utilizavel, com
--     a referencia ao material integrado na configuracao da lista e a citacao de cada questao nos
--     metadados. A lista e respondida pelo fluxo de sempre (responder.html, quiz_sessions).
--   * multi_lesson_export_flashcards_admin: cria um conjunto pessoal (study_flashcard_sets) com os
--     cartoes integrados; cada cartao guarda o trecho e a aula de origem.
--   * multi_lesson_exports_admin: o que ja foi criado a partir de um material integrado.
-- Tudo privado a conta: RLS ligado, nenhum grant ao navegador, funcoes recebem p_user_id.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
begin
  if to_regclass('public.multi_lesson_materials') is null
    or to_regprocedure('public.multi_lesson_get_admin(uuid,uuid)') is null
    or to_regprocedure('public.commit_question_list_admin(uuid,uuid,integer,jsonb,text,text,text,jsonb,jsonb,text)') is null
    or to_regprocedure('public.study_create_flashcard_deck_admin(uuid,uuid,jsonb)') is null
    or to_regprocedure('public.current_permission_version()') is null
    or to_regclass('public.processing_jobs') is null then
    raise exception 'MULTI_LESSON_EXPORTS_ABORT: aplicar multi_lesson, study_authoring e flashcards_3_0 antes';
  end if;
  if to_regclass('public.multi_lesson_exports') is not null then
    raise exception 'MULTI_LESSON_EXPORTS_ABORT: multi_lesson_exports ja existe; nao reaplicar';
  end if;
end
$guard$;

-- 1. Provenance: integrated material -> question list / flashcard set ----------------------------
create table public.multi_lesson_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  multi_lesson_id uuid not null references public.multi_lesson_materials(id) on delete cascade,
  kind text not null check (kind in ('questions', 'flashcards')),
  -- Idempotency of the POST (a retried request returns the same export).
  request_id uuid not null,
  -- Questions: the lesson that hosts the list (first source still usable), the list and the
  -- completed job that the list's frozen-source rule requires. Deleting that lesson deletes the
  -- list (as for any list of the lesson) and these become null: the export can be made again.
  material_id uuid references public.materials(id) on delete set null,
  batch_id uuid references public.question_batches(id) on delete set null,
  processing_job_id uuid references public.processing_jobs(id) on delete set null,
  -- Flashcards: the personal set. Deleting the set makes this null: it can be made again.
  set_id uuid references public.study_flashcard_sets(id) on delete set null,
  item_count integer not null check (item_count between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint multi_lesson_exports_once unique (multi_lesson_id, kind),
  constraint multi_lesson_exports_request_unique unique (user_id, request_id),
  constraint multi_lesson_exports_target check (
    (kind = 'questions' and set_id is null)
    or (kind = 'flashcards' and batch_id is null and material_id is null and processing_job_id is null))
);
create index multi_lesson_exports_owner_idx on public.multi_lesson_exports(user_id, multi_lesson_id);
create index multi_lesson_exports_batch_idx on public.multi_lesson_exports(batch_id) where batch_id is not null;
create index multi_lesson_exports_set_idx on public.multi_lesson_exports(set_id) where set_id is not null;
create index multi_lesson_exports_material_idx on public.multi_lesson_exports(material_id) where material_id is not null;
create index multi_lesson_exports_job_idx on public.multi_lesson_exports(processing_job_id) where processing_job_id is not null;

alter table public.multi_lesson_exports enable row level security;
revoke all on table public.multi_lesson_exports from public, anon, authenticated;
grant select, insert, update, delete on table public.multi_lesson_exports to service_role;

-- 2. Reading -------------------------------------------------------------------------------------
create function public.multi_lesson_export_view(p_export public.multi_lesson_exports, p_replayed boolean)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', p_export.id, 'kind', p_export.kind, 'multiLessonId', p_export.multi_lesson_id,
    'materialId', p_export.material_id, 'batchId', p_export.batch_id, 'setId', p_export.set_id,
    'itemCount', p_export.item_count, 'createdAt', p_export.created_at, 'updatedAt', p_export.updated_at,
    'available', (p_export.batch_id is not null or p_export.set_id is not null), 'replayed', coalesce(p_replayed, false))
$$;

create function public.multi_lesson_exports_admin(p_user_id uuid, p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform 1 from public.multi_lesson_materials where id = p_id and user_id = p_user_id;
  if not found then raise exception 'MULTI_LESSON_NOT_FOUND'; end if;
  return coalesce((select jsonb_agg(public.multi_lesson_export_view(e, false) order by e.kind)
    from public.multi_lesson_exports e where e.multi_lesson_id = p_id and e.user_id = p_user_id), '[]'::jsonb);
end $$;

-- 3. Questions -> an ordinary question list --------------------------------------------------------
-- A question list belongs to ONE lesson and its insert trigger requires a completed generation job
-- with a frozen, confirmed source. The integrated list is therefore anchored on the first source
-- lesson (in the record's frozen order) that is still the owner's, with the current permission
-- declaration and a confirmation (current consent) of the frozen revision. A completed (CONCLUIDA)
-- GERAR_QUESTOES job records that origin; the existing commit_question_list_admin then writes the
-- list with all its usual checks. Nothing is paid or generated again.
create function public.multi_lesson_export_questions_admin(p_user_id uuid, p_id uuid, p_request_id uuid, p_title text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_rec public.multi_lesson_materials; v_export public.multi_lesson_exports; v_material uuid; v_revision uuid;
  v_confirmation uuid; v_job public.processing_jobs; v_batch jsonb; v_questions jsonb; v_count integer;
  v_title text; v_version text := public.current_permission_version();
begin
  if p_user_id is null or p_id is null or p_request_id is null then raise exception 'MULTI_LESSON_INVALID_INPUT'; end if;
  if p_title is not null and char_length(btrim(p_title)) > 160 then raise exception 'MULTI_LESSON_INVALID_INPUT'; end if;
  select * into v_export from public.multi_lesson_exports where user_id = p_user_id and request_id = p_request_id;
  if found then
    if v_export.multi_lesson_id <> p_id or v_export.kind <> 'questions' then raise exception 'MULTI_LESSON_REQUEST_CONFLICT'; end if;
    return public.multi_lesson_export_view(v_export, true);
  end if;
  -- One export at a time per record: a double click waits here and then finds the first one.
  select * into v_rec from public.multi_lesson_materials where id = p_id and user_id = p_user_id for update;
  if not found then raise exception 'MULTI_LESSON_NOT_FOUND'; end if;
  if v_rec.status <> 'ready' then raise exception 'MULTI_LESSON_NOT_READY'; end if;
  v_questions := v_rec.result->'questions';
  if v_questions is null or jsonb_typeof(v_questions) <> 'array' or jsonb_array_length(v_questions) = 0 then
    raise exception 'MULTI_LESSON_NOTHING_TO_EXPORT';
  end if;
  select * into v_export from public.multi_lesson_exports where multi_lesson_id = p_id and kind = 'questions' for update;
  if found and v_export.batch_id is not null then return public.multi_lesson_export_view(v_export, true); end if;

  select m.id, tv.id, tc.id into v_material, v_revision, v_confirmation
  from jsonb_array_elements(v_rec.sources) with ordinality s(value, ordinality)
  join public.materials m on m.id = (s.value->>'materialId')::uuid and m.user_id = p_user_id
  join public.transcription_versions tv on tv.id = (s.value->>'revisionId')::uuid
  join public.transcriptions t on t.id = tv.transcription_id and t.material_id = m.id
  join lateral (select c.id from public.transcription_confirmations c
    where c.material_id = m.id and c.user_id = p_user_id and c.transcription_version_id = tv.id
      and c.consent_version = v_version
    order by c.id limit 1) tc on true
  where exists (select 1 from public.material_permissions mp where mp.material_id = m.id
    and mp.user_id = p_user_id and mp.declaration_version = v_version)
  order by s.ordinality
  limit 1;
  if v_material is null then raise exception 'MULTI_LESSON_ANCHOR_UNAVAILABLE'; end if;

  v_count := least(jsonb_array_length(v_questions), 100);
  v_title := left(coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'Questões integradas: ' || v_rec.title), 160);
  insert into public.processing_jobs(material_id, type, status, params, source_transcription_version_id, confirmation_id,
    idempotency_key, attempt_count, max_attempts, started_at, completed_at)
  values (v_material, 'GERAR_QUESTOES', 'CONCLUIDA',
    jsonb_build_object('count', v_count, 'sourceRevisionId', v_revision::text, 'permissionVersion', v_version,
      'origin', 'multi_lesson', 'multiLessonId', v_rec.id),
    v_revision, v_confirmation, p_request_id, 1, 1, now(), now())
  returning * into v_job;

  -- Each question keeps its citations in metadata; the explanation names the lessons it comes from
  -- (shown after answering, like any explanation).
  v_batch := public.commit_question_list_admin(v_material, v_job.id, v_count,
    (select jsonb_agg(jsonb_build_object(
        'statement', q.value->>'statement',
        'options', q.value->'options',
        'correctIndex', (q.value->>'correctIndex')::integer,
        'explanation', nullif(concat_ws(E'\n\n', nullif(btrim(coalesce(q.value->>'explanation', '')), ''),
          (select 'Fontes: ' || string_agg(src.label, '; ' order by src.first)
            from (select (c.value->>'lessonTitle') || ', trecho ' || ((c.value->>'position')::integer + 1) as label,
                min(c.ordinality) as first
              from jsonb_array_elements(coalesce(q.value->'citations', '[]'::jsonb)) with ordinality c(value, ordinality)
              group by 1) src)), ''),
        'metadata', jsonb_build_object('origin', 'multi_lesson', 'multiLessonId', v_rec.id,
          'citations', coalesce(q.value->'citations', '[]'::jsonb)))
      order by q.ordinality)
     from jsonb_array_elements(v_questions) with ordinality q(value, ordinality)
     where q.ordinality <= v_count),
    coalesce(v_rec.model, 'multi-lesson'), coalesce(v_rec.prompt_version, 'multi-lesson-v1'), v_title,
    jsonb_build_object('origin', jsonb_build_object('kind', 'multi_lesson', 'multiLessonId', v_rec.id,
      'title', v_rec.title, 'sources', (select jsonb_agg(jsonb_build_object('materialId', s.value->'materialId',
        'title', s.value->'title', 'revision', s.value->'revision') order by s.ordinality)
        from jsonb_array_elements(v_rec.sources) with ordinality s(value, ordinality)))),
    jsonb_build_object('requested', v_count, 'generated', v_count),
    nullif(v_rec.settings#>>'{ai,provider}', ''));

  if v_export.id is null then
    insert into public.multi_lesson_exports(user_id, multi_lesson_id, kind, request_id, material_id, batch_id,
      processing_job_id, item_count)
    values (p_user_id, p_id, 'questions', p_request_id, v_material, (v_batch->>'id')::uuid, v_job.id, v_count)
    returning * into v_export;
  else
    update public.multi_lesson_exports set request_id = p_request_id, material_id = v_material,
      batch_id = (v_batch->>'id')::uuid, processing_job_id = v_job.id, item_count = v_count, updated_at = now()
    where id = v_export.id returning * into v_export;
  end if;
  return public.multi_lesson_export_view(v_export, false);
end $$;

-- 4. Flashcards -> a personal flashcard set --------------------------------------------------------
-- Uses the Flashcards 3.0 deck function (a personal set with no lesson). Each card keeps the quote
-- and the passages that support it (evidence, source_segments) and the lesson it comes from
-- (origin_label, shown as "De: <aula>"). A card whose question repeats one already in the set is
-- skipped by the deck function and reported.
create function public.multi_lesson_export_flashcards_admin(p_user_id uuid, p_id uuid, p_request_id uuid, p_name text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_rec public.multi_lesson_materials; v_export public.multi_lesson_exports; v_cards jsonb; v_deck jsonb;
  v_count integer; v_name text; v_set uuid := gen_random_uuid();
begin
  if p_user_id is null or p_id is null or p_request_id is null then raise exception 'MULTI_LESSON_INVALID_INPUT'; end if;
  if p_name is not null and char_length(btrim(p_name)) > 160 then raise exception 'MULTI_LESSON_INVALID_INPUT'; end if;
  select * into v_export from public.multi_lesson_exports where user_id = p_user_id and request_id = p_request_id;
  if found then
    if v_export.multi_lesson_id <> p_id or v_export.kind <> 'flashcards' then raise exception 'MULTI_LESSON_REQUEST_CONFLICT'; end if;
    return public.multi_lesson_export_view(v_export, true);
  end if;
  select * into v_rec from public.multi_lesson_materials where id = p_id and user_id = p_user_id for update;
  if not found then raise exception 'MULTI_LESSON_NOT_FOUND'; end if;
  if v_rec.status <> 'ready' then raise exception 'MULTI_LESSON_NOT_READY'; end if;
  v_cards := v_rec.result->'flashcards';
  if v_cards is null or jsonb_typeof(v_cards) <> 'array' or jsonb_array_length(v_cards) = 0 then
    raise exception 'MULTI_LESSON_NOTHING_TO_EXPORT';
  end if;
  select * into v_export from public.multi_lesson_exports where multi_lesson_id = p_id and kind = 'flashcards' for update;
  if found and v_export.set_id is not null then return public.multi_lesson_export_view(v_export, true); end if;

  v_count := least(jsonb_array_length(v_cards), 500);
  v_name := left(coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_rec.title), 160);
  v_deck := public.study_create_flashcard_deck_admin(p_user_id, v_set, jsonb_build_object(
    'name', v_name,
    'config', jsonb_build_object('origin', jsonb_build_object('kind', 'multi_lesson', 'multiLessonId', v_rec.id,
      'title', v_rec.title, 'sources', (select jsonb_agg(jsonb_build_object('materialId', s.value->'materialId',
        'title', s.value->'title', 'revision', s.value->'revision') order by s.ordinality)
        from jsonb_array_elements(v_rec.sources) with ordinality s(value, ordinality)))),
    'cards', (select jsonb_agg(jsonb_build_object(
        'front', left(btrim(c.value->>'front'), 1000),
        'back', left(btrim(c.value->>'back'), 2000),
        'noteType', 'basic',
        'fields', jsonb_build_object('front', left(btrim(c.value->>'front'), 1000), 'back', left(btrim(c.value->>'back'), 2000)),
        'evidence', left(c.value#>>'{citations,0,quote}', 1500),
        'sourceSegments', coalesce(c.value->'citations', '[]'::jsonb),
        'originLabel', left(c.value#>>'{citations,0,lessonTitle}', 160))
      order by c.ordinality)
      from jsonb_array_elements(v_cards) with ordinality c(value, ordinality)
      where c.ordinality <= v_count)));

  if v_export.id is null then
    insert into public.multi_lesson_exports(user_id, multi_lesson_id, kind, request_id, set_id, item_count)
    values (p_user_id, p_id, 'flashcards', p_request_id, v_set, greatest((v_deck->>'added')::integer, 1))
    returning * into v_export;
  else
    update public.multi_lesson_exports set request_id = p_request_id, set_id = v_set,
      item_count = greatest((v_deck->>'added')::integer, 1), updated_at = now()
    where id = v_export.id returning * into v_export;
  end if;
  return public.multi_lesson_export_view(v_export, false)
    || jsonb_build_object('skipped', jsonb_array_length(coalesce(v_deck->'skipped', '[]'::jsonb)));
end $$;

revoke all on function public.multi_lesson_export_view(public.multi_lesson_exports, boolean),
  public.multi_lesson_exports_admin(uuid, uuid),
  public.multi_lesson_export_questions_admin(uuid, uuid, uuid, text),
  public.multi_lesson_export_flashcards_admin(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.multi_lesson_export_view(public.multi_lesson_exports, boolean),
  public.multi_lesson_exports_admin(uuid, uuid),
  public.multi_lesson_export_questions_admin(uuid, uuid, uuid, text),
  public.multi_lesson_export_flashcards_admin(uuid, uuid, uuid, text)
  to service_role;
commit;
