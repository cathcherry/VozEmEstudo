-- Voz em Estudo 3.4: class contributions (shared integrated materials and reviewed student
-- contributions). MIGRATION CANDIDATE, NOT APPLIED.
-- Apply only with backup, database/checks/classroom-contributions-preflight.sql, explicit
-- approval and the correct environment; then run database/checks/classroom-contributions-postflight.sql.
-- Requires 20261121140000_classrooms.sql and 20261121170000_multi_lesson.sql.
-- See docs/migrations/CLASSROOM_CONTRIBUTIONS.md.
--
-- Additive: one new table, new functions and new triggers. No existing table, column,
-- constraint, function or row is changed. classroom_shared_items keeps its check
-- (item_kind in ('flashcard_set')): widening it would need a drop, so integrated materials live
-- in the new table instead, and the existing functions never see them.
--
-- What it adds:
--   * classroom_contributions: something a member offers the class (a flashcard set or a READY
--     integrated material of their own). Teachers and assistants publish directly ('approved');
--     a student's contribution waits for review ('pending') and the reviewer may leave feedback.
--     An approved flashcard set also gets a classroom_shared_items row, so the existing reading
--     and copying flows keep working unchanged.
--   * functions to contribute, review, withdraw/revoke, list (students: only their own; staff:
--     the class queue) and read shared integrated materials (content only, read only).
--   * triggers that keep contributions in step with the existing tables: leaving or being removed
--     withdraws/revokes the person's contributions; revoking the shared flashcard row revokes the
--     contribution.
--
-- Privacy boundary: members read only the generated content of an approved integrated material
-- (summary sections, questions, flashcards, and the quoted passages with the lesson title). Never
-- the owner's settings, generation report, model, material ids, transcripts, notes or progress.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
declare v_missing text[] := '{}';
begin
  if to_regclass('public.classrooms') is null or to_regclass('public.classroom_members') is null
    or to_regclass('public.classroom_shared_items') is null then
    v_missing := array_append(v_missing, 'tabelas de turmas (20261121140000_classrooms.sql)');
  end if;
  if to_regprocedure('public.classroom_require_admin(uuid,uuid,text)') is null
    or to_regprocedure('public.classroom_member_name(uuid,uuid)') is null then
    v_missing := array_append(v_missing, 'funções de turmas (20261121140000_classrooms.sql)');
  end if;
  if to_regclass('public.multi_lesson_materials') is null then
    v_missing := array_append(v_missing, 'tabela multi_lesson_materials (20261121170000_multi_lesson.sql)');
  end if;
  if to_regclass('public.study_flashcard_sets') is null then
    v_missing := array_append(v_missing, 'tabela study_flashcard_sets (20261119121000_flashcard_sets.sql)');
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    v_missing := array_append(v_missing, 'função set_updated_at (001_initial)');
  end if;
  if cardinality(v_missing) > 0 then
    raise exception 'CLASSROOM_CONTRIBUTIONS_ABORT: faltam pré-requisitos: %', array_to_string(v_missing, '; ');
  end if;
  if to_regclass('public.classroom_contributions') is not null then
    raise exception 'CLASSROOM_CONTRIBUTIONS_ABORT: estruturas de contribuições ja existem; nao reaplicar';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------------------------
create table public.classroom_contributions (
  id uuid primary key,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  item_kind text not null check (item_kind in ('flashcard_set', 'integrated_material')),
  flashcard_set_id uuid references public.study_flashcard_sets(id) on delete cascade,
  integrated_material_id uuid references public.multi_lesson_materials(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'revoked')),
  -- The contributor's message to the reviewer, and the reviewer's feedback (the owner sees both).
  note text check (note is null or char_length(note) <= 1000),
  feedback text check (feedback is null or char_length(feedback) <= 1000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_role text check (reviewed_role is null or reviewed_role in ('teacher', 'assistant')),
  reviewed_at timestamptz,
  -- For an approved flashcard set: the row that makes it visible to the existing flows.
  shared_item_id uuid references public.classroom_shared_items(id) on delete set null,
  ended_at timestamptz,
  ended_by uuid references auth.users(id) on delete set null,
  last_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint classroom_contributions_ref check (
    (item_kind = 'flashcard_set' and flashcard_set_id is not null and integrated_material_id is null)
    or (item_kind = 'integrated_material' and integrated_material_id is not null and flashcard_set_id is null))
);
-- One open (pending or approved) contribution per item and class.
create unique index classroom_contributions_one_open_set on public.classroom_contributions(classroom_id, flashcard_set_id)
  where status in ('pending', 'approved') and flashcard_set_id is not null;
create unique index classroom_contributions_one_open_material on public.classroom_contributions(classroom_id, integrated_material_id)
  where status in ('pending', 'approved') and integrated_material_id is not null;
create index classroom_contributions_class_idx on public.classroom_contributions(classroom_id, status, created_at desc);
create index classroom_contributions_owner_idx on public.classroom_contributions(owner_id, created_at desc);
create index classroom_contributions_shared_idx on public.classroom_contributions(shared_item_id)
  where shared_item_id is not null;
create trigger classroom_contributions_set_updated_at before update on public.classroom_contributions
for each row execute function public.set_updated_at();

-- Status graph, enforced for every write whatever the caller:
--   pending  -> approved | rejected | withdrawn
--   approved -> revoked
--   rejected, withdrawn and revoked are final.
-- A new row starts 'pending' (student) or 'approved' (teacher or assistant, published directly).
create function public.classroom_contributions_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('pending', 'approved') then raise exception 'CLASSROOM_ILLEGAL_TRANSITION'; end if;
  elsif new.status is distinct from old.status and not (
      (old.status = 'pending' and new.status in ('approved', 'rejected', 'withdrawn'))
      or (old.status = 'approved' and new.status = 'revoked')) then
    raise exception 'CLASSROOM_ILLEGAL_TRANSITION';
  elsif new.owner_id is distinct from old.owner_id or new.classroom_id is distinct from old.classroom_id
      or new.item_kind is distinct from old.item_kind or new.flashcard_set_id is distinct from old.flashcard_set_id
      or new.integrated_material_id is distinct from old.integrated_material_id then
    raise exception 'CLASSROOM_ILLEGAL_TRANSITION';
  end if;
  return new;
end $$;
create trigger classroom_contributions_guard before insert or update on public.classroom_contributions
for each row execute function public.classroom_contributions_guard();

-- Leaving or being removed ends what the person offered the class, at once: pending ones are
-- withdrawn and approved ones revoked (a later re-join does not bring them back).
create function public.classroom_contributions_end_membership()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.status = 'active' and new.status <> 'active' then
    update public.classroom_contributions set
        status = case when status = 'pending' then 'withdrawn' else 'revoked' end,
        ended_at = clock_timestamp(), ended_by = new.ended_by
      where classroom_id = new.classroom_id and owner_id = new.user_id and status in ('pending', 'approved');
  end if;
  return null;
end $$;
create trigger classroom_members_end_contributions after update of status on public.classroom_members
for each row execute function public.classroom_contributions_end_membership();

-- Revoking the shared flashcard row through the existing function also revokes the contribution.
create function public.classroom_contributions_follow_shared_item()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    update public.classroom_contributions set status = 'revoked', ended_at = new.revoked_at, ended_by = new.revoked_by
      where shared_item_id = new.id and status = 'approved';
  end if;
  return null;
end $$;
create trigger classroom_shared_items_follow_contributions after update of revoked_at on public.classroom_shared_items
for each row execute function public.classroom_contributions_follow_shared_item();

-- ---------------------------------------------------------------------------------------------
-- Rows and content
-- ---------------------------------------------------------------------------------------------
-- Passages quoted by an integrated material, reduced to what a member may read: the lesson title,
-- the passage number and the quote. Never the owner's material or revision ids.
create function public.classroom_integrated_citations(p_list jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_list) = 'array' then coalesce((select jsonb_agg(jsonb_build_object(
      'lessonTitle', c->'lessonTitle', 'position', c->'position', 'quote', c->'quote') order by n)
    from jsonb_array_elements(p_list) with ordinality x(c, n) where jsonb_typeof(c) = 'object'), '[]'::jsonb)
  else '[]'::jsonb end
$$;

-- The generated content only, rebuilt field by field (an allowlist, not a filter): no report,
-- prompt versions, model, settings or lesson ids.
create function public.classroom_integrated_content(p_result jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'summary', case when jsonb_typeof(p_result->'summary'->'sections') = 'array' then jsonb_build_object('sections',
      coalesce((select jsonb_agg(jsonb_build_object('heading', s->'heading', 'text', s->'text',
          'citations', public.classroom_integrated_citations(s->'citations')) order by n)
        from jsonb_array_elements(p_result->'summary'->'sections') with ordinality x(s, n)
        where jsonb_typeof(s) = 'object'), '[]'::jsonb)) end,
    'questions', case when jsonb_typeof(p_result->'questions') = 'array' then
      coalesce((select jsonb_agg(jsonb_build_object('statement', q->'statement', 'options', q->'options',
          'correctIndex', q->'correctIndex', 'explanation', q->'explanation',
          'citations', public.classroom_integrated_citations(q->'citations')) order by n)
        from jsonb_array_elements(p_result->'questions') with ordinality x(q, n)
        where jsonb_typeof(q) = 'object'), '[]'::jsonb) end,
    'flashcards', case when jsonb_typeof(p_result->'flashcards') = 'array' then
      coalesce((select jsonb_agg(jsonb_build_object('front', f->'front', 'back', f->'back',
          'citations', public.classroom_integrated_citations(f->'citations')) order by n)
        from jsonb_array_elements(p_result->'flashcards') with ordinality x(f, n)
        where jsonb_typeof(f) = 'object'), '[]'::jsonb) end))
$$;

-- Titles and revision numbers of the frozen sources (what the class is told it was made from).
create function public.classroom_integrated_sources(p_sources jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_sources) = 'array' then coalesce((select jsonb_agg(jsonb_build_object(
      'title', s->'title', 'revision', s->'revision') order by n)
    from jsonb_array_elements(p_sources) with ordinality x(s, n) where jsonb_typeof(s) = 'object'), '[]'::jsonb)
  else '[]'::jsonb end
$$;

-- A contribution as one viewer sees it. The private item id is only returned to its owner.
create function public.classroom_contribution_row(p_item public.classroom_contributions, p_viewer uuid, p_viewer_role text)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p_item.id, 'classroomId', p_item.classroom_id, 'kind', p_item.item_kind,
    'itemId', case when p_item.owner_id = p_viewer then coalesce(p_item.flashcard_set_id, p_item.integrated_material_id) end,
    'title', case when p_item.item_kind = 'flashcard_set'
      then (select s.name from public.study_flashcard_sets s where s.id = p_item.flashcard_set_id)
      else (select m.title from public.multi_lesson_materials m where m.id = p_item.integrated_material_id) end,
    'cardCount', case when p_item.item_kind = 'flashcard_set' then (select count(*) from public.study_flashcards f
      where f.set_id = p_item.flashcard_set_id and f.status = 'active') end,
    'outputs', case when p_item.item_kind = 'integrated_material' then (select to_jsonb(m.outputs)
      from public.multi_lesson_materials m where m.id = p_item.integrated_material_id) end,
    'status', p_item.status, 'note', p_item.note, 'feedback', p_item.feedback,
    'reviewedRole', p_item.reviewed_role, 'reviewedAt', p_item.reviewed_at,
    'sharedId', case when p_item.status = 'approved' then p_item.shared_item_id end,
    'createdAt', p_item.created_at, 'updatedAt', p_item.updated_at, 'endedAt', p_item.ended_at,
    'isMine', p_item.owner_id = p_viewer,
    'author', jsonb_build_object('userId', p_item.owner_id,
      'displayName', public.classroom_member_name(p_item.classroom_id, p_item.owner_id)),
    'actions', to_jsonb(array_remove(array[
      case when p_item.status = 'pending' and p_viewer_role in ('teacher', 'assistant') and p_item.owner_id <> p_viewer
        then 'approve' end,
      case when p_item.status = 'pending' and p_viewer_role in ('teacher', 'assistant') and p_item.owner_id <> p_viewer
        then 'reject' end,
      case when p_item.status = 'pending' and p_item.owner_id = p_viewer then 'withdraw' end,
      case when p_item.status = 'approved' and (p_item.owner_id = p_viewer or p_viewer_role in ('teacher', 'assistant'))
        then 'revoke' end], null)))
$$;

-- ---------------------------------------------------------------------------------------------
-- Contribute, review, end
-- ---------------------------------------------------------------------------------------------
-- Any active member offers one of their own items: an active flashcard set or a READY integrated
-- material. Teachers and assistants publish directly; a student's contribution waits for review.
-- A retry with the same id returns the same contribution.
create function public.classroom_contribute_admin(p_user_id uuid, p_classroom_id uuid, p_id uuid, p_kind text,
  p_item_id uuid, p_note text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_role text; v_item public.classroom_contributions; v_status text; v_shared uuid;
begin
  v_role := public.classroom_require_admin(p_user_id, p_classroom_id, 'participate');
  select * into v_item from public.classroom_contributions where id = p_id;
  if found then
    if v_item.owner_id <> p_user_id or v_item.classroom_id <> p_classroom_id or v_item.item_kind is distinct from p_kind
        or coalesce(v_item.flashcard_set_id, v_item.integrated_material_id) is distinct from p_item_id then
      raise exception 'CLASSROOM_REQUEST_CONFLICT';
    end if;
    return public.classroom_contribution_row(v_item, p_user_id, v_role) || jsonb_build_object('replayed', true);
  end if;
  if p_kind is null or p_kind not in ('flashcard_set', 'integrated_material') or p_item_id is null
      or char_length(coalesce(p_note, '')) > 1000 then
    raise exception 'CLASSROOM_INVALID_INPUT';
  end if;
  if p_kind = 'flashcard_set' then
    if not exists (select 1 from public.study_flashcard_sets where id = p_item_id and user_id = p_user_id and status = 'active') then
      raise exception 'FLASHCARD_NOT_FOUND';
    end if;
    if exists (select 1 from public.classroom_shared_items where classroom_id = p_classroom_id
        and flashcard_set_id = p_item_id and revoked_at is null)
      or exists (select 1 from public.classroom_contributions where classroom_id = p_classroom_id
        and flashcard_set_id = p_item_id and status in ('pending', 'approved')) then
      raise exception 'CLASSROOM_ALREADY_SHARED';
    end if;
  else
    perform 1 from public.multi_lesson_materials where id = p_item_id and user_id = p_user_id;
    if not found then raise exception 'MULTI_LESSON_NOT_FOUND'; end if;
    if not exists (select 1 from public.multi_lesson_materials where id = p_item_id and status = 'ready' and result is not null) then
      raise exception 'CLASSROOM_ITEM_NOT_READY';
    end if;
    if exists (select 1 from public.classroom_contributions where classroom_id = p_classroom_id
        and integrated_material_id = p_item_id and status in ('pending', 'approved')) then
      raise exception 'CLASSROOM_ALREADY_SHARED';
    end if;
  end if;
  if (select count(*) from public.classroom_contributions where classroom_id = p_classroom_id
      and owner_id = p_user_id and status in ('pending', 'approved')) >= 200 then
    raise exception 'CLASSROOM_LIMIT';
  end if;
  v_status := case when v_role in ('teacher', 'assistant') then 'approved' else 'pending' end;
  if v_status = 'approved' and p_kind = 'flashcard_set' then
    v_shared := gen_random_uuid();
    insert into public.classroom_shared_items(id, classroom_id, owner_id, item_kind, flashcard_set_id)
      values (v_shared, p_classroom_id, p_user_id, 'flashcard_set', p_item_id);
  end if;
  insert into public.classroom_contributions(id, classroom_id, owner_id, item_kind, flashcard_set_id,
      integrated_material_id, status, note, shared_item_id, reviewed_at, reviewed_by, reviewed_role)
    values (p_id, p_classroom_id, p_user_id, p_kind,
      case when p_kind = 'flashcard_set' then p_item_id end,
      case when p_kind = 'integrated_material' then p_item_id end,
      v_status, nullif(btrim(coalesce(p_note, '')), ''), v_shared,
      case when v_status = 'approved' then clock_timestamp() end,
      case when v_status = 'approved' then p_user_id end,
      case when v_status = 'approved' then v_role end)
    returning * into v_item;
  return public.classroom_contribution_row(v_item, p_user_id, v_role) || jsonb_build_object('replayed', false);
end $$;

-- Teacher or assistant approves or rejects a pending contribution, with optional feedback the
-- contributor reads. Idempotent per request id. Nobody reviews their own contribution.
create function public.classroom_review_contribution_admin(p_user_id uuid, p_classroom_id uuid, p_contribution_id uuid,
  p_decision text, p_request_id uuid, p_feedback text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_role text; v_item public.classroom_contributions; v_shared uuid;
begin
  v_role := public.classroom_require_admin(p_user_id, p_classroom_id, 'manage');
  if p_decision is null or p_decision not in ('approved', 'rejected') or char_length(coalesce(p_feedback, '')) > 1000 then
    raise exception 'CLASSROOM_INVALID_INPUT';
  end if;
  select * into v_item from public.classroom_contributions where id = p_contribution_id
    and classroom_id = p_classroom_id for update;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if p_request_id is not null and v_item.last_request_id = p_request_id and v_item.status = p_decision then
    return public.classroom_contribution_row(v_item, p_user_id, v_role) || jsonb_build_object('replayed', true);
  end if;
  if v_item.status <> 'pending' then raise exception 'CLASSROOM_ILLEGAL_TRANSITION'; end if;
  if v_item.owner_id = p_user_id then raise exception 'CLASSROOM_FORBIDDEN'; end if;
  if p_decision = 'approved' then
    -- The item must still be there and still the owner's when it becomes visible.
    if v_item.item_kind = 'flashcard_set' then
      if not exists (select 1 from public.study_flashcard_sets where id = v_item.flashcard_set_id
          and user_id = v_item.owner_id and status = 'active') then
        raise exception 'CLASSROOM_ITEM_UNAVAILABLE';
      end if;
      if exists (select 1 from public.classroom_shared_items where classroom_id = p_classroom_id
          and flashcard_set_id = v_item.flashcard_set_id and revoked_at is null) then
        raise exception 'CLASSROOM_ALREADY_SHARED';
      end if;
      v_shared := gen_random_uuid();
      insert into public.classroom_shared_items(id, classroom_id, owner_id, item_kind, flashcard_set_id, shared_at)
        values (v_shared, p_classroom_id, v_item.owner_id, 'flashcard_set', v_item.flashcard_set_id, clock_timestamp());
    elsif not exists (select 1 from public.multi_lesson_materials where id = v_item.integrated_material_id
        and user_id = v_item.owner_id and status = 'ready' and result is not null) then
      raise exception 'CLASSROOM_ITEM_UNAVAILABLE';
    end if;
  end if;
  update public.classroom_contributions set status = p_decision, feedback = nullif(btrim(coalesce(p_feedback, '')), ''),
      reviewed_by = p_user_id, reviewed_role = v_role, reviewed_at = clock_timestamp(),
      shared_item_id = coalesce(v_shared, shared_item_id), last_request_id = p_request_id
    where id = v_item.id returning * into v_item;
  return public.classroom_contribution_row(v_item, p_user_id, v_role) || jsonb_build_object('replayed', false);
end $$;

-- The owner withdraws a pending contribution or stops sharing an approved one; a teacher or
-- assistant may also hide an approved one from the class. Works in archived classes too.
-- Access ends at once; ending twice is a no-op.
create function public.classroom_end_contribution_admin(p_user_id uuid, p_classroom_id uuid, p_contribution_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_role text; v_item public.classroom_contributions;
begin
  v_role := public.classroom_require_admin(p_user_id, p_classroom_id, 'leave');
  select * into v_item from public.classroom_contributions where id = p_contribution_id
    and classroom_id = p_classroom_id for update;
  if not found or (v_item.owner_id <> p_user_id and v_role not in ('teacher', 'assistant')) then
    raise exception 'CLASSROOM_NOT_FOUND';
  end if;
  if v_item.status in ('rejected', 'withdrawn', 'revoked') then
    return public.classroom_contribution_row(v_item, p_user_id, v_role);
  end if;
  -- Only the owner withdraws a pending one; the reviewer rejects it instead.
  if v_item.status = 'pending' and v_item.owner_id <> p_user_id then raise exception 'CLASSROOM_FORBIDDEN'; end if;
  update public.classroom_contributions set
      status = case when status = 'pending' then 'withdrawn' else 'revoked' end,
      ended_at = clock_timestamp(), ended_by = p_user_id
    where id = v_item.id returning * into v_item;
  if v_item.shared_item_id is not null then
    update public.classroom_shared_items set revoked_at = coalesce(revoked_at, clock_timestamp()),
      revoked_by = coalesce(revoked_by, p_user_id) where id = v_item.shared_item_id;
  end if;
  return public.classroom_contribution_row(v_item, p_user_id, v_role);
end $$;

-- Students see only their own contributions; teachers and assistants see the class queue
-- (pending first, then the most recent decisions).
create function public.classroom_list_contributions_admin(p_user_id uuid, p_classroom_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_role text;
begin
  v_role := public.classroom_require_admin(p_user_id, p_classroom_id, 'read');
  return coalesce((select jsonb_agg(public.classroom_contribution_row(c, p_user_id, v_role)
      order by (c.status = 'pending') desc, c.updated_at desc, c.id)
    from (select * from public.classroom_contributions x where x.classroom_id = p_classroom_id
      and (v_role in ('teacher', 'assistant') or x.owner_id = p_user_id)
      order by (x.status = 'pending') desc, x.updated_at desc limit 300) c), '[]'::jsonb);
end $$;

-- One contribution with a read-only preview of its content, for its owner and the class
-- managers (what the reviewer checks before approving). Content fields only: card front and
-- back, or the generated integrated content; never schedules, review history or settings.
create function public.classroom_get_contribution_admin(p_user_id uuid, p_classroom_id uuid, p_contribution_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_role text; v_item public.classroom_contributions;
begin
  v_role := public.classroom_require_admin(p_user_id, p_classroom_id, 'read');
  select * into v_item from public.classroom_contributions where id = p_contribution_id and classroom_id = p_classroom_id;
  if not found or (v_item.owner_id <> p_user_id and v_role not in ('teacher', 'assistant')) then
    raise exception 'CLASSROOM_NOT_FOUND';
  end if;
  return public.classroom_contribution_row(v_item, p_user_id, v_role) || jsonb_build_object('preview',
    case when v_item.status not in ('pending', 'approved') then null
      when v_item.item_kind = 'flashcard_set' then jsonb_build_object('cards', coalesce((select jsonb_agg(
          jsonb_build_object('front', f.front_text, 'back', f.back_text) order by f.created_at, f.id)
        from public.study_flashcards f join public.study_flashcard_sets s on s.id = f.set_id
          and s.user_id = v_item.owner_id and s.status = 'active'
        where f.set_id = v_item.flashcard_set_id and f.status = 'active'), '[]'::jsonb))
      else (select jsonb_build_object('sources', public.classroom_integrated_sources(r.sources),
          'content', public.classroom_integrated_content(r.result))
        from public.multi_lesson_materials r where r.id = v_item.integrated_material_id
          and r.user_id = v_item.owner_id and r.status = 'ready' and r.result is not null) end);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Shared integrated materials (read only for members)
-- ---------------------------------------------------------------------------------------------
-- Visible = approved, the record still READY and its author still an active member.
create function public.classroom_list_integrated_materials_admin(p_user_id uuid, p_classroom_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'read');
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', r.title, 'outputs', to_jsonb(r.outputs),
      'sourceCount', jsonb_array_length(r.sources), 'sharedAt', coalesce(c.reviewed_at, c.created_at),
      'isMine', c.owner_id = p_user_id,
      'author', jsonb_build_object('userId', c.owner_id,
        'displayName', public.classroom_member_name(c.classroom_id, c.owner_id)))
      order by coalesce(c.reviewed_at, c.created_at) desc, c.id)
    from public.classroom_contributions c
    join public.multi_lesson_materials r on r.id = c.integrated_material_id and r.user_id = c.owner_id
      and r.status = 'ready' and r.result is not null
    join public.classroom_members m on m.classroom_id = c.classroom_id and m.user_id = c.owner_id and m.status = 'active'
    where c.classroom_id = p_classroom_id and c.item_kind = 'integrated_material' and c.status = 'approved'), '[]'::jsonb);
end $$;

-- One shared integrated material: title, source titles and the generated content only.
-- (A pending one is previewed by its owner and the reviewers with classroom_get_contribution_admin.)
create function public.classroom_get_integrated_material_admin(p_user_id uuid, p_classroom_id uuid, p_contribution_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_item public.classroom_contributions; v_rec public.multi_lesson_materials;
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'read');
  select c.* into v_item from public.classroom_contributions c
    join public.classroom_members m on m.classroom_id = c.classroom_id and m.user_id = c.owner_id and m.status = 'active'
    where c.id = p_contribution_id and c.classroom_id = p_classroom_id and c.item_kind = 'integrated_material'
      and c.status = 'approved';
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  select * into v_rec from public.multi_lesson_materials where id = v_item.integrated_material_id
    and user_id = v_item.owner_id and status = 'ready' and result is not null;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  return jsonb_build_object('id', v_item.id, 'classroomId', v_item.classroom_id, 'status', v_item.status,
    'title', v_rec.title, 'outputs', to_jsonb(v_rec.outputs), 'sources', public.classroom_integrated_sources(v_rec.sources),
    'sharedAt', coalesce(v_item.reviewed_at, v_item.created_at), 'isMine', v_item.owner_id = p_user_id,
    'author', jsonb_build_object('userId', v_item.owner_id,
      'displayName', public.classroom_member_name(v_item.classroom_id, v_item.owner_id)),
    'content', public.classroom_integrated_content(v_rec.result));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: RLS on, no policy for the browser roles (deny all), server-only functions.
-- ---------------------------------------------------------------------------------------------
alter table public.classroom_contributions enable row level security;
revoke all on table public.classroom_contributions from public, anon, authenticated;
grant select, insert, update, delete on table public.classroom_contributions to service_role;

do $privileges$
declare v_fn regprocedure;
begin
  for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('classroom_contributions_guard',
        'classroom_contributions_end_membership', 'classroom_contributions_follow_shared_item',
        'classroom_integrated_citations', 'classroom_integrated_content', 'classroom_integrated_sources',
        'classroom_contribution_row', 'classroom_contribute_admin', 'classroom_review_contribution_admin',
        'classroom_end_contribution_admin', 'classroom_list_contributions_admin', 'classroom_get_contribution_admin',
        'classroom_list_integrated_materials_admin', 'classroom_get_integrated_material_admin') loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end
$privileges$;
commit;
