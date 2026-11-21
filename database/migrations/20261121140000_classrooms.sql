-- Milestone E: private classrooms (foundations). MIGRATION CANDIDATE, NOT APPLIED.
-- Apply only with backup, database/checks/classrooms-preflight.sql, explicit approval and the
-- correct environment; then run database/checks/classrooms-postflight.sql and enable
-- FEATURE_CLASSROOMS. Requires E02, E05/authoring (20261119120000), E13 and Flashcards 2.0
-- (20261119121000). See docs/migrations/CLASSROOMS.md.
--
-- Additive: new tables and new functions only. No existing table, column, function or row is
-- changed. Everything is private to class members and reached only through the server
-- (service_role); the browser roles have no access to any new table or function.
--
-- Privacy boundary: no function here reads study progress, review history, annotations, quiz
-- attempts or study sessions. Members read only what an owner explicitly published or shared.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
declare v_missing text[] := '{}';
begin
  if to_regclass('public.materials') is null then v_missing := array_append(v_missing, 'tabela materials (001_initial)'); end if;
  if to_regclass('public.transcription_versions') is null then v_missing := array_append(v_missing, 'tabela transcription_versions (001_initial)'); end if;
  if to_regclass('public.transcription_confirmations') is null then v_missing := array_append(v_missing, 'tabela transcription_confirmations (E02)'); end if;
  if to_regprocedure('public.require_material_permission_admin(uuid,uuid,text)') is null then
    v_missing := array_append(v_missing, 'função require_material_permission_admin (E02)');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'question_batches' and column_name = 'title') then
    v_missing := array_append(v_missing, 'coluna question_batches.title (20261119120000_study_authoring.sql)');
  end if;
  if to_regclass('public.study_flashcards') is null then v_missing := array_append(v_missing, 'tabela study_flashcards (E13)'); end if;
  if to_regclass('public.study_flashcard_sets') is null then
    v_missing := array_append(v_missing, 'tabela study_flashcard_sets (20261119121000_flashcard_sets.sql)');
  end if;
  if to_regprocedure('public.set_updated_at()') is null then v_missing := array_append(v_missing, 'função set_updated_at (001_initial)'); end if;
  if cardinality(v_missing) > 0 then
    raise exception 'CLASSROOMS_ABORT: faltam pré-requisitos: %', array_to_string(v_missing, '; ');
  end if;
  if to_regclass('public.classrooms') is not null or to_regclass('public.classroom_members') is not null then
    raise exception 'CLASSROOMS_ABORT: estruturas de turmas ja existem; nao reaplicar';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.classrooms (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index classrooms_owner_idx on public.classrooms(owner_id, created_at desc);
create trigger classrooms_set_updated_at before update on public.classrooms
for each row execute function public.set_updated_at();

-- One row per account and class. The owner is the only 'teacher'. Leaving or removal keeps the
-- row (status) so a removal can be told apart from a voluntary exit; access ends at once.
create table public.classroom_members (
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('teacher', 'assistant', 'student')),
  status text not null default 'active' check (status in ('active', 'left', 'removed')),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  invite_id uuid,
  joined_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (classroom_id, user_id)
);
create index classroom_members_user_idx on public.classroom_members(user_id, status);
create unique index classroom_members_one_teacher on public.classroom_members(classroom_id) where role = 'teacher';
create trigger classroom_members_set_updated_at before update on public.classroom_members
for each row execute function public.set_updated_at();

-- Invitations: only the SHA-256 of the code is stored. use_count can never exceed max_uses
-- (checked by the join function under a row lock and by this constraint as a backstop).
create table public.classroom_invites (
  id uuid primary key,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  max_uses integer not null check (max_uses between 1 and 500),
  use_count integer not null default 0,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint classroom_invites_use_count_range check (use_count between 0 and max_uses),
  unique (created_by, request_id)
);
create index classroom_invites_class_idx on public.classroom_invites(classroom_id, created_at desc);

-- Student recordings awaiting approval. The status graph is enforced by a trigger below.
create table public.classroom_submissions (
  id uuid primary key,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'submitted' check (status in ('submitted', 'approved_for_processing',
    'processing', 'transcription_confirmed', 'published', 'rejected', 'withdrawn')),
  note text check (note is null or char_length(note) <= 1000),
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  -- The teacher's review of the transcript: separate from the student's own confirmation
  -- (transcription_confirmations), which is still required and is never written here.
  teacher_confirmed_revision_id uuid references public.transcription_versions(id) on delete set null,
  teacher_confirmed_by uuid references auth.users(id) on delete set null,
  teacher_confirmed_at timestamptz,
  lesson_id uuid,
  last_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index classroom_submissions_one_open on public.classroom_submissions(classroom_id, material_id)
  where status not in ('rejected', 'withdrawn');
create index classroom_submissions_class_idx on public.classroom_submissions(classroom_id, status, created_at desc);
create index classroom_submissions_student_idx on public.classroom_submissions(student_id, created_at desc);
create trigger classroom_submissions_set_updated_at before update on public.classroom_submissions
for each row execute function public.set_updated_at();

create table public.classroom_submission_events (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.classroom_submissions(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text check (actor_role is null or actor_role in ('teacher', 'assistant', 'student', 'system')),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index classroom_submission_events_idx on public.classroom_submission_events(submission_id, id);

-- Published lessons: a pinned, immutable transcript revision of the owner's material, plus the
-- summary and question lists chosen at publication. Members read them through functions only;
-- publication never grants any access to the material itself.
create table public.classroom_lessons (
  id uuid primary key,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  published_by uuid references auth.users(id) on delete set null,
  published_revision_id uuid not null references public.transcription_versions(id) on delete cascade,
  summary_id uuid references public.summary_versions(id) on delete set null,
  question_batch_ids uuid[] not null default '{}' check (cardinality(question_batch_ids) <= 10),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  source text not null check (source in ('teacher', 'submission')),
  submission_id uuid references public.classroom_submissions(id) on delete set null,
  status text not null default 'published' check (status in ('published', 'unpublished')),
  published_at timestamptz not null default now(),
  unpublished_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index classroom_lessons_one_published on public.classroom_lessons(classroom_id, material_id)
  where status = 'published';
create index classroom_lessons_class_idx on public.classroom_lessons(classroom_id, status, published_at desc);
alter table public.classroom_submissions
  add constraint classroom_submissions_lesson_fk foreign key (lesson_id)
  references public.classroom_lessons(id) on delete set null;

-- Items a member explicitly shares with the class (today: flashcard sets). Revoking hides them.
create table public.classroom_shared_items (
  id uuid primary key,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  item_kind text not null check (item_kind in ('flashcard_set')),
  flashcard_set_id uuid references public.study_flashcard_sets(id) on delete cascade,
  shared_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  constraint classroom_shared_items_ref check (item_kind <> 'flashcard_set' or flashcard_set_id is not null)
);
create unique index classroom_shared_items_one_active on public.classroom_shared_items(classroom_id, flashcard_set_id)
  where revoked_at is null;
create index classroom_shared_items_class_idx on public.classroom_shared_items(classroom_id, shared_at desc)
  where revoked_at is null;
create index classroom_shared_items_owner_idx on public.classroom_shared_items(owner_id);

-- Teacher resources: links with a title (no files, no public pages).
create table public.classroom_resources (
  id uuid primary key,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  url text not null check (url ~ '^https://[^[:space:]]+$' and char_length(url) <= 2048),
  description text check (description is null or char_length(description) <= 1000),
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create index classroom_resources_class_idx on public.classroom_resources(classroom_id, created_at desc)
  where removed_at is null;

-- ---------------------------------------------------------------------------------------------
-- Submission state machine
-- ---------------------------------------------------------------------------------------------
-- Who may move a submission from one status to another: 'manager' (teacher or assistant),
-- 'owner' (the student who submitted) or null (not allowed).
create function public.classroom_submission_transition_actor(p_from text, p_to text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_from = 'submitted' and p_to in ('approved_for_processing', 'rejected') then 'manager'
    when p_from = 'approved_for_processing' and p_to = 'processing' then 'owner'
    when p_from = 'approved_for_processing' and p_to = 'rejected' then 'manager'
    when p_from = 'processing' and p_to in ('transcription_confirmed', 'rejected') then 'manager'
    when p_from = 'transcription_confirmed' and p_to in ('published', 'rejected') then 'manager'
    when p_from = 'published' and p_to = 'transcription_confirmed' then 'manager'
    when p_from in ('submitted', 'approved_for_processing', 'processing', 'transcription_confirmed', 'published')
      and p_to = 'withdrawn' then 'owner'
    else null
  end
$$;

-- Enforced for every write, whatever the caller: a new submission starts as 'submitted' and a
-- status change must follow the graph above.
create function public.classroom_submissions_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'submitted' then raise exception 'CLASSROOM_ILLEGAL_TRANSITION'; end if;
  elsif new.status is distinct from old.status
    and public.classroom_submission_transition_actor(old.status, new.status) is null then
    raise exception 'CLASSROOM_ILLEGAL_TRANSITION';
  end if;
  return new;
end $$;
create trigger classroom_submissions_guard before insert or update on public.classroom_submissions
for each row execute function public.classroom_submissions_guard();

-- ---------------------------------------------------------------------------------------------
-- Central permission check, used by every classroom function.
-- Actions: read (any active member), leave (any active member, also in archived classes),
-- participate (any active member, active class), submit (student, active class),
-- manage (teacher or assistant, active class), own (teacher, also in archived classes).
-- Non-members, ex-members and unknown classes all get CLASSROOM_NOT_FOUND (no existence oracle).
-- ---------------------------------------------------------------------------------------------
create function public.classroom_require_admin(p_user_id uuid, p_classroom_id uuid, p_action text)
returns text language plpgsql stable security invoker set search_path = '' as $$
declare v_role text; v_class_status text;
begin
  if p_action is null or p_action not in ('read', 'leave', 'participate', 'submit', 'manage', 'own') then
    raise exception 'CLASSROOM_INVALID_INPUT';
  end if;
  select m.role, c.status into v_role, v_class_status
    from public.classroom_members m join public.classrooms c on c.id = m.classroom_id
    where m.classroom_id = p_classroom_id and m.user_id = p_user_id and m.status = 'active';
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if v_class_status = 'archived' and p_action in ('participate', 'submit', 'manage') then
    raise exception 'CLASSROOM_ARCHIVED';
  end if;
  if (p_action = 'manage' and v_role not in ('teacher', 'assistant'))
    or (p_action = 'own' and v_role <> 'teacher')
    or (p_action = 'submit' and v_role <> 'student') then
    raise exception 'CLASSROOM_FORBIDDEN';
  end if;
  return v_role;
end $$;

-- Display name of a member in a class (as they chose to appear there).
create function public.classroom_member_name(p_classroom_id uuid, p_user_id uuid)
returns text language sql stable set search_path = '' as $$
  select display_name from public.classroom_members where classroom_id = p_classroom_id and user_id = p_user_id
$$;

-- What a member stops sharing when they leave or are removed: shared items are revoked, open
-- submissions are withdrawn and their published lessons are unpublished.
create function public.classroom_end_member_content(p_classroom_id uuid, p_member_id uuid, p_actor_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_sub public.classroom_submissions;
begin
  update public.classroom_shared_items set revoked_at = clock_timestamp(), revoked_by = p_actor_id
    where classroom_id = p_classroom_id and owner_id = p_member_id and revoked_at is null;
  for v_sub in select * from public.classroom_submissions where classroom_id = p_classroom_id
      and student_id = p_member_id and status not in ('rejected', 'withdrawn') for update loop
    update public.classroom_submissions set status = 'withdrawn' where id = v_sub.id;
    insert into public.classroom_submission_events(submission_id, from_status, to_status, actor_id, actor_role, note)
      values (v_sub.id, v_sub.status, 'withdrawn', p_actor_id, 'system', 'membership_ended');
  end loop;
  update public.classroom_lessons set status = 'unpublished', unpublished_at = clock_timestamp()
    where classroom_id = p_classroom_id and owner_id = p_member_id and status = 'published';
end $$;

-- ---------------------------------------------------------------------------------------------
-- Classes
-- ---------------------------------------------------------------------------------------------
create function public.classroom_summary(p_user_id uuid, p_classroom_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', c.description, 'status', c.status,
    'createdAt', c.created_at, 'archivedAt', c.archived_at, 'role', m.role,
    'displayName', m.display_name, 'isOwner', c.owner_id = p_user_id,
    'canManage', m.role in ('teacher', 'assistant'),
    'memberCount', (select count(*) from public.classroom_members x where x.classroom_id = c.id and x.status = 'active'),
    'lessonCount', (select count(*) from public.classroom_lessons l where l.classroom_id = c.id and l.status = 'published'),
    'teacherName', (select display_name from public.classroom_members t where t.classroom_id = c.id and t.role = 'teacher'))
  from public.classrooms c join public.classroom_members m on m.classroom_id = c.id and m.user_id = p_user_id
  where c.id = p_classroom_id
$$;

-- Creates a class with the caller as its teacher; a retry with the same id returns it.
create function public.classroom_create_admin(p_user_id uuid, p_id uuid, p_name text, p_description text, p_display_name text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_class public.classrooms;
begin
  select * into v_class from public.classrooms where id = p_id;
  if found then
    if v_class.owner_id <> p_user_id then raise exception 'CLASSROOM_NOT_FOUND'; end if;
    return public.classroom_summary(p_user_id, p_id) || jsonb_build_object('replayed', true);
  end if;
  if coalesce(btrim(p_name), '') = '' or char_length(btrim(p_name)) > 120
    or coalesce(btrim(p_display_name), '') = '' or char_length(btrim(p_display_name)) > 80
    or char_length(coalesce(p_description, '')) > 2000 then
    raise exception 'CLASSROOM_INVALID_INPUT';
  end if;
  if (select count(*) from public.classrooms where owner_id = p_user_id and status = 'active') >= 50 then
    raise exception 'CLASSROOM_LIMIT';
  end if;
  insert into public.classrooms(id, owner_id, name, description)
    values (p_id, p_user_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''));
  insert into public.classroom_members(classroom_id, user_id, role, display_name)
    values (p_id, p_user_id, 'teacher', btrim(p_display_name));
  return public.classroom_summary(p_user_id, p_id) || jsonb_build_object('replayed', false);
end $$;

-- Teacher only: rename, describe, archive or restore. Archived classes stay readable by members.
create function public.classroom_update_admin(p_user_id uuid, p_classroom_id uuid, p_name text, p_description text, p_status text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'own');
  if (p_name is not null and char_length(btrim(p_name)) not between 1 and 120)
    or char_length(coalesce(p_description, '')) > 2000
    or (p_status is not null and p_status not in ('active', 'archived')) then
    raise exception 'CLASSROOM_INVALID_INPUT';
  end if;
  update public.classrooms set
    name = coalesce(btrim(p_name), name),
    description = case when p_description is null then description else nullif(btrim(p_description), '') end,
    status = coalesce(p_status, status),
    archived_at = case when p_status = 'archived' and status <> 'archived' then clock_timestamp()
      when p_status = 'active' then null else archived_at end
    where id = p_classroom_id;
  return public.classroom_summary(p_user_id, p_classroom_id);
end $$;

create function public.classroom_list_mine_admin(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(public.classroom_summary(p_user_id, m.classroom_id) order by c.status, c.created_at desc), '[]'::jsonb)
  from public.classroom_members m join public.classrooms c on c.id = m.classroom_id
  where m.user_id = p_user_id and m.status = 'active'
$$;

create function public.classroom_get_admin(p_user_id uuid, p_classroom_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'read');
  return public.classroom_summary(p_user_id, p_classroom_id);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Invitations and membership
-- ---------------------------------------------------------------------------------------------
create function public.classroom_create_invite_admin(p_user_id uuid, p_classroom_id uuid, p_id uuid,
  p_request_id uuid, p_hash text, p_days integer, p_max_uses integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_invite public.classroom_invites;
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'manage');
  select * into v_invite from public.classroom_invites where created_by = p_user_id and request_id = p_request_id;
  if found then
    if v_invite.classroom_id <> p_classroom_id or v_invite.token_hash <> p_hash or v_invite.max_uses <> p_max_uses then
      raise exception 'CLASSROOM_REQUEST_CONFLICT';
    end if;
    return jsonb_build_object('id', v_invite.id, 'expiresAt', v_invite.expires_at, 'maxUses', v_invite.max_uses, 'replayed', true);
  end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_days is null or p_days not between 1 and 30
    or p_max_uses is null or p_max_uses not between 1 and 500 then
    raise exception 'CLASSROOM_INVALID_INPUT';
  end if;
  if (select count(*) from public.classroom_invites where classroom_id = p_classroom_id and revoked_at is null
      and expires_at > clock_timestamp() and use_count < max_uses) >= 20 then
    raise exception 'CLASSROOM_INVITE_LIMIT';
  end if;
  insert into public.classroom_invites(id, classroom_id, created_by, request_id, token_hash, max_uses, expires_at)
    values (p_id, p_classroom_id, p_user_id, p_request_id, p_hash, p_max_uses, clock_timestamp() + make_interval(days => p_days))
    returning * into v_invite;
  return jsonb_build_object('id', v_invite.id, 'expiresAt', v_invite.expires_at, 'maxUses', v_invite.max_uses, 'replayed', false);
end $$;

create function public.classroom_list_invites_admin(p_user_id uuid, p_classroom_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'manage');
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'createdAt', i.created_at, 'expiresAt', i.expires_at, 'maxUses', i.max_uses,
      'useCount', i.use_count, 'revokedAt', i.revoked_at,
      'state', case when i.revoked_at is not null then 'revoked' when i.expires_at <= clock_timestamp() then 'expired'
        when i.use_count >= i.max_uses then 'full' else 'active' end) order by i.created_at desc)
    from public.classroom_invites i where i.classroom_id = p_classroom_id), '[]'::jsonb);
end $$;

create function public.classroom_revoke_invite_admin(p_user_id uuid, p_classroom_id uuid, p_invite_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'manage');
  update public.classroom_invites set revoked_at = coalesce(revoked_at, clock_timestamp())
    where id = p_invite_id and classroom_id = p_classroom_id returning id into v_id;
  if v_id is null then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  return jsonb_build_object('id', v_id, 'revoked', true);
end $$;

-- Joins with an invitation code (its hash). The invitation row is locked, so concurrent joins
-- are serialized and the last seats cannot be oversold. Joining again while active is a no-op
-- that consumes no use. Someone removed by the teacher needs an invitation created after the
-- removal.
create function public.classroom_join_admin(p_user_id uuid, p_hash text, p_display_name text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_invite public.classroom_invites; v_class public.classrooms; v_member public.classroom_members;
begin
  if coalesce(btrim(p_display_name), '') = '' or char_length(btrim(p_display_name)) > 80 then
    raise exception 'CLASSROOM_INVALID_INPUT';
  end if;
  select * into v_invite from public.classroom_invites where token_hash = p_hash for update;
  if not found or v_invite.revoked_at is not null or v_invite.expires_at <= clock_timestamp() then
    raise exception 'CLASSROOM_INVITE_INVALID';
  end if;
  select * into v_class from public.classrooms where id = v_invite.classroom_id;
  if v_class.status <> 'active' then raise exception 'CLASSROOM_INVITE_INVALID'; end if;
  select * into v_member from public.classroom_members
    where classroom_id = v_class.id and user_id = p_user_id for update;
  if found and v_member.status = 'active' then
    return public.classroom_summary(p_user_id, v_class.id) || jsonb_build_object('alreadyMember', true);
  end if;
  if found and v_member.status = 'removed' and v_member.ended_at >= v_invite.created_at then
    raise exception 'CLASSROOM_REMOVED';
  end if;
  if v_invite.use_count >= v_invite.max_uses then raise exception 'CLASSROOM_INVITE_FULL'; end if;
  if (select count(*) from public.classroom_members where classroom_id = v_class.id and status = 'active') >= 500 then
    raise exception 'CLASSROOM_LIMIT';
  end if;
  update public.classroom_invites set use_count = use_count + 1 where id = v_invite.id;
  insert into public.classroom_members(classroom_id, user_id, role, status, display_name, invite_id, joined_at)
    values (v_class.id, p_user_id, 'student', 'active', btrim(p_display_name), v_invite.id, clock_timestamp())
    on conflict (classroom_id, user_id) do update set role = 'student', status = 'active',
      display_name = excluded.display_name, invite_id = excluded.invite_id, joined_at = excluded.joined_at,
      ended_at = null, ended_by = null;
  return public.classroom_summary(p_user_id, v_class.id) || jsonb_build_object('alreadyMember', false);
end $$;

create function public.classroom_list_members_admin(p_user_id uuid, p_classroom_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'read');
  return coalesce((select jsonb_agg(jsonb_build_object('userId', m.user_id, 'displayName', m.display_name,
      'role', m.role, 'joinedAt', m.joined_at, 'isMe', m.user_id = p_user_id)
      order by case m.role when 'teacher' then 0 when 'assistant' then 1 else 2 end, m.display_name)
    from public.classroom_members m where m.classroom_id = p_classroom_id and m.status = 'active'), '[]'::jsonb);
end $$;

-- Teacher only. The teacher cannot be removed; the removed account loses access at once.
create function public.classroom_remove_member_admin(p_user_id uuid, p_classroom_id uuid, p_member_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_member public.classroom_members;
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'own');
  select * into v_member from public.classroom_members where classroom_id = p_classroom_id
    and user_id = p_member_id and status = 'active' for update;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if v_member.role = 'teacher' then raise exception 'CLASSROOM_FORBIDDEN'; end if;
  update public.classroom_members set status = 'removed', ended_at = clock_timestamp(), ended_by = p_user_id
    where classroom_id = p_classroom_id and user_id = p_member_id;
  perform public.classroom_end_member_content(p_classroom_id, p_member_id, p_user_id);
  return jsonb_build_object('userId', p_member_id, 'status', 'removed');
end $$;

create function public.classroom_leave_admin(p_user_id uuid, p_classroom_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_role text;
begin
  v_role := public.classroom_require_admin(p_user_id, p_classroom_id, 'leave');
  if v_role = 'teacher' then raise exception 'CLASSROOM_OWNER_CANNOT_LEAVE'; end if;
  update public.classroom_members set status = 'left', ended_at = clock_timestamp(), ended_by = p_user_id
    where classroom_id = p_classroom_id and user_id = p_user_id;
  perform public.classroom_end_member_content(p_classroom_id, p_user_id, p_user_id);
  return jsonb_build_object('classroomId', p_classroom_id, 'status', 'left');
end $$;

-- Teacher only: make a student an assistant or back.
create function public.classroom_set_member_role_admin(p_user_id uuid, p_classroom_id uuid, p_member_id uuid, p_role text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_member public.classroom_members;
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'own');
  if p_role is null or p_role not in ('assistant', 'student') then raise exception 'CLASSROOM_INVALID_INPUT'; end if;
  select * into v_member from public.classroom_members where classroom_id = p_classroom_id
    and user_id = p_member_id and status = 'active' for update;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if v_member.role = 'teacher' then raise exception 'CLASSROOM_FORBIDDEN'; end if;
  update public.classroom_members set role = p_role where classroom_id = p_classroom_id and user_id = p_member_id;
  return jsonb_build_object('userId', p_member_id, 'role', p_role);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Published lessons
-- ---------------------------------------------------------------------------------------------
-- Checks the chosen summary and lists against the pinned revision of the owner's material.
create function public.classroom_check_lesson_content(p_material_id uuid, p_revision_id uuid, p_summary_id uuid, p_batches uuid[])
returns void language plpgsql stable set search_path = '' as $$
declare v_revision integer;
begin
  select tv.revision into v_revision from public.transcription_versions tv
    join public.transcriptions t on t.id = tv.transcription_id
    where tv.id = p_revision_id and t.material_id = p_material_id;
  if not found then raise exception 'CLASSROOM_REVISION_NOT_FOUND'; end if;
  if p_summary_id is not null and not exists (select 1 from public.summary_versions s
      where s.id = p_summary_id and s.material_id = p_material_id
        and coalesce(s.source_transcription_version_id = p_revision_id, s.source_transcription_revision = v_revision)) then
    raise exception 'CLASSROOM_CONTENT_MISMATCH';
  end if;
  if cardinality(coalesce(p_batches, '{}')) > 10
    or (select count(distinct b) from unnest(coalesce(p_batches, '{}')) b) <> cardinality(coalesce(p_batches, '{}')) then
    raise exception 'CLASSROOM_INVALID_INPUT';
  end if;
  if exists (select 1 from unnest(coalesce(p_batches, '{}')) b where not exists (
      select 1 from public.question_batches q where q.id = b and q.material_id = p_material_id
        and q.source_transcription_revision = v_revision)) then
    raise exception 'CLASSROOM_CONTENT_MISMATCH';
  end if;
end $$;

create function public.classroom_lesson_row(p_lesson public.classroom_lessons)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p_lesson.id, 'classroomId', p_lesson.classroom_id, 'title', p_lesson.title,
    'source', p_lesson.source, 'status', p_lesson.status, 'publishedAt', p_lesson.published_at,
    'revision', (select revision from public.transcription_versions where id = p_lesson.published_revision_id),
    'hasSummary', p_lesson.summary_id is not null, 'questionListCount', cardinality(p_lesson.question_batch_ids),
    'author', jsonb_build_object('userId', p_lesson.owner_id,
      'displayName', public.classroom_member_name(p_lesson.classroom_id, p_lesson.owner_id)))
$$;

-- Teacher or assistant publishes one of their own materials at a revision they confirmed.
create function public.classroom_publish_lesson_admin(p_user_id uuid, p_classroom_id uuid, p_id uuid, p_body jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_lesson public.classroom_lessons; v_material public.materials; v_revision uuid; v_summary uuid; v_batches uuid[];
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'manage');
  select * into v_lesson from public.classroom_lessons where id = p_id;
  if found then
    if v_lesson.classroom_id <> p_classroom_id or v_lesson.published_by is distinct from p_user_id then
      raise exception 'CLASSROOM_REQUEST_CONFLICT';
    end if;
    return public.classroom_lesson_row(v_lesson) || jsonb_build_object('replayed', true);
  end if;
  if jsonb_typeof(coalesce(p_body, 'null'::jsonb)) <> 'object'
    or (p_body ? 'questionBatchIds' and jsonb_typeof(p_body->'questionBatchIds') <> 'array') then
    raise exception 'CLASSROOM_INVALID_INPUT';
  end if;
  select * into v_material from public.materials where id = nullif(p_body->>'materialId', '')::uuid and user_id = p_user_id;
  if not found then raise exception 'MATERIAL_NOT_FOUND'; end if;
  v_revision := nullif(p_body->>'revisionId', '')::uuid;
  v_summary := nullif(p_body->>'summaryId', '')::uuid;
  v_batches := coalesce(array(select value::uuid from jsonb_array_elements_text(coalesce(p_body->'questionBatchIds', '[]'::jsonb))), '{}');
  perform public.classroom_check_lesson_content(v_material.id, v_revision, v_summary, v_batches);
  if not exists (select 1 from public.transcription_confirmations where material_id = v_material.id
      and user_id = p_user_id and transcription_version_id = v_revision) then
    raise exception 'TRANSCRIPTION_CONFIRMATION_REQUIRED';
  end if;
  if exists (select 1 from public.classroom_lessons where classroom_id = p_classroom_id
      and material_id = v_material.id and status = 'published') then
    raise exception 'CLASSROOM_ALREADY_PUBLISHED';
  end if;
  if char_length(btrim(coalesce(p_body->>'title', v_material.title))) not between 1 and 200 then
    raise exception 'CLASSROOM_INVALID_INPUT';
  end if;
  insert into public.classroom_lessons(id, classroom_id, material_id, owner_id, published_by, published_revision_id,
      summary_id, question_batch_ids, title, source)
    values (p_id, p_classroom_id, v_material.id, p_user_id, p_user_id, v_revision, v_summary, v_batches,
      btrim(coalesce(nullif(btrim(p_body->>'title'), ''), v_material.title)), 'teacher')
    returning * into v_lesson;
  return public.classroom_lesson_row(v_lesson) || jsonb_build_object('replayed', false);
end $$;

-- Teacher or assistant hides a lesson again. A lesson from a submission goes back to
-- 'transcription_confirmed' (recorded in the submission log).
create function public.classroom_unpublish_lesson_admin(p_user_id uuid, p_classroom_id uuid, p_lesson_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_role text; v_lesson public.classroom_lessons; v_sub public.classroom_submissions;
begin
  v_role := public.classroom_require_admin(p_user_id, p_classroom_id, 'manage');
  select * into v_lesson from public.classroom_lessons where id = p_lesson_id and classroom_id = p_classroom_id for update;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if v_lesson.status = 'unpublished' then return public.classroom_lesson_row(v_lesson); end if;
  update public.classroom_lessons set status = 'unpublished', unpublished_at = clock_timestamp()
    where id = p_lesson_id returning * into v_lesson;
  select * into v_sub from public.classroom_submissions where id = v_lesson.submission_id and status = 'published' for update;
  if found then
    update public.classroom_submissions set status = 'transcription_confirmed', lesson_id = null where id = v_sub.id;
    insert into public.classroom_submission_events(submission_id, from_status, to_status, actor_id, actor_role, note)
      values (v_sub.id, 'published', 'transcription_confirmed', p_user_id, v_role, 'lesson_unpublished');
  end if;
  return public.classroom_lesson_row(v_lesson);
end $$;

create function public.classroom_list_lessons_admin(p_user_id uuid, p_classroom_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'read');
  return coalesce((select jsonb_agg(public.classroom_lesson_row(l) order by l.published_at desc)
    from public.classroom_lessons l where l.classroom_id = p_classroom_id and l.status = 'published'), '[]'::jsonb);
end $$;

-- A published lesson as members read it: the pinned revision's transcript (never the current
-- one), the chosen summary and the chosen question lists. No media, notes or progress.
create function public.classroom_get_lesson_admin(p_user_id uuid, p_classroom_id uuid, p_lesson_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_lesson public.classroom_lessons; v_version public.transcription_versions;
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'read');
  select * into v_lesson from public.classroom_lessons where id = p_lesson_id and classroom_id = p_classroom_id
    and status = 'published';
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  select * into v_version from public.transcription_versions where id = v_lesson.published_revision_id;
  return public.classroom_lesson_row(v_lesson) || jsonb_build_object(
    'transcript', jsonb_build_object('revision', v_version.revision, 'fullText', v_version.full_text,
      'segments', coalesce((select jsonb_agg(jsonb_build_object('position', s->'position', 'startMs', s->'startMs',
        'endMs', s->'endMs', 'text', s->'text') order by (s->>'position')::integer)
        from jsonb_array_elements(v_version.segments_snapshot) s), '[]'::jsonb)),
    'summary', (select jsonb_build_object('label', sv.label, 'text', sv.text) from public.summary_versions sv
      where sv.id = v_lesson.summary_id),
    'questionLists', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title,
        'questions', coalesce((select jsonb_agg(jsonb_build_object('position', q.position, 'statement', q.statement,
          'options', q.options, 'correctIndex', q.correct_index, 'explanation', q.explanation) order by q.position)
          from public.questions q where q.batch_id = b.id), '[]'::jsonb)) order by x.ord)
      from unnest(v_lesson.question_batch_ids) with ordinality x(batch_id, ord)
      join public.question_batches b on b.id = x.batch_id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Student submissions
-- ---------------------------------------------------------------------------------------------
create function public.classroom_submission_row(p_sub public.classroom_submissions, p_viewer uuid, p_viewer_role text)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p_sub.id, 'classroomId', p_sub.classroom_id, 'materialId', p_sub.material_id,
    'materialTitle', (select title from public.materials where id = p_sub.material_id),
    'student', jsonb_build_object('userId', p_sub.student_id,
      'displayName', public.classroom_member_name(p_sub.classroom_id, p_sub.student_id)),
    'status', p_sub.status, 'note', p_sub.note, 'decisionNote', p_sub.decision_note,
    'teacherConfirmedRevision', (select revision from public.transcription_versions where id = p_sub.teacher_confirmed_revision_id),
    'teacherConfirmedAt', p_sub.teacher_confirmed_at, 'lessonId', p_sub.lesson_id,
    'createdAt', p_sub.created_at, 'updatedAt', p_sub.updated_at, 'isMine', p_sub.student_id = p_viewer,
    'actions', coalesce((select jsonb_agg(t.to_status order by t.ord) from unnest(array['approved_for_processing',
        'processing', 'transcription_confirmed', 'published', 'rejected', 'withdrawn']) with ordinality t(to_status, ord)
      where (public.classroom_submission_transition_actor(p_sub.status, t.to_status) = 'manager'
          and p_viewer_role in ('teacher', 'assistant'))
        or (public.classroom_submission_transition_actor(p_sub.status, t.to_status) = 'owner'
          and p_sub.student_id = p_viewer)), '[]'::jsonb))
$$;

-- A student submits one of their own recordings (with the current permission declaration).
create function public.classroom_submit_admin(p_user_id uuid, p_classroom_id uuid, p_id uuid, p_material_id uuid,
  p_note text, p_permission_version text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_role text; v_sub public.classroom_submissions;
begin
  v_role := public.classroom_require_admin(p_user_id, p_classroom_id, 'submit');
  select * into v_sub from public.classroom_submissions where id = p_id;
  if found then
    if v_sub.student_id <> p_user_id or v_sub.classroom_id <> p_classroom_id or v_sub.material_id <> p_material_id then
      raise exception 'CLASSROOM_REQUEST_CONFLICT';
    end if;
    return public.classroom_submission_row(v_sub, p_user_id, v_role) || jsonb_build_object('replayed', true);
  end if;
  if char_length(coalesce(p_note, '')) > 1000 then raise exception 'CLASSROOM_INVALID_INPUT'; end if;
  perform public.require_material_permission_admin(p_user_id, p_material_id, p_permission_version);
  if exists (select 1 from public.classroom_submissions where classroom_id = p_classroom_id
      and material_id = p_material_id and status not in ('rejected', 'withdrawn')) then
    raise exception 'CLASSROOM_ALREADY_SUBMITTED';
  end if;
  insert into public.classroom_submissions(id, classroom_id, material_id, student_id, note)
    values (p_id, p_classroom_id, p_material_id, p_user_id, nullif(btrim(coalesce(p_note, '')), ''))
    returning * into v_sub;
  insert into public.classroom_submission_events(submission_id, from_status, to_status, actor_id, actor_role)
    values (p_id, null, 'submitted', p_user_id, v_role);
  return public.classroom_submission_row(v_sub, p_user_id, v_role) || jsonb_build_object('replayed', false);
end $$;

-- The only way to move a submission. Checks the actor for the transition, its preconditions,
-- writes the log and is idempotent per request id.
create function public.classroom_transition_submission_admin(p_user_id uuid, p_classroom_id uuid, p_submission_id uuid,
  p_to_status text, p_request_id uuid, p_revision_id uuid, p_note text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_role text; v_sub public.classroom_submissions; v_actor text; v_from text; v_lesson_id uuid;
  v_material public.materials; v_current uuid;
begin
  v_role := public.classroom_require_admin(p_user_id, p_classroom_id, 'read');
  select * into v_sub from public.classroom_submissions where id = p_submission_id and classroom_id = p_classroom_id for update;
  -- Other students cannot even see that a submission exists.
  if not found or (v_sub.student_id <> p_user_id and v_role not in ('teacher', 'assistant')) then
    raise exception 'CLASSROOM_NOT_FOUND';
  end if;
  if p_request_id is not null and v_sub.last_request_id = p_request_id and v_sub.status = p_to_status then
    return public.classroom_submission_row(v_sub, p_user_id, v_role) || jsonb_build_object('replayed', true);
  end if;
  if char_length(coalesce(p_note, '')) > 1000 then raise exception 'CLASSROOM_INVALID_INPUT'; end if;
  v_actor := public.classroom_submission_transition_actor(v_sub.status, p_to_status);
  if v_actor is null then raise exception 'CLASSROOM_ILLEGAL_TRANSITION'; end if;
  if (v_actor = 'manager' and v_role not in ('teacher', 'assistant')) or (v_actor = 'owner' and v_sub.student_id <> p_user_id) then
    raise exception 'CLASSROOM_FORBIDDEN';
  end if;
  -- Withdrawing stays possible in an archived class; everything else needs an active class.
  perform public.classroom_require_admin(p_user_id, p_classroom_id, case when p_to_status = 'withdrawn' then 'leave' else 'participate' end);
  v_from := v_sub.status;
  select * into v_material from public.materials where id = v_sub.material_id;
  if p_to_status = 'processing' then
    if not exists (select 1 from public.transcriptions where material_id = v_sub.material_id)
      and not exists (select 1 from public.processing_jobs where material_id = v_sub.material_id) then
      raise exception 'CLASSROOM_PROCESSING_REQUIRED';
    end if;
  elsif p_to_status = 'transcription_confirmed' and v_from = 'processing' then
    select tv.id into v_current from public.transcription_versions tv join public.transcriptions t on t.id = tv.transcription_id
      where t.material_id = v_sub.material_id and tv.revision = t.current_revision;
    if v_current is null then raise exception 'CLASSROOM_PROCESSING_REQUIRED'; end if;
    if p_revision_id is null or p_revision_id <> v_current then raise exception 'REVISION_CONFLICT'; end if;
    -- The student's own confirmation of this revision comes first; the teacher's is separate.
    if not exists (select 1 from public.transcription_confirmations where material_id = v_sub.material_id
        and user_id = v_sub.student_id and transcription_version_id = p_revision_id) then
      raise exception 'CLASSROOM_STUDENT_CONFIRMATION_REQUIRED';
    end if;
    update public.classroom_submissions set teacher_confirmed_revision_id = p_revision_id,
      teacher_confirmed_by = p_user_id, teacher_confirmed_at = clock_timestamp() where id = v_sub.id;
  elsif p_to_status = 'published' then
    if v_sub.teacher_confirmed_revision_id is null then raise exception 'CLASSROOM_TEACHER_CONFIRMATION_REQUIRED'; end if;
    if exists (select 1 from public.classroom_lessons where classroom_id = p_classroom_id
        and material_id = v_sub.material_id and status = 'published') then
      raise exception 'CLASSROOM_ALREADY_PUBLISHED';
    end if;
    insert into public.classroom_lessons(id, classroom_id, material_id, owner_id, published_by, published_revision_id,
        title, source, submission_id)
      values (gen_random_uuid(), p_classroom_id, v_sub.material_id, v_sub.student_id, p_user_id,
        v_sub.teacher_confirmed_revision_id, v_material.title, 'submission', v_sub.id)
      returning id into v_lesson_id;
  end if;
  if v_from = 'published' then
    update public.classroom_lessons set status = 'unpublished', unpublished_at = clock_timestamp()
      where id = v_sub.lesson_id and status = 'published';
  end if;
  update public.classroom_submissions set status = p_to_status, last_request_id = p_request_id,
      lesson_id = case when p_to_status = 'published' then v_lesson_id else null end,
      decision_note = case when v_actor = 'manager' and p_note is not null then nullif(btrim(p_note), '') else decision_note end
    where id = v_sub.id returning * into v_sub;
  insert into public.classroom_submission_events(submission_id, from_status, to_status, actor_id, actor_role, note)
    values (v_sub.id, v_from, p_to_status, p_user_id, case when v_actor = 'owner' then 'student' else v_role end,
      nullif(btrim(coalesce(p_note, '')), ''));
  return public.classroom_submission_row(v_sub, p_user_id, v_role) || jsonb_build_object('replayed', false);
end $$;

-- Managers see every submission; a student sees only their own.
create function public.classroom_list_submissions_admin(p_user_id uuid, p_classroom_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_role text;
begin
  v_role := public.classroom_require_admin(p_user_id, p_classroom_id, 'read');
  return coalesce((select jsonb_agg(public.classroom_submission_row(s, p_user_id, v_role) order by s.created_at desc)
    from public.classroom_submissions s where s.classroom_id = p_classroom_id
      and (v_role in ('teacher', 'assistant') or s.student_id = p_user_id)), '[]'::jsonb);
end $$;

-- Detail for the reviewer (or the submitting student): the log and, once processing started,
-- the transcript of the current revision that the teacher is asked to confirm.
create function public.classroom_get_submission_admin(p_user_id uuid, p_classroom_id uuid, p_submission_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_role text; v_sub public.classroom_submissions; v_version public.transcription_versions;
begin
  v_role := public.classroom_require_admin(p_user_id, p_classroom_id, 'read');
  select * into v_sub from public.classroom_submissions where id = p_submission_id and classroom_id = p_classroom_id;
  if not found or (v_sub.student_id <> p_user_id and v_role not in ('teacher', 'assistant')) then
    raise exception 'CLASSROOM_NOT_FOUND';
  end if;
  if v_sub.status in ('processing', 'transcription_confirmed', 'published') then
    select tv.* into v_version from public.transcription_versions tv join public.transcriptions t on t.id = tv.transcription_id
      where t.material_id = v_sub.material_id and tv.revision = t.current_revision;
  end if;
  return public.classroom_submission_row(v_sub, p_user_id, v_role) || jsonb_build_object(
    'events', coalesce((select jsonb_agg(jsonb_build_object('fromStatus', e.from_status, 'toStatus', e.to_status,
        'actorRole', e.actor_role, 'note', e.note, 'at', e.created_at) order by e.id)
      from public.classroom_submission_events e where e.submission_id = v_sub.id), '[]'::jsonb),
    'review', case when v_version.id is null then null else jsonb_build_object('revisionId', v_version.id,
      'revision', v_version.revision, 'fullText', v_version.full_text,
      'studentConfirmed', exists (select 1 from public.transcription_confirmations c where c.material_id = v_sub.material_id
        and c.user_id = v_sub.student_id and c.transcription_version_id = v_version.id)) end);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Shared flashcard sets (content only, never schedules or review history)
-- ---------------------------------------------------------------------------------------------
create function public.classroom_shared_set_row(p_item public.classroom_shared_items, p_viewer uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('sharedId', p_item.id, 'classroomId', p_item.classroom_id, 'kind', p_item.item_kind,
    'setId', s.id, 'name', s.name, 'sharedAt', p_item.shared_at, 'isMine', p_item.owner_id = p_viewer,
    'cardCount', (select count(*) from public.study_flashcards f where f.set_id = s.id and f.status = 'active'),
    'author', jsonb_build_object('userId', p_item.owner_id,
      'displayName', public.classroom_member_name(p_item.classroom_id, p_item.owner_id)))
  from public.study_flashcard_sets s where s.id = p_item.flashcard_set_id
$$;

create function public.classroom_share_item_admin(p_user_id uuid, p_classroom_id uuid, p_id uuid, p_kind text, p_item_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_item public.classroom_shared_items;
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'participate');
  select * into v_item from public.classroom_shared_items where id = p_id;
  if found then
    if v_item.owner_id <> p_user_id or v_item.classroom_id <> p_classroom_id or v_item.flashcard_set_id <> p_item_id then
      raise exception 'CLASSROOM_REQUEST_CONFLICT';
    end if;
    return public.classroom_shared_set_row(v_item, p_user_id) || jsonb_build_object('replayed', true);
  end if;
  if p_kind is distinct from 'flashcard_set' then raise exception 'CLASSROOM_INVALID_INPUT'; end if;
  if not exists (select 1 from public.study_flashcard_sets where id = p_item_id and user_id = p_user_id and status = 'active') then
    raise exception 'FLASHCARD_NOT_FOUND';
  end if;
  if exists (select 1 from public.classroom_shared_items where classroom_id = p_classroom_id
      and flashcard_set_id = p_item_id and revoked_at is null) then
    raise exception 'CLASSROOM_ALREADY_SHARED';
  end if;
  insert into public.classroom_shared_items(id, classroom_id, owner_id, item_kind, flashcard_set_id)
    values (p_id, p_classroom_id, p_user_id, 'flashcard_set', p_item_id) returning * into v_item;
  return public.classroom_shared_set_row(v_item, p_user_id) || jsonb_build_object('replayed', false);
end $$;

-- The owner stops sharing; a teacher or assistant may also hide an item from the class.
create function public.classroom_revoke_shared_item_admin(p_user_id uuid, p_classroom_id uuid, p_shared_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_role text; v_item public.classroom_shared_items;
begin
  v_role := public.classroom_require_admin(p_user_id, p_classroom_id, 'leave');
  select * into v_item from public.classroom_shared_items where id = p_shared_id and classroom_id = p_classroom_id for update;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if v_item.owner_id <> p_user_id and v_role not in ('teacher', 'assistant') then raise exception 'CLASSROOM_FORBIDDEN'; end if;
  update public.classroom_shared_items set revoked_at = coalesce(revoked_at, clock_timestamp()),
    revoked_by = coalesce(revoked_by, p_user_id) where id = p_shared_id;
  return jsonb_build_object('sharedId', p_shared_id, 'revoked', true);
end $$;

-- Visible = not revoked, set still active, and its author still an active member.
create function public.classroom_list_shared_flashcard_sets_admin(p_user_id uuid, p_classroom_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'read');
  return coalesce((select jsonb_agg(public.classroom_shared_set_row(i, p_user_id) order by i.shared_at desc)
    from public.classroom_shared_items i
    join public.study_flashcard_sets s on s.id = i.flashcard_set_id and s.status = 'active'
    join public.classroom_members m on m.classroom_id = i.classroom_id and m.user_id = i.owner_id and m.status = 'active'
    where i.classroom_id = p_classroom_id and i.revoked_at is null and i.item_kind = 'flashcard_set'), '[]'::jsonb);
end $$;

-- One shared set's active cards with authorship. Only content fields: no due dates, intervals,
-- repetitions, ease, last review, evidence quotes or source references.
create function public.classroom_get_shared_flashcard_set_admin(p_user_id uuid, p_classroom_id uuid, p_shared_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_item public.classroom_shared_items;
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'read');
  select i.* into v_item from public.classroom_shared_items i
    join public.study_flashcard_sets s on s.id = i.flashcard_set_id and s.status = 'active'
    join public.classroom_members m on m.classroom_id = i.classroom_id and m.user_id = i.owner_id and m.status = 'active'
    where i.id = p_shared_id and i.classroom_id = p_classroom_id and i.revoked_at is null;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  return public.classroom_shared_set_row(v_item, p_user_id) || jsonb_build_object('cards',
    coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'front', f.front_text, 'back', f.back_text,
        'style', f.card_style, 'difficulty', f.difficulty, 'focus', f.focus) order by f.created_at, f.id)
      from public.study_flashcards f where f.set_id = v_item.flashcard_set_id and f.status = 'active'), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Teacher resources
-- ---------------------------------------------------------------------------------------------
create function public.classroom_add_resource_admin(p_user_id uuid, p_classroom_id uuid, p_id uuid, p_title text,
  p_url text, p_description text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_row public.classroom_resources;
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'manage');
  select * into v_row from public.classroom_resources where id = p_id;
  if found then
    if v_row.classroom_id <> p_classroom_id then raise exception 'CLASSROOM_REQUEST_CONFLICT'; end if;
  else
    if coalesce(btrim(p_title), '') = '' or char_length(btrim(p_title)) > 160 or p_url is null
      or p_url !~ '^https://[^[:space:]]+$' or char_length(p_url) > 2048 or char_length(coalesce(p_description, '')) > 1000 then
      raise exception 'CLASSROOM_INVALID_INPUT';
    end if;
    if (select count(*) from public.classroom_resources where classroom_id = p_classroom_id and removed_at is null) >= 200 then
      raise exception 'CLASSROOM_LIMIT';
    end if;
    insert into public.classroom_resources(id, classroom_id, created_by, title, url, description)
      values (p_id, p_classroom_id, p_user_id, btrim(p_title), p_url, nullif(btrim(coalesce(p_description, '')), ''))
      returning * into v_row;
  end if;
  return jsonb_build_object('id', v_row.id, 'title', v_row.title, 'url', v_row.url, 'description', v_row.description,
    'createdAt', v_row.created_at);
end $$;

create function public.classroom_remove_resource_admin(p_user_id uuid, p_classroom_id uuid, p_resource_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'manage');
  update public.classroom_resources set removed_at = coalesce(removed_at, clock_timestamp())
    where id = p_resource_id and classroom_id = p_classroom_id returning id into v_id;
  if v_id is null then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  return jsonb_build_object('id', v_id, 'removed', true);
end $$;

create function public.classroom_list_resources_admin(p_user_id uuid, p_classroom_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform public.classroom_require_admin(p_user_id, p_classroom_id, 'read');
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'url', r.url,
      'description', r.description, 'createdAt', r.created_at) order by r.created_at desc)
    from public.classroom_resources r where r.classroom_id = p_classroom_id and r.removed_at is null), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: RLS on, no policy for the browser roles (deny all), server-only functions.
-- ---------------------------------------------------------------------------------------------
alter table public.classrooms enable row level security;
alter table public.classroom_members enable row level security;
alter table public.classroom_invites enable row level security;
alter table public.classroom_submissions enable row level security;
alter table public.classroom_submission_events enable row level security;
alter table public.classroom_lessons enable row level security;
alter table public.classroom_shared_items enable row level security;
alter table public.classroom_resources enable row level security;
revoke all on table public.classrooms, public.classroom_members, public.classroom_invites, public.classroom_submissions,
  public.classroom_submission_events, public.classroom_lessons, public.classroom_shared_items, public.classroom_resources
  from public, anon, authenticated;
grant select, insert, update, delete on table public.classrooms, public.classroom_members, public.classroom_invites,
  public.classroom_submissions, public.classroom_submission_events, public.classroom_lessons,
  public.classroom_shared_items, public.classroom_resources to service_role;

do $privileges$
declare v_fn regprocedure;
begin
  for v_fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'classroom\_%' escape '\') loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end
$privileges$;
commit;
