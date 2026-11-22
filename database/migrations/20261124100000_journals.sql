-- Voz em Estudo 3.6, Milestone D: Diário de estudo (personal study journals made of scrapbook pages).
-- MIGRATION CANDIDATE, NOT APPLIED. STAGING ONLY until validated: it is not part of any release
-- manifest. Apply only with backup, database/checks/journals-preflight.sql, explicit approval and
-- the correct environment; then run database/checks/journals-postflight.sql and enable
-- FEATURE_JOURNAL. Rollback: database/rollback/journals-rollback.md. Guide: docs/migrations/JOURNALS.md.
--
-- Additive only: two new tables and new functions. No existing table, column, constraint, function
-- or row is changed.
--
-- A journal (cover, default paper, title) holds pages. A page has a template (a small set of
-- layouts), a paper, a title, plain-text content, decorations placed by the student (stickers,
-- washi tape, frames, dividers, labels and, only once found in the Gabinete, stamps) and links to
-- the student's own lessons and discoveries. Nothing here copies transcript text: a quote on a page
-- must keep the link to its source. Private to the account; server only (service_role).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
declare v_missing text[] := '{}';
begin
  if to_regclass('public.materials') is null then
    v_missing := array_append(v_missing, 'tabela materials (001_initial.sql)');
  end if;
  if to_regclass('auth.users') is null then
    v_missing := array_append(v_missing, 'auth.users');
  end if;
  if cardinality(v_missing) > 0 then
    raise exception 'JOURNALS_ABORT: faltam pré-requisitos: %', array_to_string(v_missing, '; ');
  end if;
  if to_regclass('public.journals') is not null or to_regclass('public.journal_pages') is not null then
    raise exception 'JOURNALS_ABORT: estruturas do diario ja existem; nao reaplicar';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------------------------
-- Tables (server-only; RLS on, nothing granted to browsers)
-- ---------------------------------------------------------------------------------------------
create table public.journals (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  -- Art manifest id of the cover (frontend/js/art/manifest.js); art is resolved by id elsewhere.
  cover text not null check (cover ~ '^cover\.[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Paper of new pages.
  paper text not null default 'ruled'
    check (paper in ('ruled', 'grid', 'dot', 'kraft', 'linen', 'vellum', 'aged')),
  version integer not null default 1 check (version >= 1),
  last_request_id uuid not null,
  last_body_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Removed by the student (kept, never shown; see the rollback guide for a hard delete).
  deleted_at timestamptz,
  constraint journals_id_owner_unique unique (id, user_id)
);
create index journals_user_idx on public.journals(user_id, created_at) where deleted_at is null;

create table public.journal_pages (
  id uuid primary key,
  journal_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null check (position between 0 and 9999),
  template text not null check (template in ('ruled', 'collage', 'concept', 'timeline', 'free')),
  paper text not null check (paper in ('ruled', 'grid', 'dot', 'kraft', 'linen', 'vellum', 'aged')),
  title text not null default '' check (char_length(title) <= 120),
  -- Plain text only, shaped by the template (backend validator); checked again by the functions.
  content jsonb not null default '{}'::jsonb
    check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 24000),
  -- [{id, art, x, y, rotation, scale}], x/y in % of the page.
  decorations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(decorations) = 'array' and jsonb_array_length(decorations) <= 24),
  -- [{kind: 'lesson'|'discovery', id}]: own lessons and discoveries, by reference only.
  links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 6),
  version integer not null default 1 check (version >= 1),
  last_request_id uuid not null,
  last_body_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint journal_pages_journal_owner_fk foreign key (journal_id, user_id)
    references public.journals(id, user_id) on delete cascade
);
create index journal_pages_journal_idx on public.journal_pages(journal_id, position) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Rows as the API returns them
-- ---------------------------------------------------------------------------------------------
create function public.journal_row(j public.journals)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', j.id, 'title', j.title, 'cover', j.cover, 'paper', j.paper,
    'version', j.version, 'createdAt', j.created_at, 'updatedAt', j.updated_at,
    'pageCount', (select count(*) from public.journal_pages p where p.journal_id = j.id and p.deleted_at is null))
$$;

create function public.journal_page_row(p public.journal_pages)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'journalId', p.journal_id, 'position', p.position,
    'template', p.template, 'paper', p.paper, 'title', p.title, 'content', p.content,
    'decorations', p.decorations, 'links', p.links, 'version', p.version, 'updatedAt', p.updated_at)
$$;

-- Title (and subject) of a linked lesson or discovery of the account; null when it is gone.
create function public.journal_link_target(p_user_id uuid, p_kind text, p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v jsonb;
begin
  if p_kind = 'lesson' then
    select jsonb_build_object('kind', 'lesson', 'id', m.id, 'title', m.title, 'subject', m.subject) into v
      from public.materials m where m.id = p_id and m.user_id = p_user_id;
  elsif p_kind = 'discovery' and to_regclass('public.discoveries') is not null then
    execute 'select jsonb_build_object(''kind'', ''discovery'', ''id'', d.id, ''title'', d.title, ''subject'', d.subject_label)
      from public.discoveries d where d.id = $1 and d.user_id = $2' into v using p_id, p_user_id;
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Validation of decorations, links and content (raise on the first problem)
-- ---------------------------------------------------------------------------------------------
-- Decorations: at most 24; ids from the allowlist pattern; x and y within the page (0–100 %),
-- rotation within ±180°, scale 0.4–2.5. Stamps only once the account found them (Gabinete).
-- Returns the items with numbers rounded to two decimals.
create function public.journal_check_decorations(p_user_id uuid, p_items jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare x jsonb; v_out jsonb := '[]'::jsonb; v_ids text[] := '{}'; v_ok boolean;
begin
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' then raise exception 'JOURNAL_DECORATION_INVALID'; end if;
  if jsonb_array_length(p_items) > 24 then raise exception 'JOURNAL_LIMIT'; end if;
  for x in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(x) <> 'object' or (select count(*) from jsonb_object_keys(x)) <> 6
      or jsonb_typeof(x->'id') is distinct from 'string' or x->>'id' !~ '^[A-Za-z0-9_-]{1,40}$'
      or x->>'id' = any (v_ids)
      or jsonb_typeof(x->'art') is distinct from 'string'
      or x->>'art' !~ '^(sticker|tape|stamp|frame|divider|label)\.[a-z0-9]+(-[a-z0-9]+)*$'
      or jsonb_typeof(x->'x') is distinct from 'number' or jsonb_typeof(x->'y') is distinct from 'number'
      or jsonb_typeof(x->'rotation') is distinct from 'number' or jsonb_typeof(x->'scale') is distinct from 'number' then
      raise exception 'JOURNAL_DECORATION_INVALID';
    end if;
    if (x->>'x')::numeric not between 0 and 100 or (x->>'y')::numeric not between 0 and 100
      or (x->>'rotation')::numeric not between -180 and 180 or (x->>'scale')::numeric not between 0.4 and 2.5 then
      raise exception 'JOURNAL_DECORATION_INVALID';
    end if;
    if x->>'art' like 'stamp.%' then
      v_ok := false;
      if to_regclass('public.collection_unlocks') is not null then
        execute 'select exists (select 1 from public.collection_unlocks u where u.user_id = $1 and u.collectible_id = $2)'
          into v_ok using p_user_id, x->>'art';
      end if;
      if not v_ok then raise exception 'JOURNAL_DECORATION_LOCKED'; end if;
    end if;
    v_ids := v_ids || (x->>'id');
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', x->>'id', 'art', x->>'art',
      'x', round((x->>'x')::numeric, 2), 'y', round((x->>'y')::numeric, 2),
      'rotation', round((x->>'rotation')::numeric, 1), 'scale', round((x->>'scale')::numeric, 2)));
  end loop;
  return v_out;
end $$;

-- Links: at most 6 distinct {kind, id}; each must be the account's own lesson or discovery.
create function public.journal_check_links(p_user_id uuid, p_links jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare x jsonb; v_out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(coalesce(p_links, 'null'::jsonb)) <> 'array' then raise exception 'JOURNAL_LINK_INVALID'; end if;
  if jsonb_array_length(p_links) > 6 then raise exception 'JOURNAL_LIMIT'; end if;
  for x in select value from jsonb_array_elements(p_links) loop
    if jsonb_typeof(x) <> 'object' or (select count(*) from jsonb_object_keys(x)) <> 2
      or x->>'kind' is null or x->>'kind' not in ('lesson', 'discovery')
      or jsonb_typeof(x->'id') is distinct from 'string'
      or x->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'JOURNAL_LINK_INVALID';
    end if;
    x := jsonb_build_object('kind', x->>'kind', 'id', lower(x->>'id'));
    if v_out @> jsonb_build_array(x) or public.journal_link_target(p_user_id, x->>'kind', (x->>'id')::uuid) is null then
      raise exception 'JOURNAL_LINK_INVALID';
    end if;
    v_out := v_out || jsonb_build_array(x);
  end loop;
  return v_out;
end $$;

-- Content: an object of plain strings, numbers, booleans, arrays and objects (the backend checks
-- the template's shape). No string may contain an HTML tag opener. Collage art ids follow the
-- allowlist. A quote keeps its source: `quote.source` must be one of the page's links.
create function public.journal_check_content(p_content jsonb, p_links jsonb)
returns void language plpgsql immutable security invoker set search_path = '' as $$
begin
  if jsonb_typeof(coalesce(p_content, 'null'::jsonb)) <> 'object' then raise exception 'JOURNAL_INVALID'; end if;
  if octet_length(p_content::text) > 24000 then raise exception 'JOURNAL_TOO_LARGE'; end if;
  if jsonb_path_exists(p_content, '$.** ? (@.type() == "string" && @ like_regex "<[/]?[a-zA-Z!?]")') then
    raise exception 'JOURNAL_INVALID';
  end if;
  if jsonb_path_exists(p_content, '$.photos[*].art ? (@.type() != "null" && !(@ like_regex "^sticker\\.[a-z0-9]+(-[a-z0-9]+)*$"))')
    or jsonb_path_exists(p_content, '$.photos[*].frame ? (!(@ like_regex "^frame\\.[a-z0-9]+(-[a-z0-9]+)*$"))') then
    raise exception 'JOURNAL_DECORATION_INVALID';
  end if;
  if coalesce(btrim(p_content->'quote'->>'text'), '') <> '' then
    if jsonb_typeof(p_content->'quote'->'source') is distinct from 'object'
      or not (coalesce(p_links, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object(
        'kind', p_content->'quote'->'source'->>'kind', 'id', lower(p_content->'quote'->'source'->>'id')))) then
      raise exception 'JOURNAL_QUOTE_SOURCE_REQUIRED';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------------------------
create function public.journal_list_admin(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('journals', coalesce((select jsonb_agg(public.journal_row(j) order by j.created_at, j.id)
    from public.journals j where j.user_id = p_user_id and j.deleted_at is null), '[]'::jsonb))
$$;

-- One journal with its pages (in order) and the titles of everything its pages link to.
create function public.journal_get_admin(p_user_id uuid, p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare j public.journals; v_pages jsonb; v_targets jsonb;
begin
  select * into j from public.journals where id = p_id and user_id = p_user_id and deleted_at is null;
  if not found then raise exception 'JOURNAL_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(public.journal_page_row(p) order by p.position, p.created_at, p.id), '[]'::jsonb) into v_pages
    from public.journal_pages p where p.journal_id = j.id and p.deleted_at is null;
  select coalesce(jsonb_agg(t.target), '[]'::jsonb) into v_targets from (
    select distinct on (l->>'kind', l->>'id') public.journal_link_target(p_user_id, l->>'kind', (l->>'id')::uuid) as target
      from public.journal_pages p, jsonb_array_elements(p.links) l
      where p.journal_id = j.id and p.deleted_at is null) t
    where t.target is not null;
  return jsonb_build_object('journal', public.journal_row(j), 'pages', v_pages, 'linkTargets', v_targets);
end $$;

-- What a page can link to: the account's lessons (newest first) and, when the Arquivo exists, its
-- discoveries. Titles only; never transcript text.
create function public.journal_link_options_admin(p_user_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_lessons jsonb; v_discoveries jsonb := '[]'::jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'lesson', 'id', m.id, 'title', m.title, 'subject', m.subject)
    order by m.created_at desc), '[]'::jsonb) into v_lessons
    from (select * from public.materials where user_id = p_user_id order by created_at desc limit 200) m;
  if to_regclass('public.discoveries') is not null then
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''kind'', ''discovery'', ''id'', d.id, ''title'', d.title,
        ''subject'', d.subject_label) order by d.created_at desc), ''[]''::jsonb)
      from (select * from public.discoveries where user_id = $1 order by created_at desc limit 200) d'
      into v_discoveries using p_user_id;
  end if;
  return jsonb_build_object('lessons', v_lessons, 'discoveries', v_discoveries);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Writing (optimistic version + request id: a retry with the same id and body is a replay)
-- ---------------------------------------------------------------------------------------------
-- Creates (p_version = 0: title and cover required) or edits a journal: title, cover, paper,
-- deleted. At most 24 journals per account.
create function public.journal_save_admin(p_user_id uuid, p_id uuid, p_version integer, p_request_id uuid, p_body jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare j public.journals; v_hash text; v_title text; v_cover text; v_paper text;
begin
  if p_request_id is null or jsonb_typeof(coalesce(p_body, 'null'::jsonb)) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_body) k where k not in ('title', 'cover', 'paper', 'deleted'))
    or (p_body ? 'deleted' and jsonb_typeof(p_body->'deleted') <> 'boolean') then
    raise exception 'JOURNAL_INVALID';
  end if;
  v_hash := md5(p_body::text);
  -- Serializes writers of the same account (creation counts toward the limit).
  perform pg_advisory_xact_lock(hashtextextended('journals:' || p_user_id::text, 0));
  select * into j from public.journals where id = p_id for update;
  if found and j.user_id <> p_user_id then raise exception 'JOURNAL_NOT_FOUND'; end if;
  if found and j.last_request_id = p_request_id then
    if j.last_body_hash <> v_hash then raise exception 'JOURNAL_REQUEST_CONFLICT'; end if;
    return jsonb_build_object('journal', public.journal_row(j), 'replayed', true);
  end if;
  if found and j.deleted_at is not null then raise exception 'JOURNAL_NOT_FOUND'; end if;
  if (found and j.version <> p_version) or (not found and p_version <> 0) then
    raise exception 'JOURNAL_VERSION_CONFLICT';
  end if;
  v_title := coalesce(p_body->>'title', j.title);
  v_cover := coalesce(p_body->>'cover', j.cover);
  v_paper := coalesce(p_body->>'paper', j.paper, 'ruled');
  if v_title is null or char_length(btrim(v_title)) not between 1 and 80 or v_title ~ '<[/]?[a-zA-Z!?]'
    or v_cover is null or v_cover !~ '^cover\.[a-z0-9]+(-[a-z0-9]+)*$'
    or v_paper not in ('ruled', 'grid', 'dot', 'kraft', 'linen', 'vellum', 'aged') then
    raise exception 'JOURNAL_INVALID';
  end if;
  if j.id is null then
    if (select count(*) from public.journals where user_id = p_user_id and deleted_at is null) >= 24 then
      raise exception 'JOURNAL_LIMIT';
    end if;
    insert into public.journals(id, user_id, title, cover, paper, last_request_id, last_body_hash)
    values (p_id, p_user_id, btrim(v_title), v_cover, v_paper, p_request_id, v_hash) returning * into j;
  else
    update public.journals set title = btrim(v_title), cover = v_cover, paper = v_paper, version = version + 1,
      deleted_at = case when coalesce((p_body->>'deleted')::boolean, false) then clock_timestamp() else null end,
      last_request_id = p_request_id, last_body_hash = v_hash, updated_at = clock_timestamp()
      where id = p_id returning * into j;
  end if;
  return jsonb_build_object('journal', public.journal_row(j), 'replayed', false);
end $$;

-- Creates (p_version = 0: template required; added at the end) or edits a page: title, paper,
-- content, decorations, links, position, deleted. The template never changes. At most 120 pages.
create function public.journal_page_save_admin(p_user_id uuid, p_journal_id uuid, p_page_id uuid, p_version integer,
  p_request_id uuid, p_body jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare j public.journals; p public.journal_pages; v_hash text; v_links jsonb; v_decorations jsonb; v_content jsonb;
  v_title text; v_paper text; v_template text; v_position integer;
begin
  if p_request_id is null or jsonb_typeof(coalesce(p_body, 'null'::jsonb)) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_body) k
      where k not in ('template', 'title', 'paper', 'content', 'decorations', 'links', 'position', 'deleted'))
    or (p_body ? 'deleted' and jsonb_typeof(p_body->'deleted') <> 'boolean')
    or (p_body ? 'position' and jsonb_typeof(p_body->'position') <> 'number') then
    raise exception 'JOURNAL_INVALID';
  end if;
  v_hash := md5(p_body::text);
  -- Serializes writers of the same journal (positions, the page limit).
  select * into j from public.journals where id = p_journal_id and user_id = p_user_id and deleted_at is null for update;
  if not found then raise exception 'JOURNAL_NOT_FOUND'; end if;
  select * into p from public.journal_pages where id = p_page_id for update;
  if found and (p.user_id <> p_user_id or p.journal_id <> p_journal_id) then raise exception 'JOURNAL_NOT_FOUND'; end if;
  if found and p.last_request_id = p_request_id then
    if p.last_body_hash <> v_hash then raise exception 'JOURNAL_REQUEST_CONFLICT'; end if;
    return jsonb_build_object('page', public.journal_page_row(p), 'journal', public.journal_row(j), 'replayed', true);
  end if;
  if found and p.deleted_at is not null then raise exception 'JOURNAL_NOT_FOUND'; end if;
  if (found and p.version <> p_version) or (not found and p_version <> 0) then
    raise exception 'JOURNAL_VERSION_CONFLICT';
  end if;
  if found and p_body ? 'template' and p_body->>'template' is distinct from p.template then
    raise exception 'JOURNAL_INVALID';
  end if;
  v_template := coalesce(p.template, p_body->>'template');
  v_title := coalesce(p_body->>'title', p.title, '');
  v_paper := coalesce(p_body->>'paper', p.paper, j.paper);
  if v_template is null or v_template not in ('ruled', 'collage', 'concept', 'timeline', 'free')
    or v_paper not in ('ruled', 'grid', 'dot', 'kraft', 'linen', 'vellum', 'aged')
    or char_length(v_title) > 120 or v_title ~ '<[/]?[a-zA-Z!?]' then
    raise exception 'JOURNAL_INVALID';
  end if;
  v_links := case when p_body ? 'links' then public.journal_check_links(p_user_id, p_body->'links') else coalesce(p.links, '[]'::jsonb) end;
  v_decorations := case when p_body ? 'decorations' then public.journal_check_decorations(p_user_id, p_body->'decorations')
    else coalesce(p.decorations, '[]'::jsonb) end;
  v_content := coalesce(p_body->'content', p.content, '{}'::jsonb);
  perform public.journal_check_content(v_content, v_links);
  if p.id is null then
    if (select count(*) from public.journal_pages where journal_id = j.id and deleted_at is null) >= 120 then
      raise exception 'JOURNAL_LIMIT';
    end if;
    select coalesce(max(position) + 1, 0) into v_position from public.journal_pages where journal_id = j.id;
    if v_position > 9999 then raise exception 'JOURNAL_LIMIT'; end if;
    insert into public.journal_pages(id, journal_id, user_id, position, template, paper, title, content, decorations, links,
      last_request_id, last_body_hash)
    values (p_page_id, j.id, p_user_id, v_position, v_template, v_paper, v_title, v_content, v_decorations, v_links,
      p_request_id, v_hash) returning * into p;
  else
    v_position := coalesce((p_body->>'position')::integer, p.position);
    if v_position not between 0 and 9999 then raise exception 'JOURNAL_INVALID'; end if;
    update public.journal_pages set title = v_title, paper = v_paper, content = v_content, decorations = v_decorations,
      links = v_links, position = v_position, version = version + 1,
      deleted_at = case when coalesce((p_body->>'deleted')::boolean, false) then clock_timestamp() else null end,
      last_request_id = p_request_id, last_body_hash = v_hash, updated_at = clock_timestamp()
      where id = p_page_id returning * into p;
  end if;
  update public.journals set updated_at = clock_timestamp() where id = j.id returning * into j;
  return jsonb_build_object('page', public.journal_page_row(p), 'journal', public.journal_row(j), 'replayed', false);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: nothing for browsers. Server functions for service_role only.
-- ---------------------------------------------------------------------------------------------
alter table public.journals enable row level security;
alter table public.journal_pages enable row level security;
-- Only effective if a deployment ever grants SELECT to browsers; this migration does not.
create policy journals_select_own on public.journals for select to authenticated using (user_id = (select auth.uid()));
create policy journal_pages_select_own on public.journal_pages for select to authenticated using (user_id = (select auth.uid()));
revoke all on table public.journals, public.journal_pages from public, anon, authenticated;
grant select, insert, update, delete on table public.journals, public.journal_pages to service_role;
revoke all on function
  public.journal_row(public.journals), public.journal_page_row(public.journal_pages),
  public.journal_link_target(uuid,text,uuid), public.journal_check_decorations(uuid,jsonb),
  public.journal_check_links(uuid,jsonb), public.journal_check_content(jsonb,jsonb),
  public.journal_list_admin(uuid), public.journal_get_admin(uuid,uuid), public.journal_link_options_admin(uuid),
  public.journal_save_admin(uuid,uuid,integer,uuid,jsonb),
  public.journal_page_save_admin(uuid,uuid,uuid,integer,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function
  public.journal_row(public.journals), public.journal_page_row(public.journal_pages),
  public.journal_link_target(uuid,text,uuid), public.journal_check_decorations(uuid,jsonb),
  public.journal_check_links(uuid,jsonb), public.journal_check_content(jsonb,jsonb),
  public.journal_list_admin(uuid), public.journal_get_admin(uuid,uuid), public.journal_link_options_admin(uuid),
  public.journal_save_admin(uuid,uuid,integer,uuid,jsonb),
  public.journal_page_save_admin(uuid,uuid,uuid,integer,uuid,jsonb)
  to service_role;
commit;
