-- Notes 3.0 (Milestone A): multi-segment anchors, rich lesson notebooks, private by default.
-- APPROVED BY THE OWNER, NOT APPLIED TO ANY ENVIRONMENT BY THIS REPOSITORY. Deploy after
-- 20261120120000_profile_state_hardening.sql, with backup, database/checks/notes-3-0-preflight.sql
-- and database/checks/notes-3-0-postflight.sql; then enable FEATURE_NOTEBOOKS (requires
-- FEATURE_ANNOTATIONS). Rollback: database/rollback/notes-3-0-rollback.md.
--
-- Additive only: new columns with defaults or nullable, new constraints that existing rows already
-- satisfy, one new table, new functions. Nothing is dropped or replaced: the E14 functions
-- study_save_annotation_admin / study_list_annotations_admin keep working unchanged.
--
-- Data transformation (explicit): every existing highlight is a single-segment anchor
-- (segment_position, start_offset, end_offset). It becomes a range that starts and ends in the same
-- segment: end_segment_position := segment_position. Plain notes (no anchor) stay null.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
begin
  if to_regclass('public.study_annotations') is null
    or to_regprocedure('public.study_save_annotation_admin(uuid,uuid,uuid,integer,uuid,jsonb)') is null
    or to_regclass('public.transcription_versions') is null
    or to_regclass('public.transcription_confirmations') is null then
    raise exception 'NOTES_3_0_ABORT: aplicar e verificar E02 e E14 (20261105014000_annotations.sql) antes desta migration';
  end if;
  if to_regclass('public.study_notebooks') is not null
    or exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'study_annotations' and column_name = 'end_segment_position') then
    raise exception 'NOTES_3_0_ABORT: estruturas ja existem; nao reaplicar';
  end if;
end
$guard$;

-- 1. Multi-segment anchors. Start: (segment_position, start_offset); end: (end_segment_position,
--    end_offset), offsets in code points of the confirmed revision's segments_snapshot texts.
--    anchor_version 1 = created through the E14 API (single segment); 2 = range model (v2 API).
alter table public.study_annotations
  add column end_segment_position integer,
  add column anchor_version smallint not null default 1,
  -- Private by default. Sharing (Milestone E) will attach through a separate share table and relax
  -- this constraint explicitly; nothing here can make a note visible to someone else.
  add column visibility text not null default 'private';
alter table public.study_annotations
  add constraint study_annotations_anchor_version_check check (anchor_version in (1, 2)),
  add constraint study_annotations_visibility_private check (visibility = 'private'),
  add constraint study_annotations_anchor_range_check check (
    end_segment_position is null
    or (segment_position is not null and end_segment_position between segment_position and segment_position + 49));

-- Backfill: existing single-segment highlights become ranges inside their own segment.
update public.study_annotations
  set end_segment_position = segment_position
  where segment_position is not null and end_segment_position is null;

-- Rows still written by the E14 function (flag off, older server) keep the same invariant.
create function public.study_annotations_fill_end_segment()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.end_segment_position is null and new.segment_position is not null then
    new.end_segment_position := new.segment_position;
  end if;
  return new;
end $$;
create trigger study_annotations_fill_end_segment before insert on public.study_annotations
for each row execute function public.study_annotations_fill_end_segment();

-- 2. Saves a note/highlight/comment whose anchor may span several segments (at most 50) of one
--    revision of the material. Anchored notes require a revision the owner confirmed. The quote
--    must equal the snapshot text from the start offset to the end offset, the segments joined
--    with a line break. Same idempotency and version rules as the E14 function.
create function public.study_save_annotation_range_admin(p_user_id uuid, p_id uuid, p_material_id uuid,
  p_version integer, p_request_id uuid, p_body jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.study_annotations; v public.transcription_versions;
  v_quote text; v_start integer; v_end integer; v_from integer; v_to integer;
  v_count integer; v_built text; v_ok boolean;
begin
  if jsonb_typeof(coalesce(p_body, 'null'::jsonb)) <> 'object' then raise exception 'LEARNING_ANCHOR_CONFLICT'; end if;
  perform 1 from public.materials where id = p_material_id and user_id = p_user_id for update;
  if not found then raise exception 'LEARNING_NOT_FOUND'; end if;
  select * into r from public.study_annotations where id = p_id for update;
  if found then
    if r.user_id <> p_user_id or r.material_id <> p_material_id then raise exception 'LEARNING_NOT_FOUND'; end if;
    if r.last_request_id = p_request_id then
      if r.last_body is distinct from p_body then raise exception 'LEARNING_REQUEST_CONFLICT'; end if;
      return to_jsonb(r);
    end if;
    if r.version <> p_version then raise exception 'LEARNING_VERSION_CONFLICT'; end if;
    if p_body ?| array['sourceRevisionId', 'segmentPosition', 'endSegmentPosition', 'startOffset', 'endOffset', 'quote'] then
      raise exception 'LEARNING_ANCHOR_IMMUTABLE';
    end if;
    update public.study_annotations set note_text = coalesce(p_body->>'noteText', note_text), color = coalesce(p_body->>'color', color),
      deleted_at = case when p_body ? 'deleted' then case when (p_body->>'deleted')::boolean then clock_timestamp() else null end else deleted_at end,
      version = version + 1, last_request_id = p_request_id, last_body = p_body, updated_at = clock_timestamp()
      where id = p_id returning * into r;
    return to_jsonb(r);
  end if;
  if p_version <> 0 then raise exception 'LEARNING_VERSION_CONFLICT'; end if;
  select tv.* into v from public.transcription_versions tv join public.transcriptions t on t.id = tv.transcription_id
    where tv.id::text = p_body->>'sourceRevisionId' and t.material_id = p_material_id;
  if not found then raise exception 'LEARNING_NOT_FOUND'; end if;
  v_quote := coalesce(p_body->>'quote', '');
  if v_quote <> '' then
    if not exists (select 1 from public.transcription_confirmations tc
      where tc.material_id = p_material_id and tc.user_id = p_user_id and tc.transcription_version_id = v.id) then
      raise exception 'LEARNING_REVISION_UNCONFIRMED';
    end if;
    v_start := (p_body->>'segmentPosition')::integer;
    v_end := coalesce((p_body->>'endSegmentPosition')::integer, v_start);
    v_from := (p_body->>'startOffset')::integer;
    v_to := (p_body->>'endOffset')::integer;
    if v_start is null or v_from is null or v_to is null or v_start < 0 or v_from < 0 or v_to < 1
      or v_end < v_start or v_end > v_start + 49 then
      raise exception 'LEARNING_ANCHOR_CONFLICT';
    end if;
    select count(*),
      string_agg(case
        when s.pos = v_start and s.pos = v_end then substring(s.txt from v_from + 1 for v_to - v_from)
        when s.pos = v_start then substring(s.txt from v_from + 1)
        when s.pos = v_end then substring(s.txt from 1 for v_to)
        else s.txt end, E'\n' order by s.pos),
      bool_and(case
        when s.pos = v_start and s.pos = v_end then v_to > v_from and v_to <= length(s.txt)
        when s.pos = v_start then v_from < length(s.txt)
        when s.pos = v_end then v_to <= length(s.txt)
        else true end)
      into v_count, v_built, v_ok
      from (select (e->>'position')::integer as pos, coalesce(e->>'text', '') as txt
        from jsonb_array_elements(v.segments_snapshot) e) s
      where s.pos between v_start and v_end;
    if v_count <> v_end - v_start + 1 or not coalesce(v_ok, false) or v_built is distinct from v_quote then
      raise exception 'LEARNING_ANCHOR_CONFLICT';
    end if;
  end if;
  insert into public.study_annotations(id, user_id, material_id, source_revision_id, source_revision, segment_position,
    end_segment_position, start_offset, end_offset, quote, note_text, color, anchor_version, last_request_id, last_body)
  values (p_id, p_user_id, p_material_id, v.id, v.revision, v_start, v_end, v_from, v_to, v_quote,
    coalesce(p_body->>'noteText', ''), coalesce(p_body->>'color', 'yellow'), 2, p_request_id, p_body)
  returning * into r;
  return to_jsonb(r);
end $$;

-- 3. One notebook per lesson per account ("caderno da aula"): a structured document of blocks.
--    The server validates the block schema (backend validator) and, here, its shape, size, block
--    types, the absence of HTML tags and every reference to an annotation (owner, lesson and
--    revision). Text is plain; no HTML is ever stored or rendered.
create table public.study_notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null,
  -- Only lesson notebooks for now; unit/subject/personal scopes are a later, explicit change.
  scope text not null default 'material' constraint study_notebooks_scope_material check (scope = 'material'),
  title text not null default '' check (char_length(title) <= 160),
  doc jsonb not null default '{"type":"doc","schemaVersion":1,"blocks":[]}'::jsonb,
  -- Private by default; see study_annotations.visibility.
  visibility text not null default 'private' constraint study_notebooks_visibility_private check (visibility = 'private'),
  version integer not null default 1 check (version >= 1),
  last_request_id uuid not null,
  last_body_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_notebooks_material_owner_fk foreign key (material_id, user_id)
    references public.materials(id, user_id) on delete cascade,
  constraint study_notebooks_one_per_lesson unique (user_id, material_id),
  constraint study_notebooks_doc_shape check (jsonb_typeof(doc) = 'object' and doc->>'type' = 'doc'
    and jsonb_typeof(doc->'blocks') = 'array'),
  constraint study_notebooks_doc_size check (octet_length(doc::text) <= 256000)
);

-- Notebook of a lesson with the annotations its blocks reference (also soft-deleted ones, whose
-- quote stays readable) and the lesson's current revision, so the interface can say when a
-- reference points to an older revision.
create function public.study_get_notebook_admin(p_user_id uuid, p_material_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_notebook public.study_notebooks; v_revision integer; v_revision_id uuid;
begin
  perform 1 from public.materials where id = p_material_id and user_id = p_user_id;
  if not found then raise exception 'LEARNING_NOT_FOUND'; end if;
  select * into v_notebook from public.study_notebooks where user_id = p_user_id and material_id = p_material_id;
  select t.current_revision, tv.id into v_revision, v_revision_id from public.transcriptions t
    left join public.transcription_versions tv on tv.transcription_id = t.id and tv.revision = t.current_revision
    where t.material_id = p_material_id;
  return jsonb_build_object(
    'notebook', case when v_notebook.id is null then null else to_jsonb(v_notebook) - 'last_body_hash' end,
    'currentRevision', v_revision,
    'currentRevisionId', v_revision_id,
    'references', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'source_revision_id', a.source_revision_id, 'source_revision', a.source_revision,
        'segment_position', a.segment_position, 'end_segment_position', a.end_segment_position,
        'start_offset', a.start_offset, 'end_offset', a.end_offset, 'quote', a.quote,
        'note_text', a.note_text, 'color', a.color, 'deleted', a.deleted_at is not null,
        'start_ms', (select (e->>'startMs')::bigint from public.transcription_versions tv,
          jsonb_array_elements(tv.segments_snapshot) e
          where tv.id = a.source_revision_id and (e->>'position')::integer = a.segment_position limit 1)
      ) order by a.created_at, a.id)
      from public.study_annotations a
      where a.user_id = p_user_id and a.material_id = p_material_id and v_notebook.id is not null
        and a.id::text in (select b->>'annotationId' from jsonb_array_elements(v_notebook.doc->'blocks') b
          where b->>'type' = 'annotation_ref')), '[]'::jsonb));
end $$;

-- Creates (p_version = 0) or replaces the notebook document with optimistic concurrency. A retry
-- with the same request id and the same body returns the saved state; with another body it fails.
create function public.study_save_notebook_admin(p_user_id uuid, p_material_id uuid, p_version integer,
  p_request_id uuid, p_body jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.study_notebooks; v_doc jsonb; v_title text; v_hash text;
begin
  -- Serializes writers of the same lesson (same lock as annotations).
  perform 1 from public.materials where id = p_material_id and user_id = p_user_id for update;
  if not found then raise exception 'LEARNING_NOT_FOUND'; end if;
  if jsonb_typeof(coalesce(p_body, 'null'::jsonb)) <> 'object' then raise exception 'LEARNING_NOTEBOOK_INVALID'; end if;
  v_hash := md5(p_body::text);
  select * into r from public.study_notebooks where user_id = p_user_id and material_id = p_material_id for update;
  if found and r.last_request_id = p_request_id then
    if r.last_body_hash <> v_hash then raise exception 'LEARNING_REQUEST_CONFLICT'; end if;
    return public.study_get_notebook_admin(p_user_id, p_material_id) || jsonb_build_object('replayed', true);
  end if;
  if (found and r.version <> p_version) or (not found and p_version <> 0) then
    raise exception 'LEARNING_VERSION_CONFLICT';
  end if;
  v_doc := p_body->'doc';
  v_title := coalesce(p_body->>'title', '');
  if jsonb_typeof(v_doc) is distinct from 'object' or v_doc->>'type' is distinct from 'doc'
    or jsonb_typeof(v_doc->'blocks') is distinct from 'array' or char_length(v_title) > 160 then
    raise exception 'LEARNING_NOTEBOOK_INVALID';
  end if;
  if octet_length(v_doc::text) > 256000 or jsonb_array_length(v_doc->'blocks') > 300 then
    raise exception 'LEARNING_NOTEBOOK_TOO_LARGE';
  end if;
  if exists (select 1 from jsonb_array_elements(v_doc->'blocks') b where jsonb_typeof(b) <> 'object'
      or coalesce(b->>'type', '') not in ('heading', 'paragraph', 'bullet_list', 'ordered_list', 'checklist', 'quote', 'annotation_ref'))
    -- Defense in depth: no string anywhere may contain an HTML tag opener.
    or jsonb_path_exists(v_doc, '$.** ? (@.type() == "string" && @ like_regex "<[/]?[a-zA-Z!?]")')
    or v_title ~ '<[/]?[a-zA-Z!?]' then
    raise exception 'LEARNING_NOTEBOOK_INVALID';
  end if;
  -- References must point to an annotation of this owner and lesson, on the revision it was made in.
  if exists (select 1 from jsonb_array_elements(v_doc->'blocks') b where b->>'type' = 'annotation_ref'
      and not exists (select 1 from public.study_annotations a where a.user_id = p_user_id
        and a.material_id = p_material_id and a.id::text = b->>'annotationId'
        and a.source_revision_id::text = b->>'sourceRevisionId')) then
    raise exception 'LEARNING_REFERENCE_INVALID';
  end if;
  if r.id is null then
    insert into public.study_notebooks(user_id, material_id, title, doc, last_request_id, last_body_hash)
    values (p_user_id, p_material_id, v_title, v_doc, p_request_id, v_hash);
  else
    update public.study_notebooks set title = v_title, doc = v_doc, version = version + 1,
      last_request_id = p_request_id, last_body_hash = v_hash, updated_at = clock_timestamp()
      where id = r.id;
  end if;
  return public.study_get_notebook_admin(p_user_id, p_material_id) || jsonb_build_object('replayed', false);
end $$;

alter table public.study_notebooks enable row level security;
-- Only effective if a deployment ever grants SELECT to browsers; this migration does not.
create policy study_notebooks_select_own on public.study_notebooks
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on table public.study_notebooks from public, anon, authenticated;
grant select, insert, update, delete on table public.study_notebooks to service_role;
revoke all on function
  public.study_annotations_fill_end_segment(),
  public.study_save_annotation_range_admin(uuid,uuid,uuid,integer,uuid,jsonb),
  public.study_get_notebook_admin(uuid,uuid),
  public.study_save_notebook_admin(uuid,uuid,integer,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function
  public.study_save_annotation_range_admin(uuid,uuid,uuid,integer,uuid,jsonb),
  public.study_get_notebook_admin(uuid,uuid),
  public.study_save_notebook_admin(uuid,uuid,integer,uuid,jsonb)
  to service_role;
commit;
