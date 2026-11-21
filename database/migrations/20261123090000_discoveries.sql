-- Voz em Estudo 3.5, Milestone 6: investigations, the Arquivo de Descobertas and the Gabinete.
-- MIGRATION CANDIDATE, NOT APPLIED. STAGING ONLY until validated: it is not part of any release
-- manifest. Apply only with backup, database/checks/discoveries-preflight.sql, explicit approval and
-- the correct environment; then run database/checks/discoveries-postflight.sql and enable
-- FEATURE_DISCOVERIES (requires FEATURE_ANNOTATIONS). Rollback: database/rollback/discoveries-rollback.md.
-- Guide: docs/migrations/DISCOVERIES.md.
--
-- Additive only: new tables, new functions and new triggers on the new tables. No existing table,
-- column, constraint, function or row is changed.
--
-- The loop: a question about one of the account's OWN lessons with a CONFIRMED transcript revision
-- (investigation) -> evidence: quotes of that revision checked here against segments_snapshot, the
-- same rule as Notes 3.0 anchors -> the student's own explanation -> optional links to things the
-- student already has (answered questions, flashcards, highlights, the lesson notebook), by
-- reference only -> reflection -> a discovery that keeps evolving (versioned edits, reflections,
-- connections, meaningful revisits).
--
-- Collectibles (stamps, desk objects, covers) are owned by the server: rows in collection_unlocks
-- are written ONLY by triggers on the rows that prove a learning event (verified evidence, a saved
-- explanation, a completed investigation, a connection, a revisit). No function "gives" an item;
-- one unlock per (user, collectible), never updated, never revoked, nothing expires.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
declare v_missing text[] := '{}';
begin
  if to_regclass('public.materials') is null or to_regclass('public.transcriptions') is null
    or to_regclass('public.transcription_versions') is null then
    v_missing := array_append(v_missing, 'tabelas base (001_initial.sql)');
  end if;
  if to_regclass('public.transcription_confirmations') is null then
    v_missing := array_append(v_missing, 'transcription_confirmations (E02, 20261009101846_academic_review.sql)');
  end if;
  if to_regclass('public.study_annotations') is null then
    v_missing := array_append(v_missing, 'study_annotations (E14, 20261105014000_annotations.sql)');
  end if;
  if to_regclass('public.materials') is not null and not exists (select 1 from pg_constraint
      where conrelid = 'public.materials'::regclass and contype = 'u'
        and pg_get_constraintdef(oid) ilike '%(id, user_id)%') then
    v_missing := array_append(v_missing, 'unique materials(id, user_id) (E03, 20261104190000_catalog_units.sql)');
  end if;
  if cardinality(v_missing) > 0 then
    raise exception 'DISCOVERIES_ABORT: faltam pré-requisitos: %', array_to_string(v_missing, '; ');
  end if;
  if to_regclass('public.investigations') is not null or to_regclass('public.collection_unlocks') is not null then
    raise exception 'DISCOVERIES_ABORT: estruturas de descobertas ja existem; nao reaplicar';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------------------------
-- Tables (server-only; RLS on, nothing granted to browsers)
-- ---------------------------------------------------------------------------------------------
create table public.investigations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null,
  -- The confirmed revision the investigation reads. Every piece of evidence quotes this revision.
  source_revision_id uuid not null references public.transcription_versions(id) on delete cascade,
  source_revision integer not null check (source_revision >= 1),
  question text not null check (char_length(btrim(question)) between 3 and 300),
  question_origin text not null default 'student' check (question_origin in ('student', 'prompt')),
  explanation text not null default '' check (char_length(explanation) <= 5000),
  reflection text not null default '' check (char_length(reflection) <= 3000),
  explored_at timestamptz,
  -- First time the explanation reached 20 characters of the student's own text.
  explained_at timestamptz,
  status text not null default 'open' check (status in ('open', 'completed')),
  completed_at timestamptz,
  version integer not null default 1 check (version >= 1),
  last_request_id uuid not null,
  last_body_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint investigations_material_owner_fk foreign key (material_id, user_id)
    references public.materials(id, user_id) on delete cascade,
  constraint investigations_completed_check check ((status = 'completed') = (completed_at is not null))
);
create index investigations_owner_idx on public.investigations(user_id, created_at desc);
create index investigations_owner_material_idx on public.investigations(user_id, material_id, updated_at desc);
create index investigations_completed_idx on public.investigations(user_id, completed_at) where status = 'completed';
create index investigations_explained_idx on public.investigations(user_id, explained_at) where explained_at is not null;

create table public.investigation_evidence (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  material_id uuid not null,
  source_revision_id uuid not null references public.transcription_versions(id) on delete cascade,
  source_revision integer not null,
  -- Same coordinates as study_annotations (Notes 3.0): code points of the snapshot texts.
  segment_position integer not null check (segment_position >= 0),
  end_segment_position integer not null,
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null check (end_offset >= 1),
  quote text not null check (char_length(quote) between 1 and 1000),
  note text not null default '' check (char_length(note) <= 1000),
  start_ms bigint,
  body_hash text not null,
  created_at timestamptz not null default now(),
  -- Removing evidence hides it from the discovery; the row stays (it proved a learning event).
  removed_at timestamptz,
  constraint investigation_evidence_range_check
    check (end_segment_position between segment_position and segment_position + 49)
);
create unique index investigation_evidence_one_anchor on public.investigation_evidence
  (investigation_id, segment_position, start_offset, end_segment_position, end_offset) where removed_at is null;
create index investigation_evidence_owner_idx on public.investigation_evidence(user_id, created_at, id);
create index investigation_evidence_investigation_idx on public.investigation_evidence(investigation_id, created_at);

-- Apply step: things the student already has, BY REFERENCE (nothing is copied).
create table public.investigation_links (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  kind text not null check (kind in ('question', 'flashcard', 'annotation', 'notebook')),
  ref_id uuid not null,
  created_at timestamptz not null default now(),
  constraint investigation_links_unique unique (investigation_id, kind, ref_id)
);
create index investigation_links_owner_idx on public.investigation_links(user_id);

-- One discovery per completed investigation; it shares the investigation's id.
create table public.discoveries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  investigation_id uuid not null unique references public.investigations(id) on delete cascade,
  material_id uuid not null,
  -- Snapshot of the lesson's subject when the discovery was recorded (connections across subjects).
  subject_key text check (subject_key is null or char_length(subject_key) <= 200),
  subject_label text check (subject_label is null or char_length(subject_label) <= 200),
  title text not null check (char_length(btrim(title)) between 3 and 300),
  explanation text not null check (char_length(btrim(explanation)) between 20 and 5000),
  version integer not null default 1 check (version >= 1),
  last_request_id uuid not null,
  last_body_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discoveries_same_id check (id = investigation_id),
  constraint discoveries_material_owner_fk foreign key (material_id, user_id)
    references public.materials(id, user_id) on delete cascade
);
create index discoveries_owner_idx on public.discoveries(user_id, updated_at desc);
create index discoveries_owner_subject_idx on public.discoveries(user_id, subject_key, created_at) where subject_key is not null;

-- Every version of the discovery's title and explanation (version 1 = the investigation's text).
create table public.discovery_versions (
  discovery_id uuid not null references public.discoveries(id) on delete cascade,
  version integer not null check (version >= 1),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  explanation text not null,
  created_at timestamptz not null default now(),
  primary key (discovery_id, version)
);

create table public.discovery_reflections (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  discovery_id uuid not null references public.discoveries(id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index discovery_reflections_discovery_idx on public.discovery_reflections(discovery_id, created_at);
create index discovery_reflections_owner_idx on public.discovery_reflections(user_id, created_at, id);

-- A connection between two discoveries of the same account, stored once (a < b).
create table public.discovery_connections (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  discovery_a uuid not null references public.discoveries(id) on delete cascade,
  discovery_b uuid not null references public.discoveries(id) on delete cascade,
  -- The discovery page the student was editing when connecting (its revisit is the one logged).
  created_from uuid not null,
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint discovery_connections_order check (discovery_a < discovery_b),
  constraint discovery_connections_from check (created_from in (discovery_a, discovery_b)),
  constraint discovery_connections_pair unique (discovery_a, discovery_b)
);
create index discovery_connections_owner_idx on public.discovery_connections(user_id, created_at, id);
create index discovery_connections_b_idx on public.discovery_connections(discovery_b);

-- Meaningful revisits: the student changed the discovery at least one day after recording it.
-- Rate limit: one per discovery and UTC day (primary key).
create table public.discovery_revisits (
  discovery_id uuid not null references public.discoveries(id) on delete cascade,
  revisit_day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('explanation', 'evidence', 'reflection', 'connection', 'link')),
  created_at timestamptz not null default now(),
  primary key (discovery_id, revisit_day)
);
create index discovery_revisits_owner_idx on public.discovery_revisits(user_id, created_at);

-- The Gabinete. A collectible is a memory of learning: it keeps the event, the date and the
-- lesson it came from (title snapshot, so it survives the lesson). No foreign key to the
-- learning rows on purpose: deleting a lesson removes its investigations and discoveries, never
-- what the student unlocked. Deleting the account removes everything (auth.users cascade).
create table public.collection_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  collectible_id text not null check (collectible_id ~ '^(stamp|object|cover)\.[a-z0-9]+(-[a-z0-9]+)*$'),
  rule_version smallint not null default 1,
  source_event text not null check (source_event in ('evidence_verified', 'explanation_written',
    'investigation_completed', 'reflection_written', 'connection_made', 'revisit_made', 'subjects_explored')),
  source_id uuid not null,
  investigation_id uuid,
  discovery_id uuid,
  material_id uuid,
  material_title text,
  subject_label text,
  occurred_at timestamptz not null,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, collectible_id)
);

-- Unlocked desk objects placed on the desk (object id + slot). Art is resolved by id elsewhere.
create table public.desk_layouts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 8),
  version integer not null default 1 check (version >= 1),
  last_request_id uuid not null,
  last_body_hash text not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Catalog and rules (rule_version 1). The art manifest references the same ids.
-- ---------------------------------------------------------------------------------------------
create function public.collection_catalog()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'stamp.first-evidence', 'kind', 'stamp', 'event', 'evidence_verified', 'count', 1),
    jsonb_build_object('id', 'stamp.own-explanation', 'kind', 'stamp', 'event', 'explanation_written', 'count', 1),
    jsonb_build_object('id', 'stamp.first-investigation', 'kind', 'stamp', 'event', 'investigation_completed', 'count', 1),
    jsonb_build_object('id', 'stamp.first-reflection', 'kind', 'stamp', 'event', 'reflection_written', 'count', 1),
    jsonb_build_object('id', 'stamp.connection', 'kind', 'stamp', 'event', 'connection_made', 'count', 1, 'acrossSubjects', true),
    jsonb_build_object('id', 'stamp.revisit', 'kind', 'stamp', 'event', 'revisit_made', 'count', 1),
    jsonb_build_object('id', 'object.magnifying-glass', 'kind', 'object', 'event', 'investigation_completed', 'count', 3),
    jsonb_build_object('id', 'object.desk-lamp', 'kind', 'object', 'event', 'investigation_completed', 'count', 5),
    jsonb_build_object('id', 'object.specimen-jar', 'kind', 'object', 'event', 'evidence_verified', 'count', 10),
    jsonb_build_object('id', 'object.pressed-flower', 'kind', 'object', 'event', 'revisit_made', 'count', 3),
    jsonb_build_object('id', 'object.globe', 'kind', 'object', 'event', 'subjects_explored', 'count', 3),
    jsonb_build_object('id', 'cover.matcha-linen', 'kind', 'cover', 'event', 'connection_made', 'count', 3))
$$;

create function public.desk_slots()
returns text[] language sql immutable set search_path = '' as $$
  select array['desk-left', 'desk-center', 'desk-right', 'shelf-left', 'shelf-right', 'window', 'wall', 'lamp-corner']
$$;

-- Awards whatever the account's verified rows now prove. Trigger function only: it reads the
-- learning rows and inserts missing unlocks (on conflict do nothing), so running it again, or
-- concurrently, never awards twice. Each unlock keeps the row that proved it (the n-th one).
create function public.collection_award()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_user uuid := new.user_id;
begin
  -- Verified evidence (all ever verified: removing a quote later does not undo the event).
  insert into public.collection_unlocks(user_id, collectible_id, source_event, source_id, investigation_id,
      discovery_id, material_id, material_title, subject_label, occurred_at)
  select v_user, r.id, 'evidence_verified', e.id, e.investigation_id, d.id, e.material_id, m.title, m.subject, e.created_at
  from (values ('stamp.first-evidence', 1), ('object.specimen-jar', 10)) r(id, n)
  cross join lateral (select * from public.investigation_evidence x where x.user_id = v_user
    order by x.created_at, x.id offset r.n - 1 limit 1) e
  join public.materials m on m.id = e.material_id
  left join public.discoveries d on d.id = e.investigation_id
  on conflict (user_id, collectible_id) do nothing;

  -- The student's own explanation.
  insert into public.collection_unlocks(user_id, collectible_id, source_event, source_id, investigation_id,
      discovery_id, material_id, material_title, subject_label, occurred_at)
  select v_user, 'stamp.own-explanation', 'explanation_written', i.id, i.id,
    case when i.status = 'completed' then i.id end, i.material_id, m.title, m.subject, i.explained_at
  from (select * from public.investigations x where x.user_id = v_user and x.explained_at is not null
    order by x.explained_at, x.id limit 1) i
  join public.materials m on m.id = i.material_id
  on conflict (user_id, collectible_id) do nothing;

  -- Completed investigations (the discovery shares the investigation id).
  insert into public.collection_unlocks(user_id, collectible_id, source_event, source_id, investigation_id,
      discovery_id, material_id, material_title, subject_label, occurred_at)
  select v_user, r.id, 'investigation_completed', i.id, i.id, i.id, i.material_id, m.title, m.subject, i.completed_at
  from (values ('stamp.first-investigation', 1), ('object.magnifying-glass', 3), ('object.desk-lamp', 5)) r(id, n)
  cross join lateral (select * from public.investigations x where x.user_id = v_user and x.status = 'completed'
    order by x.completed_at, x.id offset r.n - 1 limit 1) i
  join public.materials m on m.id = i.material_id
  on conflict (user_id, collectible_id) do nothing;

  -- A reflection with some substance (at least 20 characters).
  insert into public.collection_unlocks(user_id, collectible_id, source_event, source_id, investigation_id,
      discovery_id, material_id, material_title, subject_label, occurred_at)
  select v_user, 'stamp.first-reflection', 'reflection_written', f.id, d.investigation_id, d.id, d.material_id,
    m.title, d.subject_label, f.created_at
  from (select * from public.discovery_reflections x where x.user_id = v_user and char_length(btrim(x.text)) >= 20
    order by x.created_at, x.id limit 1) f
  join public.discoveries d on d.id = f.discovery_id
  join public.materials m on m.id = d.material_id
  on conflict (user_id, collectible_id) do nothing;

  -- Connections: the first one across two different subjects; the third of any kind.
  insert into public.collection_unlocks(user_id, collectible_id, source_event, source_id, investigation_id,
      discovery_id, material_id, material_title, subject_label, occurred_at)
  select v_user, 'stamp.connection', 'connection_made', c.id, d.investigation_id, d.id, d.material_id,
    m.title, d.subject_label, c.created_at
  from (select x.* from public.discovery_connections x
      join public.discoveries a on a.id = x.discovery_a
      join public.discoveries b on b.id = x.discovery_b
    where x.user_id = v_user and a.subject_key is not null and b.subject_key is not null and a.subject_key <> b.subject_key
    order by x.created_at, x.id limit 1) c
  join public.discoveries d on d.id = c.created_from
  join public.materials m on m.id = d.material_id
  on conflict (user_id, collectible_id) do nothing;
  insert into public.collection_unlocks(user_id, collectible_id, source_event, source_id, investigation_id,
      discovery_id, material_id, material_title, subject_label, occurred_at)
  select v_user, 'cover.matcha-linen', 'connection_made', c.id, d.investigation_id, d.id, d.material_id,
    m.title, d.subject_label, c.created_at
  from (select * from public.discovery_connections x where x.user_id = v_user
    order by x.created_at, x.id offset 2 limit 1) c
  join public.discoveries d on d.id = c.created_from
  join public.materials m on m.id = d.material_id
  on conflict (user_id, collectible_id) do nothing;

  -- Meaningful revisits (already limited to one per discovery and day, a day after recording it).
  insert into public.collection_unlocks(user_id, collectible_id, source_event, source_id, investigation_id,
      discovery_id, material_id, material_title, subject_label, occurred_at)
  select v_user, r.id, 'revisit_made', v.discovery_id, d.investigation_id, d.id, d.material_id, m.title,
    d.subject_label, v.created_at
  from (values ('stamp.revisit', 1), ('object.pressed-flower', 3)) r(id, n)
  cross join lateral (select * from public.discovery_revisits x where x.user_id = v_user
    order by x.created_at, x.discovery_id offset r.n - 1 limit 1) v
  join public.discoveries d on d.id = v.discovery_id
  join public.materials m on m.id = d.material_id
  on conflict (user_id, collectible_id) do nothing;

  -- Discoveries in three different subjects: the first discovery of the third subject.
  insert into public.collection_unlocks(user_id, collectible_id, source_event, source_id, investigation_id,
      discovery_id, material_id, material_title, subject_label, occurred_at)
  select v_user, 'object.globe', 'subjects_explored', d.id, d.investigation_id, d.id, d.material_id, m.title,
    d.subject_label, d.created_at
  from (select * from (select distinct on (x.subject_key) x.* from public.discoveries x
      where x.user_id = v_user and x.subject_key is not null order by x.subject_key, x.created_at, x.id) firsts
    order by created_at, id offset 2 limit 1) d
  join public.materials m on m.id = d.material_id
  on conflict (user_id, collectible_id) do nothing;
  return null;
end $$;

-- A change to a discovery at least one day after it was recorded is a meaningful revisit.
create function public.discovery_record_revisit()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_discovery uuid; v_kind text;
begin
  if tg_table_name = 'discovery_versions' then
    if new.version > 1 then v_discovery := new.discovery_id; v_kind := 'explanation'; end if;
  elsif tg_table_name = 'discovery_reflections' then
    v_discovery := new.discovery_id; v_kind := 'reflection';
  elsif tg_table_name = 'discovery_connections' then
    v_discovery := new.created_from; v_kind := 'connection';
  elsif tg_table_name = 'investigation_evidence' then
    v_discovery := new.investigation_id; v_kind := 'evidence';
  elsif tg_table_name = 'investigation_links' then
    v_discovery := new.investigation_id; v_kind := 'link';
  end if;
  if v_discovery is null then return null; end if;
  insert into public.discovery_revisits(discovery_id, revisit_day, user_id, kind)
  select d.id, (clock_timestamp() at time zone 'UTC')::date, d.user_id, v_kind
    from public.discoveries d
    where d.id = v_discovery and d.user_id = new.user_id and clock_timestamp() >= d.created_at + interval '1 day'
  on conflict (discovery_id, revisit_day) do nothing;
  return null;
end $$;

-- Nothing is ever lost: an unlock is never rewritten (account deletion still cascades).
create function public.collection_unlocks_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'COLLECTION_IMMUTABLE';
end $$;

create trigger collection_unlocks_immutable before update on public.collection_unlocks
for each row execute function public.collection_unlocks_immutable();
create trigger investigation_evidence_revisit after insert on public.investigation_evidence
for each row execute function public.discovery_record_revisit();
create trigger investigation_evidence_award after insert on public.investigation_evidence
for each row execute function public.collection_award();
create trigger investigations_award after update on public.investigations
for each row when (new.explained_at is distinct from old.explained_at or new.status is distinct from old.status)
execute function public.collection_award();
create trigger investigation_links_revisit after insert on public.investigation_links
for each row execute function public.discovery_record_revisit();
create trigger discovery_versions_revisit after insert on public.discovery_versions
for each row execute function public.discovery_record_revisit();
create trigger discovery_reflections_revisit after insert on public.discovery_reflections
for each row execute function public.discovery_record_revisit();
create trigger discovery_reflections_award after insert on public.discovery_reflections
for each row execute function public.collection_award();
create trigger discovery_connections_revisit after insert on public.discovery_connections
for each row execute function public.discovery_record_revisit();
create trigger discovery_connections_award after insert on public.discovery_connections
for each row execute function public.collection_award();
create trigger discoveries_award after insert on public.discoveries
for each row execute function public.collection_award();
create trigger discovery_revisits_award after insert on public.discovery_revisits
for each row execute function public.collection_award();

-- ---------------------------------------------------------------------------------------------
-- Rows as the API returns them
-- ---------------------------------------------------------------------------------------------
create function public.collection_unlock_row(p_row public.collection_unlocks)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p_row.collectible_id, 'kind', split_part(p_row.collectible_id, '.', 1),
    'event', p_row.source_event, 'sourceId', p_row.source_id, 'investigationId', p_row.investigation_id,
    'discoveryId', p_row.discovery_id, 'materialId', p_row.material_id, 'lessonTitle', p_row.material_title,
    'subject', p_row.subject_label, 'occurredAt', p_row.occurred_at, 'unlockedAt', p_row.unlocked_at,
    'ruleVersion', p_row.rule_version,
    -- The discovery the event led to, read live (evidence found before the discovery existed points
    -- to it once recorded; a discovery deleted with its lesson is gone, the memory stays).
    'currentDiscoveryId', (select d.id from public.discoveries d
      where d.user_id = p_row.user_id and d.id = coalesce(p_row.discovery_id, p_row.investigation_id)))
$$;

-- Items unlocked by the current transaction (what the interface may celebrate once).
create function public.collection_new_unlocks(p_user_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(public.collection_unlock_row(u) order by u.occurred_at, u.collectible_id), '[]'::jsonb)
  from public.collection_unlocks u where u.user_id = p_user_id and u.unlocked_at = now()
$$;

create function public.investigation_evidence_row(p_row public.investigation_evidence)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p_row.id, 'investigationId', p_row.investigation_id, 'materialId', p_row.material_id,
    'sourceRevisionId', p_row.source_revision_id, 'sourceRevision', p_row.source_revision,
    'segmentPosition', p_row.segment_position, 'endSegmentPosition', p_row.end_segment_position,
    'startOffset', p_row.start_offset, 'endOffset', p_row.end_offset, 'quote', p_row.quote, 'note', p_row.note,
    'startMs', p_row.start_ms, 'createdAt', p_row.created_at)
$$;

-- A reference read live from its own table (nothing is copied). Tables of features that are not
-- installed are skipped (the statement is only planned when its branch runs).
create function public.discovery_link_target(p_user_id uuid, p_kind text, p_ref uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v jsonb;
begin
  if p_kind = 'question' and to_regclass('public.quiz_session_answers') is not null then
    select jsonb_build_object('label', q.statement, 'materialId', b.material_id,
        'answeredAt', (select max(a.answered_at) from public.quiz_session_answers a where a.user_id = p_user_id and a.question_id = q.id))
      into v from public.questions q join public.question_batches b on b.id = q.batch_id
      join public.materials m on m.id = b.material_id and m.user_id = p_user_id
      where q.id = p_ref and exists (select 1 from public.quiz_session_answers a where a.user_id = p_user_id and a.question_id = q.id);
  elsif p_kind = 'flashcard' and to_regclass('public.study_flashcards') is not null then
    select jsonb_build_object('label', f.front_text, 'materialId', f.material_id)
      into v from public.study_flashcards f where f.id = p_ref and f.user_id = p_user_id;
  elsif p_kind = 'annotation' then
    select jsonb_build_object('label', case when a.quote <> '' then a.quote else a.note_text end,
        'note', a.note_text, 'materialId', a.material_id)
      into v from public.study_annotations a where a.id = p_ref and a.user_id = p_user_id and a.deleted_at is null;
  elsif p_kind = 'notebook' and to_regclass('public.study_notebooks') is not null then
    select jsonb_build_object('label', n.title, 'materialId', n.material_id)
      into v from public.study_notebooks n where n.id = p_ref and n.user_id = p_user_id;
  end if;
  return v;
end $$;

create function public.investigation_links_of(p_user_id uuid, p_investigation_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'refId', l.ref_id, 'createdAt', l.created_at,
      'target', public.discovery_link_target(p_user_id, l.kind, l.ref_id),
      'missing', public.discovery_link_target(p_user_id, l.kind, l.ref_id) is null) order by l.created_at, l.id), '[]'::jsonb)
  from public.investigation_links l where l.investigation_id = p_investigation_id and l.user_id = p_user_id
$$;

create function public.investigation_get_admin(p_user_id uuid, p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v public.investigations; m public.materials;
begin
  select * into v from public.investigations where id = p_id and user_id = p_user_id;
  if not found then raise exception 'DISCOVERY_NOT_FOUND'; end if;
  select * into m from public.materials where id = v.material_id;
  return jsonb_build_object(
    'investigation', jsonb_build_object('id', v.id, 'materialId', v.material_id,
      'sourceRevisionId', v.source_revision_id, 'sourceRevision', v.source_revision,
      'question', v.question, 'questionOrigin', v.question_origin, 'explanation', v.explanation,
      'reflection', v.reflection, 'explored', v.explored_at is not null, 'exploredAt', v.explored_at,
      'explainedAt', v.explained_at, 'status', v.status, 'completedAt', v.completed_at,
      'discoveryId', case when v.status = 'completed' then v.id end,
      'version', v.version, 'createdAt', v.created_at, 'updatedAt', v.updated_at),
    'lesson', jsonb_build_object('id', m.id, 'title', m.title, 'subject', m.subject),
    'evidence', coalesce((select jsonb_agg(public.investigation_evidence_row(e) order by e.created_at, e.id)
      from public.investigation_evidence e where e.investigation_id = v.id and e.removed_at is null), '[]'::jsonb),
    'links', public.investigation_links_of(p_user_id, v.id),
    'canComplete', v.status = 'open'
      and exists (select 1 from public.investigation_evidence e where e.investigation_id = v.id and e.removed_at is null)
      and char_length(btrim(v.explanation)) >= 20);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Investigation
-- ---------------------------------------------------------------------------------------------
-- The lesson as an investigation reads it: the latest revision the account confirmed (its frozen
-- segments), a few statements of the lesson's questions (to suggest questions without any AI
-- call) and the investigations already started on it.
create function public.investigation_source_admin(p_user_id uuid, p_material_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare m public.materials; v public.transcription_versions; v_id uuid; v_confirmed timestamptz;
begin
  select * into m from public.materials where id = p_material_id and user_id = p_user_id;
  if not found then raise exception 'DISCOVERY_NOT_FOUND'; end if;
  select tv.id, tc.confirmed_at into v_id, v_confirmed
    from public.transcription_confirmations tc
    join public.transcription_versions tv on tv.id = tc.transcription_version_id
    join public.transcriptions t on t.id = tv.transcription_id and t.material_id = p_material_id
    where tc.user_id = p_user_id and tc.material_id = p_material_id
    order by tv.revision desc, tc.confirmed_at desc limit 1;
  if v_id is null then raise exception 'DISCOVERY_REVISION_UNCONFIRMED'; end if;
  select * into v from public.transcription_versions where id = v_id;
  return jsonb_build_object(
    'lesson', jsonb_build_object('id', m.id, 'title', m.title, 'subject', m.subject),
    'revisionId', v.id, 'revision', v.revision, 'confirmedAt', v_confirmed,
    'segments', coalesce((select jsonb_agg(jsonb_build_object('position', (e->>'position')::integer,
        'startMs', (e->>'startMs')::bigint, 'endMs', (e->>'endMs')::bigint, 'text', coalesce(e->>'text', ''))
        order by (e->>'position')::integer)
      from jsonb_array_elements(v.segments_snapshot) e), '[]'::jsonb),
    'lessonQuestions', coalesce((select jsonb_agg(s.statement) from (select q.statement
        from public.questions q join public.question_batches b on b.id = q.batch_id
        where b.material_id = p_material_id order by b.created_at desc, q.position limit 6) s), '[]'::jsonb),
    'investigations', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'question', i.question, 'status', i.status,
        'updatedAt', i.updated_at, 'evidenceCount', (select count(*) from public.investigation_evidence e
          where e.investigation_id = i.id and e.removed_at is null)) order by i.updated_at desc)
      from public.investigations i where i.user_id = p_user_id and i.material_id = p_material_id), '[]'::jsonb));
end $$;

-- Creates (p_version = 0; body: materialId, sourceRevisionId, question, questionOrigin) or edits
-- (question, explanation, reflection, explored) an open investigation. A retry with the same
-- request id and body returns the saved state; with another body it fails.
create function public.investigation_save_admin(p_user_id uuid, p_id uuid, p_version integer, p_request_id uuid, p_body jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.investigations; v_hash text; v_material uuid; v_rev public.transcription_versions;
  v_question text; v_explanation text; v_reflection text;
begin
  if jsonb_typeof(coalesce(p_body, 'null'::jsonb)) <> 'object' or p_request_id is null then
    raise exception 'DISCOVERY_INVALID_INPUT';
  end if;
  v_hash := md5(p_body::text);
  select * into r from public.investigations where id = p_id for update;
  if found then
    if r.user_id <> p_user_id then raise exception 'DISCOVERY_NOT_FOUND'; end if;
    if r.last_request_id = p_request_id then
      if r.last_body_hash <> v_hash then raise exception 'DISCOVERY_REQUEST_CONFLICT'; end if;
      return public.investigation_get_admin(p_user_id, p_id) || jsonb_build_object('replayed', true, 'newUnlocks', '[]'::jsonb);
    end if;
    if r.version <> p_version then raise exception 'DISCOVERY_VERSION_CONFLICT'; end if;
    if r.status = 'completed' then raise exception 'DISCOVERY_INVESTIGATION_COMPLETED'; end if;
    if p_body ? 'materialId' and p_body->>'materialId' is distinct from r.material_id::text then
      raise exception 'DISCOVERY_INVALID_INPUT';
    end if;
    v_question := coalesce(p_body->>'question', r.question);
    v_explanation := coalesce(p_body->>'explanation', r.explanation);
    v_reflection := coalesce(p_body->>'reflection', r.reflection);
    if char_length(btrim(v_question)) not between 3 and 300 or char_length(v_explanation) > 5000
      or char_length(v_reflection) > 3000 then
      raise exception 'DISCOVERY_INVALID_INPUT';
    end if;
    update public.investigations set
        question = v_question,
        question_origin = coalesce(p_body->>'questionOrigin', question_origin),
        explanation = v_explanation,
        reflection = v_reflection,
        explored_at = case when (p_body->>'explored')::boolean is true then coalesce(explored_at, clock_timestamp()) else explored_at end,
        explained_at = coalesce(explained_at, case when char_length(btrim(v_explanation)) >= 20 then clock_timestamp() end),
        version = version + 1, last_request_id = p_request_id, last_body_hash = v_hash, updated_at = clock_timestamp()
      where id = p_id;
  else
    if p_version <> 0 then raise exception 'DISCOVERY_VERSION_CONFLICT'; end if;
    v_material := nullif(p_body->>'materialId', '')::uuid;
    -- Serializes investigations started on the same lesson (and checks ownership).
    perform 1 from public.materials where id = v_material and user_id = p_user_id for update;
    if not found then raise exception 'DISCOVERY_NOT_FOUND'; end if;
    if (select count(*) from public.investigations where user_id = p_user_id) >= 1000 then
      raise exception 'DISCOVERY_LIMIT';
    end if;
    select tv.* into v_rev from public.transcription_confirmations tc
      join public.transcription_versions tv on tv.id = tc.transcription_version_id
      join public.transcriptions t on t.id = tv.transcription_id and t.material_id = v_material
      where tc.user_id = p_user_id and tc.material_id = v_material
      order by tv.revision desc, tc.confirmed_at desc limit 1;
    if v_rev.id is null then raise exception 'DISCOVERY_REVISION_UNCONFIRMED'; end if;
    -- The page showed another revision (the lesson was confirmed again meanwhile).
    if p_body->>'sourceRevisionId' is distinct from v_rev.id::text then raise exception 'DISCOVERY_SOURCE_CHANGED'; end if;
    v_question := coalesce(p_body->>'question', '');
    v_explanation := coalesce(p_body->>'explanation', '');
    if char_length(btrim(v_question)) not between 3 and 300 or char_length(v_explanation) > 5000
      or char_length(coalesce(p_body->>'reflection', '')) > 3000 then
      raise exception 'DISCOVERY_INVALID_INPUT';
    end if;
    insert into public.investigations(id, user_id, material_id, source_revision_id, source_revision, question,
        question_origin, explanation, reflection, explored_at, explained_at, last_request_id, last_body_hash)
      values (p_id, p_user_id, v_material, v_rev.id, v_rev.revision, v_question,
        coalesce(p_body->>'questionOrigin', 'student'), v_explanation, coalesce(p_body->>'reflection', ''),
        case when (p_body->>'explored')::boolean is true then clock_timestamp() end, null, p_request_id, v_hash);
    -- explained_at goes through an update, so the award trigger sees it.
    if char_length(btrim(v_explanation)) >= 20 then
      update public.investigations set explained_at = clock_timestamp() where id = p_id;
    end if;
  end if;
  return public.investigation_get_admin(p_user_id, p_id)
    || jsonb_build_object('replayed', false, 'newUnlocks', public.collection_new_unlocks(p_user_id));
end $$;

-- Adds a quote of the investigation's confirmed revision as evidence. The quote must equal the
-- snapshot text from the start offset to the end offset (segments joined by a line break), exactly
-- like study_save_annotation_range_admin; anything else is refused. Also used on a discovery
-- (same id) when the student comes back with new evidence. Idempotent by evidence id.
create function public.investigation_add_evidence_admin(p_user_id uuid, p_investigation_id uuid, p_evidence_id uuid, p_body jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare i public.investigations; ex public.investigation_evidence; v public.transcription_versions;
  v_hash text; v_quote text; v_start integer; v_end integer; v_from integer; v_to integer;
  v_count integer; v_built text; v_ok boolean; v_ms bigint; v_note text;
begin
  if jsonb_typeof(coalesce(p_body, 'null'::jsonb)) <> 'object' or p_evidence_id is null then
    raise exception 'DISCOVERY_INVALID_INPUT';
  end if;
  select * into i from public.investigations where id = p_investigation_id and user_id = p_user_id for update;
  if not found then raise exception 'DISCOVERY_NOT_FOUND'; end if;
  v_hash := md5(p_body::text);
  select * into ex from public.investigation_evidence where id = p_evidence_id;
  if found then
    if ex.user_id <> p_user_id or ex.investigation_id <> p_investigation_id or ex.body_hash <> v_hash then
      raise exception 'DISCOVERY_REQUEST_CONFLICT';
    end if;
    return public.investigation_get_admin(p_user_id, p_investigation_id)
      || jsonb_build_object('replayed', true, 'evidenceId', ex.id, 'newUnlocks', '[]'::jsonb);
  end if;
  -- The revision must still be one the account confirmed.
  if not exists (select 1 from public.transcription_confirmations tc where tc.user_id = p_user_id
      and tc.material_id = i.material_id and tc.transcription_version_id = i.source_revision_id) then
    raise exception 'DISCOVERY_REVISION_UNCONFIRMED';
  end if;
  select * into v from public.transcription_versions where id = i.source_revision_id;
  v_quote := coalesce(p_body->>'quote', '');
  v_note := coalesce(p_body->>'note', '');
  if char_length(v_note) > 1000 or v_quote = '' or char_length(v_quote) > 1000 then
    raise exception 'DISCOVERY_INVALID_INPUT';
  end if;
  begin
    v_start := (p_body->>'segmentPosition')::integer;
    v_end := coalesce((p_body->>'endSegmentPosition')::integer, v_start);
    v_from := (p_body->>'startOffset')::integer;
    v_to := (p_body->>'endOffset')::integer;
  exception when others then
    raise exception 'DISCOVERY_ANCHOR_CONFLICT';
  end;
  if v_start is null or v_from is null or v_to is null or v_start < 0 or v_from < 0 or v_to < 1
    or v_end < v_start or v_end > v_start + 49 then
    raise exception 'DISCOVERY_ANCHOR_CONFLICT';
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
      else true end),
    min(s.ms) filter (where s.pos = v_start)
    into v_count, v_built, v_ok, v_ms
    from (select (e->>'position')::integer as pos, coalesce(e->>'text', '') as txt, (e->>'startMs')::bigint as ms
      from jsonb_array_elements(v.segments_snapshot) e) s
    where s.pos between v_start and v_end;
  if v_count <> v_end - v_start + 1 or not coalesce(v_ok, false) or v_built is distinct from v_quote then
    raise exception 'DISCOVERY_ANCHOR_CONFLICT';
  end if;
  if exists (select 1 from public.investigation_evidence e where e.investigation_id = i.id and e.removed_at is null
      and e.segment_position = v_start and e.start_offset = v_from and e.end_segment_position = v_end and e.end_offset = v_to) then
    raise exception 'DISCOVERY_EVIDENCE_DUPLICATE';
  end if;
  if (select count(*) from public.investigation_evidence e where e.investigation_id = i.id and e.removed_at is null) >= 30 then
    raise exception 'DISCOVERY_LIMIT';
  end if;
  insert into public.investigation_evidence(id, user_id, investigation_id, material_id, source_revision_id, source_revision,
      segment_position, end_segment_position, start_offset, end_offset, quote, note, start_ms, body_hash)
    values (p_evidence_id, p_user_id, i.id, i.material_id, v.id, v.revision, v_start, v_end, v_from, v_to, v_quote,
      v_note, v_ms, v_hash);
  update public.investigations set updated_at = clock_timestamp() where id = i.id;
  update public.discoveries set updated_at = clock_timestamp() where id = i.id;
  return public.investigation_get_admin(p_user_id, p_investigation_id)
    || jsonb_build_object('replayed', false, 'evidenceId', p_evidence_id, 'newUnlocks', public.collection_new_unlocks(p_user_id));
end $$;

-- Hides a piece of evidence (the row stays). A discovery keeps at least one.
create function public.investigation_remove_evidence_admin(p_user_id uuid, p_investigation_id uuid, p_evidence_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare i public.investigations; ex public.investigation_evidence;
begin
  select * into i from public.investigations where id = p_investigation_id and user_id = p_user_id for update;
  if not found then raise exception 'DISCOVERY_NOT_FOUND'; end if;
  select * into ex from public.investigation_evidence where id = p_evidence_id and investigation_id = i.id and user_id = p_user_id;
  if not found then raise exception 'DISCOVERY_NOT_FOUND'; end if;
  if ex.removed_at is null then
    if i.status = 'completed' and (select count(*) from public.investigation_evidence e
        where e.investigation_id = i.id and e.removed_at is null) <= 1 then
      raise exception 'DISCOVERY_EVIDENCE_REQUIRED';
    end if;
    update public.investigation_evidence set removed_at = clock_timestamp() where id = ex.id;
  end if;
  return public.investigation_get_admin(p_user_id, p_investigation_id) || jsonb_build_object('newUnlocks', '[]'::jsonb);
end $$;

-- Apply step: link (or unlink) something the student already has. Only the account's own items;
-- a question counts only once the account answered it. Idempotent.
create function public.investigation_link_admin(p_user_id uuid, p_investigation_id uuid, p_link_id uuid, p_kind text,
  p_ref_id uuid, p_remove boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare i public.investigations;
begin
  select * into i from public.investigations where id = p_investigation_id and user_id = p_user_id for update;
  if not found then raise exception 'DISCOVERY_NOT_FOUND'; end if;
  if p_kind is null or p_kind not in ('question', 'flashcard', 'annotation', 'notebook') or p_ref_id is null then
    raise exception 'DISCOVERY_INVALID_INPUT';
  end if;
  if coalesce(p_remove, false) then
    delete from public.investigation_links where investigation_id = i.id and kind = p_kind and ref_id = p_ref_id;
    return public.investigation_get_admin(p_user_id, p_investigation_id) || jsonb_build_object('newUnlocks', '[]'::jsonb);
  end if;
  if exists (select 1 from public.investigation_links where investigation_id = i.id and kind = p_kind and ref_id = p_ref_id) then
    return public.investigation_get_admin(p_user_id, p_investigation_id)
      || jsonb_build_object('replayed', true, 'newUnlocks', '[]'::jsonb);
  end if;
  if (p_kind = 'question' and to_regclass('public.quiz_session_answers') is null)
    or (p_kind = 'flashcard' and to_regclass('public.study_flashcards') is null)
    or (p_kind = 'notebook' and to_regclass('public.study_notebooks') is null) then
    raise exception 'DISCOVERY_LINK_UNAVAILABLE';
  end if;
  if public.discovery_link_target(p_user_id, p_kind, p_ref_id) is null then raise exception 'DISCOVERY_LINK_INVALID'; end if;
  if (select count(*) from public.investigation_links where investigation_id = i.id) >= 30 then
    raise exception 'DISCOVERY_LIMIT';
  end if;
  insert into public.investigation_links(id, user_id, investigation_id, kind, ref_id)
    values (coalesce(p_link_id, gen_random_uuid()), p_user_id, i.id, p_kind, p_ref_id);
  return public.investigation_get_admin(p_user_id, p_investigation_id)
    || jsonb_build_object('replayed', false, 'newUnlocks', public.collection_new_unlocks(p_user_id));
end $$;

-- What the account already has for this lesson and could link in the apply step.
create function public.investigation_link_options_admin(p_user_id uuid, p_investigation_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare i public.investigations; v_questions jsonb := '[]'; v_cards jsonb := '[]'; v_notes jsonb := '[]'; v_notebook jsonb;
begin
  select * into i from public.investigations where id = p_investigation_id and user_id = p_user_id;
  if not found then raise exception 'DISCOVERY_NOT_FOUND'; end if;
  if to_regclass('public.quiz_session_answers') is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'label', s.statement, 'answeredAt', s.answered_at)
        order by s.answered_at desc), '[]') into v_questions
      from (select q.id, q.statement, max(a.answered_at) as answered_at
        from public.quiz_session_answers a join public.questions q on q.id = a.question_id
        join public.question_batches b on b.id = q.batch_id
        where a.user_id = p_user_id and b.material_id = i.material_id group by q.id, q.statement
        order by max(a.answered_at) desc limit 50) s;
  end if;
  if to_regclass('public.study_flashcards') is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'label', f.front_text) order by f.created_at desc), '[]') into v_cards
      from (select * from public.study_flashcards x where x.user_id = p_user_id and x.material_id = i.material_id
        and x.status = 'active' order by x.created_at desc limit 50) f;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'label', case when a.quote <> '' then a.quote else a.note_text end,
      'note', a.note_text) order by a.created_at desc), '[]') into v_notes
    from (select * from public.study_annotations x where x.user_id = p_user_id and x.material_id = i.material_id
      and x.deleted_at is null order by x.created_at desc limit 50) a;
  if to_regclass('public.study_notebooks') is not null then
    select jsonb_build_object('id', n.id, 'label', n.title) into v_notebook
      from public.study_notebooks n where n.user_id = p_user_id and n.material_id = i.material_id;
  end if;
  return jsonb_build_object('questions', v_questions, 'flashcards', v_cards, 'annotations', v_notes,
    'notebooks', case when v_notebook is null then '[]'::jsonb else jsonb_build_array(v_notebook) end);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Discovery
-- ---------------------------------------------------------------------------------------------
create function public.discovery_get_admin(p_user_id uuid, p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare d public.discoveries; i public.investigations; m public.materials;
begin
  select * into d from public.discoveries where id = p_id and user_id = p_user_id;
  if not found then raise exception 'DISCOVERY_NOT_FOUND'; end if;
  select * into i from public.investigations where id = d.investigation_id;
  select * into m from public.materials where id = d.material_id;
  return jsonb_build_object(
    'discovery', jsonb_build_object('id', d.id, 'title', d.title, 'explanation', d.explanation, 'version', d.version,
      'subject', d.subject_label, 'materialId', d.material_id, 'createdAt', d.created_at, 'updatedAt', d.updated_at),
    'lesson', jsonb_build_object('id', m.id, 'title', m.title, 'subject', m.subject),
    'investigation', jsonb_build_object('id', i.id, 'question', i.question, 'questionOrigin', i.question_origin,
      'sourceRevisionId', i.source_revision_id, 'sourceRevision', i.source_revision, 'startedAt', i.created_at,
      'completedAt', i.completed_at),
    'evidence', coalesce((select jsonb_agg(public.investigation_evidence_row(e) order by e.created_at, e.id)
      from public.investigation_evidence e where e.investigation_id = i.id and e.removed_at is null), '[]'::jsonb),
    'links', public.investigation_links_of(p_user_id, i.id),
    'reflections', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'text', f.text, 'createdAt', f.created_at)
      order by f.created_at, f.id) from public.discovery_reflections f where f.discovery_id = d.id), '[]'::jsonb),
    'connections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'otherId', o.id, 'otherTitle', o.title,
        'otherSubject', o.subject_label, 'otherLessonTitle', om.title, 'note', c.note, 'createdAt', c.created_at,
        'acrossSubjects', d.subject_key is not null and o.subject_key is not null and d.subject_key <> o.subject_key)
        order by c.created_at, c.id)
      from public.discovery_connections c
      join public.discoveries o on o.id = case when c.discovery_a = d.id then c.discovery_b else c.discovery_a end
      join public.materials om on om.id = o.material_id
      where c.discovery_a = d.id or c.discovery_b = d.id), '[]'::jsonb),
    'revisits', coalesce((select jsonb_agg(jsonb_build_object('day', r.revisit_day, 'kind', r.kind, 'createdAt', r.created_at)
      order by r.revisit_day) from public.discovery_revisits r where r.discovery_id = d.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('version', h.version, 'title', h.title,
        'explanation', h.explanation, 'createdAt', h.created_at) order by h.version desc)
      from (select * from public.discovery_versions x where x.discovery_id = d.id order by x.version desc limit 20) h), '[]'::jsonb),
    'stamps', coalesce((select jsonb_agg(public.collection_unlock_row(u) order by u.occurred_at, u.collectible_id)
      from public.collection_unlocks u where u.user_id = p_user_id and coalesce(u.discovery_id, u.investigation_id) = d.id), '[]'::jsonb));
end $$;

-- Completes the investigation: question + at least one verified quote + the student's own
-- explanation (20 characters or more). Creates the discovery (same id), its first version and,
-- when written, the first reflection. Completing again returns the discovery.
create function public.investigation_complete_admin(p_user_id uuid, p_investigation_id uuid, p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare i public.investigations; m public.materials;
begin
  select * into i from public.investigations where id = p_investigation_id and user_id = p_user_id for update;
  if not found then raise exception 'DISCOVERY_NOT_FOUND'; end if;
  if i.status = 'completed' then
    return public.discovery_get_admin(p_user_id, i.id) || jsonb_build_object('replayed', true, 'newUnlocks', '[]'::jsonb);
  end if;
  if not exists (select 1 from public.investigation_evidence e where e.investigation_id = i.id and e.removed_at is null) then
    raise exception 'DISCOVERY_EVIDENCE_REQUIRED';
  end if;
  if char_length(btrim(i.explanation)) < 20 then raise exception 'DISCOVERY_EXPLANATION_REQUIRED'; end if;
  select * into m from public.materials where id = i.material_id;
  update public.investigations set status = 'completed', completed_at = clock_timestamp(), version = version + 1,
      last_request_id = coalesce(p_request_id, last_request_id), updated_at = clock_timestamp()
    where id = i.id;
  insert into public.discoveries(id, user_id, investigation_id, material_id, subject_key, subject_label, title,
      explanation, last_request_id, last_body_hash)
    values (i.id, p_user_id, i.id, i.material_id, nullif(lower(btrim(coalesce(m.subject, ''))), ''),
      nullif(btrim(coalesce(m.subject, '')), ''), btrim(i.question), i.explanation, coalesce(p_request_id, gen_random_uuid()), 'complete');
  insert into public.discovery_versions(discovery_id, version, user_id, title, explanation)
    values (i.id, 1, p_user_id, btrim(i.question), i.explanation);
  if btrim(i.reflection) <> '' then
    insert into public.discovery_reflections(id, user_id, discovery_id, text) values (gen_random_uuid(), p_user_id, i.id, i.reflection);
  end if;
  return public.discovery_get_admin(p_user_id, i.id)
    || jsonb_build_object('replayed', false, 'newUnlocks', public.collection_new_unlocks(p_user_id));
end $$;

create function public.discovery_list_admin(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'subject', d.subject_label,
      'materialId', d.material_id, 'lessonTitle', m.title, 'createdAt', d.created_at, 'updatedAt', d.updated_at,
      'version', d.version,
      'evidenceCount', (select count(*) from public.investigation_evidence e where e.investigation_id = d.id and e.removed_at is null),
      'connectionCount', (select count(*) from public.discovery_connections c where c.discovery_a = d.id or c.discovery_b = d.id),
      'revisitCount', (select count(*) from public.discovery_revisits r where r.discovery_id = d.id),
      'stamps', coalesce((select jsonb_agg(u.collectible_id order by u.occurred_at) from public.collection_unlocks u
        where u.user_id = p_user_id and coalesce(u.discovery_id, u.investigation_id) = d.id), '[]'::jsonb))
      order by d.updated_at desc, d.id), '[]'::jsonb)
  from (select * from public.discoveries x where x.user_id = p_user_id order by x.updated_at desc limit 500) d
  join public.materials m on m.id = d.material_id
$$;

-- Edits the discovery's title or explanation (optimistic version, replay by request id). Every
-- version is kept in discovery_versions.
create function public.discovery_update_admin(p_user_id uuid, p_id uuid, p_version integer, p_request_id uuid, p_body jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d public.discoveries; v_hash text; v_title text; v_explanation text;
begin
  if jsonb_typeof(coalesce(p_body, 'null'::jsonb)) <> 'object' or p_request_id is null then
    raise exception 'DISCOVERY_INVALID_INPUT';
  end if;
  select * into d from public.discoveries where id = p_id and user_id = p_user_id for update;
  if not found then raise exception 'DISCOVERY_NOT_FOUND'; end if;
  v_hash := md5(p_body::text);
  if d.last_request_id = p_request_id then
    if d.last_body_hash <> v_hash then raise exception 'DISCOVERY_REQUEST_CONFLICT'; end if;
    return public.discovery_get_admin(p_user_id, p_id) || jsonb_build_object('replayed', true, 'newUnlocks', '[]'::jsonb);
  end if;
  if d.version <> p_version then raise exception 'DISCOVERY_VERSION_CONFLICT'; end if;
  v_title := btrim(coalesce(p_body->>'title', d.title));
  v_explanation := coalesce(p_body->>'explanation', d.explanation);
  if char_length(v_title) not between 3 and 300 or char_length(btrim(v_explanation)) not between 20 and 5000 then
    raise exception 'DISCOVERY_INVALID_INPUT';
  end if;
  if d.version >= 500 then raise exception 'DISCOVERY_LIMIT'; end if;
  update public.discoveries set title = v_title, explanation = v_explanation, version = version + 1,
      last_request_id = p_request_id, last_body_hash = v_hash, updated_at = clock_timestamp()
    where id = p_id;
  insert into public.discovery_versions(discovery_id, version, user_id, title, explanation)
    values (p_id, d.version + 1, p_user_id, v_title, v_explanation);
  return public.discovery_get_admin(p_user_id, p_id)
    || jsonb_build_object('replayed', false, 'newUnlocks', public.collection_new_unlocks(p_user_id));
end $$;

create function public.discovery_add_reflection_admin(p_user_id uuid, p_id uuid, p_reflection_id uuid, p_text text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d public.discoveries; f public.discovery_reflections;
begin
  select * into d from public.discoveries where id = p_id and user_id = p_user_id for update;
  if not found then raise exception 'DISCOVERY_NOT_FOUND'; end if;
  if p_reflection_id is null or char_length(btrim(coalesce(p_text, ''))) not between 1 and 3000 then
    raise exception 'DISCOVERY_INVALID_INPUT';
  end if;
  select * into f from public.discovery_reflections where id = p_reflection_id;
  if found then
    if f.user_id <> p_user_id or f.discovery_id <> p_id or f.text <> p_text then raise exception 'DISCOVERY_REQUEST_CONFLICT'; end if;
    return public.discovery_get_admin(p_user_id, p_id) || jsonb_build_object('replayed', true, 'newUnlocks', '[]'::jsonb);
  end if;
  if (select count(*) from public.discovery_reflections where discovery_id = p_id) >= 100 then raise exception 'DISCOVERY_LIMIT'; end if;
  insert into public.discovery_reflections(id, user_id, discovery_id, text) values (p_reflection_id, p_user_id, p_id, p_text);
  update public.discoveries set updated_at = clock_timestamp() where id = p_id;
  return public.discovery_get_admin(p_user_id, p_id)
    || jsonb_build_object('replayed', false, 'newUnlocks', public.collection_new_unlocks(p_user_id));
end $$;

-- Connects two of the account's discoveries (any subjects). Stored once per pair; connecting an
-- existing pair again returns it.
create function public.discovery_connect_admin(p_user_id uuid, p_id uuid, p_connection_id uuid, p_other_id uuid, p_note text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_a uuid; v_b uuid; v_count integer;
begin
  if p_connection_id is null or p_other_id is null or char_length(coalesce(p_note, '')) > 500 then
    raise exception 'DISCOVERY_INVALID_INPUT';
  end if;
  if p_other_id = p_id then raise exception 'DISCOVERY_CONNECTION_INVALID'; end if;
  v_a := least(p_id, p_other_id);
  v_b := greatest(p_id, p_other_id);
  -- Both owned; locked in id order (no deadlock between two people connecting from either side).
  select count(*) into v_count from (select 1 from public.discoveries where id in (v_a, v_b) and user_id = p_user_id
    order by id for update) locked;
  if v_count <> 2 then raise exception 'DISCOVERY_NOT_FOUND'; end if;
  if exists (select 1 from public.discovery_connections where discovery_a = v_a and discovery_b = v_b) then
    return public.discovery_get_admin(p_user_id, p_id) || jsonb_build_object('replayed', true, 'newUnlocks', '[]'::jsonb);
  end if;
  if exists (select 1 from public.discovery_connections where id = p_connection_id) then
    raise exception 'DISCOVERY_REQUEST_CONFLICT';
  end if;
  if (select count(*) from public.discovery_connections where discovery_a = p_id or discovery_b = p_id) >= 50 then
    raise exception 'DISCOVERY_LIMIT';
  end if;
  insert into public.discovery_connections(id, user_id, discovery_a, discovery_b, created_from, note)
    values (p_connection_id, p_user_id, v_a, v_b, p_id, coalesce(p_note, ''));
  update public.discoveries set updated_at = clock_timestamp() where id in (v_a, v_b);
  return public.discovery_get_admin(p_user_id, p_id)
    || jsonb_build_object('replayed', false, 'newUnlocks', public.collection_new_unlocks(p_user_id));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Gabinete and desk
-- ---------------------------------------------------------------------------------------------
create function public.collection_get_admin(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'catalog', public.collection_catalog(),
    'slots', to_jsonb(public.desk_slots()),
    'unlocks', coalesce((select jsonb_agg(public.collection_unlock_row(u) order by u.occurred_at, u.collectible_id)
      from public.collection_unlocks u where u.user_id = p_user_id), '[]'::jsonb),
    'layout', coalesce((select jsonb_build_object('items', l.items, 'version', l.version, 'updatedAt', l.updated_at)
      from public.desk_layouts l where l.user_id = p_user_id), jsonb_build_object('items', '[]'::jsonb, 'version', 0)),
    'counts', jsonb_build_object(
      'investigations', (select count(*) from public.investigations i where i.user_id = p_user_id and i.status = 'completed'),
      'evidence', (select count(*) from public.investigation_evidence e where e.user_id = p_user_id),
      'revisits', (select count(*) from public.discovery_revisits r where r.user_id = p_user_id),
      'connections', (select count(*) from public.discovery_connections c where c.user_id = p_user_id)))
$$;

-- Places unlocked desk objects: [{slot, objectId}], at most one object per slot and one slot per
-- object; only object.* items the account unlocked. Optimistic version, replay by request id.
create function public.desk_layout_save_admin(p_user_id uuid, p_version integer, p_request_id uuid, p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare l public.desk_layouts; v_hash text; v_items jsonb := '[]'::jsonb; x jsonb; v_slots text[] := '{}'; v_objects text[] := '{}';
begin
  if p_request_id is null or jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_items) > 8 then
    raise exception 'COLLECTION_LAYOUT_INVALID';
  end if;
  v_hash := md5(p_items::text);
  -- Serializes saves of the same account (the first save creates the row).
  perform pg_advisory_xact_lock(hashtextextended('desk_layout:' || p_user_id::text, 0));
  select * into l from public.desk_layouts where user_id = p_user_id for update;
  if found and l.last_request_id = p_request_id then
    if l.last_body_hash <> v_hash then raise exception 'DISCOVERY_REQUEST_CONFLICT'; end if;
    return public.collection_get_admin(p_user_id) || jsonb_build_object('replayed', true);
  end if;
  if coalesce(l.version, 0) <> p_version then raise exception 'DISCOVERY_VERSION_CONFLICT'; end if;
  for x in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(x) <> 'object' then raise exception 'COLLECTION_LAYOUT_INVALID'; end if;
    if jsonb_typeof(x->'slot') is distinct from 'string' or jsonb_typeof(x->'objectId') is distinct from 'string'
      or (select count(*) from jsonb_object_keys(x)) <> 2
      or not (x->>'slot' = any (public.desk_slots())) or x->>'objectId' !~ '^object\.[a-z0-9]+(-[a-z0-9]+)*$'
      or x->>'slot' = any (v_slots) or x->>'objectId' = any (v_objects) then
      raise exception 'COLLECTION_LAYOUT_INVALID';
    end if;
    if not exists (select 1 from public.collection_unlocks u where u.user_id = p_user_id and u.collectible_id = x->>'objectId') then
      raise exception 'COLLECTION_NOT_UNLOCKED';
    end if;
    v_slots := v_slots || (x->>'slot');
    v_objects := v_objects || (x->>'objectId');
    v_items := v_items || jsonb_build_array(jsonb_build_object('slot', x->>'slot', 'objectId', x->>'objectId'));
  end loop;
  if l.user_id is null then
    insert into public.desk_layouts(user_id, items, last_request_id, last_body_hash) values (p_user_id, v_items, p_request_id, v_hash);
  else
    update public.desk_layouts set items = v_items, version = version + 1, last_request_id = p_request_id,
      last_body_hash = v_hash, updated_at = clock_timestamp() where user_id = p_user_id;
  end if;
  return public.collection_get_admin(p_user_id) || jsonb_build_object('replayed', false);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: nothing for browsers. Server functions for service_role only.
-- ---------------------------------------------------------------------------------------------
alter table public.investigations enable row level security;
alter table public.investigation_evidence enable row level security;
alter table public.investigation_links enable row level security;
alter table public.discoveries enable row level security;
alter table public.discovery_versions enable row level security;
alter table public.discovery_reflections enable row level security;
alter table public.discovery_connections enable row level security;
alter table public.discovery_revisits enable row level security;
alter table public.collection_unlocks enable row level security;
alter table public.desk_layouts enable row level security;
-- Only effective if a deployment ever grants SELECT to browsers; this migration does not.
create policy investigations_select_own on public.investigations for select to authenticated using (user_id = (select auth.uid()));
create policy discoveries_select_own on public.discoveries for select to authenticated using (user_id = (select auth.uid()));
create policy collection_unlocks_select_own on public.collection_unlocks for select to authenticated using (user_id = (select auth.uid()));
revoke all on table public.investigations, public.investigation_evidence, public.investigation_links, public.discoveries,
  public.discovery_versions, public.discovery_reflections, public.discovery_connections, public.discovery_revisits,
  public.collection_unlocks, public.desk_layouts
  from public, anon, authenticated;
grant select, insert, update, delete on table public.investigations, public.investigation_evidence, public.investigation_links,
  public.discoveries, public.discovery_versions, public.discovery_reflections, public.discovery_connections,
  public.discovery_revisits, public.desk_layouts
  to service_role;
-- Unlocks: the server reads them and the triggers insert them; never updated (trigger) by anyone.
-- Explicit, because hosted projects may grant everything to service_role by default privileges.
revoke update, delete, truncate on table public.collection_unlocks from service_role;
grant select, insert on table public.collection_unlocks to service_role;
revoke all on function
  public.collection_catalog(), public.desk_slots(), public.collection_award(), public.discovery_record_revisit(),
  public.collection_unlocks_immutable(), public.collection_unlock_row(public.collection_unlocks),
  public.collection_new_unlocks(uuid), public.investigation_evidence_row(public.investigation_evidence),
  public.discovery_link_target(uuid,text,uuid), public.investigation_links_of(uuid,uuid),
  public.investigation_get_admin(uuid,uuid), public.investigation_source_admin(uuid,uuid),
  public.investigation_save_admin(uuid,uuid,integer,uuid,jsonb),
  public.investigation_add_evidence_admin(uuid,uuid,uuid,jsonb), public.investigation_remove_evidence_admin(uuid,uuid,uuid),
  public.investigation_link_admin(uuid,uuid,uuid,text,uuid,boolean), public.investigation_link_options_admin(uuid,uuid),
  public.discovery_get_admin(uuid,uuid), public.investigation_complete_admin(uuid,uuid,uuid), public.discovery_list_admin(uuid),
  public.discovery_update_admin(uuid,uuid,integer,uuid,jsonb), public.discovery_add_reflection_admin(uuid,uuid,uuid,text),
  public.discovery_connect_admin(uuid,uuid,uuid,uuid,text), public.collection_get_admin(uuid),
  public.desk_layout_save_admin(uuid,integer,uuid,jsonb)
  from public, anon, authenticated;
-- The award and revisit trigger functions are NOT granted: nothing can call them directly.
revoke all on function public.collection_award(), public.discovery_record_revisit(),
  public.collection_unlocks_immutable() from service_role;
-- Read helpers used inside the server functions (they only read the given account's rows).
grant execute on function
  public.collection_catalog(), public.desk_slots(), public.collection_unlock_row(public.collection_unlocks),
  public.collection_new_unlocks(uuid), public.investigation_evidence_row(public.investigation_evidence),
  public.discovery_link_target(uuid,text,uuid), public.investigation_links_of(uuid,uuid),
  public.investigation_get_admin(uuid,uuid), public.investigation_source_admin(uuid,uuid),
  public.investigation_save_admin(uuid,uuid,integer,uuid,jsonb),
  public.investigation_add_evidence_admin(uuid,uuid,uuid,jsonb), public.investigation_remove_evidence_admin(uuid,uuid,uuid),
  public.investigation_link_admin(uuid,uuid,uuid,text,uuid,boolean), public.investigation_link_options_admin(uuid,uuid),
  public.discovery_get_admin(uuid,uuid), public.investigation_complete_admin(uuid,uuid,uuid), public.discovery_list_admin(uuid),
  public.discovery_update_admin(uuid,uuid,integer,uuid,jsonb), public.discovery_add_reflection_admin(uuid,uuid,uuid,text),
  public.discovery_connect_admin(uuid,uuid,uuid,uuid,text), public.collection_get_admin(uuid),
  public.desk_layout_save_admin(uuid,integer,uuid,jsonb)
  to service_role;
commit;
