-- Voz em Estudo 3.3 / Flashcards 3.0 — MIGRACAO CANDIDATA (nao aplicada em producao por este commit).
-- Depende de: 20261104234500_flashcards.sql (E13) e 20261119121000_flashcard_sets.sql.
-- Aditiva: nenhuma tabela, coluna, indice ou funcao existente e removida ou substituida.
-- Transformacao de dados: os cartoes existentes recebem note_type a partir de card_style
-- ('term_definition' -> 'term'; os demais -> 'basic'); conteudo, agenda e historico nao mudam.
-- Ordem de implantacao, preflight, postflight e rollback: docs/migrations/FLASHCARDS_3_0.md.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
begin
  if to_regclass('public.study_flashcards') is null
    or to_regclass('public.study_flashcard_sets') is null
    or to_regprocedure('public.study_add_flashcards_admin(uuid,uuid,jsonb)') is null then
    raise exception 'FLASHCARDS_3_0_ABORT: aplicar E13 (flashcards) e flashcard_sets antes';
  end if;
  if to_regclass('public.study_card_templates') is not null
    or exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'study_flashcards' and column_name = 'note_type') then
    raise exception 'FLASHCARDS_3_0_ABORT: estruturas de Flashcards 3.0 ja existem; nao reaplicar';
  end if;
end
$guard$;

-- 1. Educational content: structured note types and provenance --------------------------------
-- front_text/back_text stay the rendered study text (review, export and old clients keep working);
-- note_fields keeps the structured fields of the type. Appearance never lives on the card.
alter table public.study_flashcards
  add column note_type text not null default 'basic'
    check (note_type in ('basic', 'term', 'cloze', 'cause_effect', 'comparison', 'sequence', 'application', 'error_spotting')),
  add column note_fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(note_fields) = 'object' and pg_column_size(note_fields) <= 16384),
  -- Normalised question+answer fingerprint computed by the server; used for duplicate previews.
  add column content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  -- Where a copied card came from (merge, Anki package, text file, class). The copy is independent:
  -- no foreign key, so the origin can be deleted or revoked without touching this card.
  add column origin_kind text check (origin_kind is null or origin_kind in ('merge', 'apkg', 'text_import', 'classroom')),
  add column origin_card_id uuid,
  add column origin_set_id uuid,
  add column origin_user_id uuid,
  add column origin_label text check (origin_label is null or char_length(origin_label) <= 160),
  -- Imported images: [{path, mime, name}] in the private flashcard-media bucket (server-signed URLs).
  add column media jsonb not null default '[]'::jsonb
    check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 10);

-- Explicit backfill of existing cards (counted by the postflight check).
update public.study_flashcards set note_type = 'term' where card_style = 'term_definition';

create index study_flashcards_owner_hash_idx on public.study_flashcards(user_id, content_hash)
  where content_hash is not null;

-- 2. Appearance: reusable visual templates, independent of content ------------------------------
create table public.study_card_templates (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  base text not null check (base in ('classic', 'notebook', 'sticky', 'window', 'polaroid')),
  -- Declarative tokens only (validated by the API): colours, font, radius, pattern. No CSS or HTML.
  tokens jsonb not null default '{}'::jsonb check (jsonb_typeof(tokens) = 'object' and pg_column_size(tokens) <= 4096),
  -- Per note type layout overrides, e.g. {"cloze": {"layout": "left"}}.
  variants jsonb not null default '{}'::jsonb check (jsonb_typeof(variants) = 'object' and pg_column_size(variants) <= 4096),
  version integer not null default 1 check (version >= 1),
  last_request_id uuid not null,
  last_body jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint study_card_templates_id_owner_unique unique (id, user_id)
);
create index study_card_templates_owner_idx on public.study_card_templates(user_id, updated_at desc)
  where deleted_at is null;

-- A set shows ONE look: a built-in base or one of the owner's templates. Changing it touches only
-- the set row, never the cards, their sources, authorship or review history.
alter table public.study_flashcard_sets
  add column template_base text check (template_base is null or template_base in ('classic', 'notebook', 'sticky', 'window', 'polaroid')),
  add column template_id uuid,
  add constraint study_flashcard_sets_template_owner_fk foreign key (template_id, user_id)
    references public.study_card_templates(id, user_id) on delete set null (template_id);

alter table public.study_card_templates enable row level security;
revoke all on table public.study_card_templates from public, anon, authenticated;
grant select, insert, update on table public.study_card_templates to service_role;

-- 3. Private bucket for images imported from Anki packages (read through server-signed URLs) -----
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('flashcard-media', 'flashcard-media', false, 2097152,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
-- No browser policies: only the server (service role) writes and signs these objects.

-- 4. Functions -------------------------------------------------------------------------------------

-- Inserts typed cards into an owned set. Like study_add_flashcards_admin, an existing question in
-- the set is skipped; unlike it, the result lists what was skipped so the caller can tell the user.
create function public.study_add_flashcard_notes_admin(p_user_id uuid, p_set_id uuid, p_cards jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_set public.study_flashcard_sets; v_card jsonb; v_added integer := 0; v_rows integer;
  v_skipped jsonb := '[]'::jsonb; v_index integer := 0;
begin
  select * into v_set from public.study_flashcard_sets where id = p_set_id and user_id = p_user_id for update;
  if not found then raise exception 'FLASHCARD_NOT_FOUND'; end if;
  if jsonb_typeof(coalesce(p_cards, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_cards) not between 1 and 500 then
    raise exception 'FLASHCARD_INVALID_SET';
  end if;
  if (select count(*) from public.study_flashcards where set_id = p_set_id) + jsonb_array_length(p_cards) > 500 then
    raise exception 'FLASHCARD_SET_LIMIT';
  end if;
  for v_card in select value from jsonb_array_elements(p_cards) loop
    if coalesce(btrim(v_card->>'front'), '') = '' or coalesce(btrim(v_card->>'back'), '') = ''
      or (v_card ? 'fields' and jsonb_typeof(v_card->'fields') <> 'object')
      or (v_card ? 'media' and jsonb_typeof(v_card->'media') <> 'array')
      or (v_card ? 'sourceSegments' and jsonb_typeof(v_card->'sourceSegments') <> 'array') then
      raise exception 'FLASHCARD_INVALID_SET';
    end if;
    insert into public.study_flashcards(user_id, material_id, set_id, front_text, back_text, status, source_revision_id,
      evidence, source_segments, card_style, difficulty, focus, note_type, note_fields, content_hash,
      origin_kind, origin_card_id, origin_set_id, origin_user_id, origin_label, media)
    values (p_user_id, v_set.material_id, p_set_id, btrim(v_card->>'front'), btrim(v_card->>'back'), v_set.status,
      v_set.source_revision_id, nullif(btrim(coalesce(v_card->>'evidence', '')), ''),
      coalesce(v_card->'sourceSegments', '[]'::jsonb), v_card->>'style', v_card->>'difficulty', v_card->>'focus',
      coalesce(v_card->>'noteType', 'basic'), coalesce(v_card->'fields', '{}'::jsonb), v_card->>'contentHash',
      v_card->>'originKind', nullif(v_card->>'originCardId', '')::uuid, nullif(v_card->>'originSetId', '')::uuid,
      nullif(v_card->>'originUserId', '')::uuid, nullif(left(coalesce(v_card->>'originLabel', ''), 160), ''),
      coalesce(v_card->'media', '[]'::jsonb))
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then v_skipped := v_skipped || jsonb_build_array(v_index); end if;
    v_added := v_added + v_rows;
    v_index := v_index + 1;
  end loop;
  update public.study_flashcard_sets set updated_at = now() where id = p_set_id;
  return jsonb_build_object('added', v_added, 'skipped', v_skipped);
end $$;

-- Creates a personal set (no lesson) with typed cards and a look, in one transaction. Used by
-- merges and imports. A retry with the same id returns the set without adding anything.
create function public.study_create_flashcard_deck_admin(p_user_id uuid, p_set_id uuid, p_body jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_set public.study_flashcard_sets; v_result jsonb; v_template uuid;
begin
  select * into v_set from public.study_flashcard_sets where id = p_set_id;
  if found then
    if v_set.user_id <> p_user_id then raise exception 'FLASHCARD_NOT_FOUND'; end if;
    return to_jsonb(v_set) || jsonb_build_object('added', 0, 'skipped', '[]'::jsonb, 'replayed', true);
  end if;
  if jsonb_typeof(coalesce(p_body, 'null'::jsonb)) <> 'object' or coalesce(btrim(p_body->>'name'), '') = ''
    or (p_body ? 'config' and jsonb_typeof(p_body->'config') <> 'object') then
    raise exception 'FLASHCARD_INVALID_SET';
  end if;
  v_template := nullif(p_body->>'templateId', '')::uuid;
  if v_template is not null and not exists (
    select 1 from public.study_card_templates where id = v_template and user_id = p_user_id and deleted_at is null) then
    raise exception 'FLASHCARD_NOT_FOUND';
  end if;
  insert into public.study_flashcard_sets(id, user_id, material_id, name, config, source_revision_id, template_base, template_id)
  values (p_set_id, p_user_id, null, btrim(p_body->>'name'), coalesce(p_body->'config', '{}'::jsonb), null,
    nullif(p_body->>'templateBase', ''), v_template)
  returning * into v_set;
  v_result := public.study_add_flashcard_notes_admin(p_user_id, p_set_id, p_body->'cards');
  return to_jsonb(v_set) || v_result || jsonb_build_object('replayed', false);
end $$;

-- Saves (creates or edits) one of the owner's templates. Versioned and idempotent.
create function public.study_save_card_template_admin(p_user_id uuid, p_id uuid, p_version integer, p_request_id uuid, p_body jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.study_card_templates;
begin
  if jsonb_typeof(coalesce(p_body, 'null'::jsonb)) <> 'object' then raise exception 'CARD_TEMPLATE_INVALID'; end if;
  select * into r from public.study_card_templates where id = p_id for update;
  if found then
    if r.user_id <> p_user_id then raise exception 'CARD_TEMPLATE_NOT_FOUND'; end if;
    if r.last_request_id = p_request_id then
      if r.last_body is distinct from p_body then raise exception 'CARD_TEMPLATE_REQUEST_CONFLICT'; end if;
      return to_jsonb(r);
    end if;
    if r.version <> p_version then raise exception 'CARD_TEMPLATE_VERSION_CONFLICT'; end if;
    update public.study_card_templates set
      name = coalesce(btrim(p_body->>'name'), name),
      base = coalesce(p_body->>'base', base),
      tokens = coalesce(p_body->'tokens', tokens),
      variants = coalesce(p_body->'variants', variants),
      deleted_at = case when p_body ? 'deleted' then case when (p_body->>'deleted')::boolean then clock_timestamp() else null end else deleted_at end,
      version = version + 1, last_request_id = p_request_id, last_body = p_body, updated_at = clock_timestamp()
    where id = p_id returning * into r;
  else
    if p_version <> 0 then raise exception 'CARD_TEMPLATE_VERSION_CONFLICT'; end if;
    if (select count(*) from public.study_card_templates where user_id = p_user_id and deleted_at is null) >= 50 then
      raise exception 'CARD_TEMPLATE_LIMIT';
    end if;
    insert into public.study_card_templates(id, user_id, name, base, tokens, variants, last_request_id, last_body)
    values (p_id, p_user_id, btrim(p_body->>'name'), p_body->>'base', coalesce(p_body->'tokens', '{}'::jsonb),
      coalesce(p_body->'variants', '{}'::jsonb), p_request_id, p_body)
    returning * into r;
  end if;
  return to_jsonb(r);
end $$;

-- Applies ONE look to a whole set: a built-in base, one of the owner's templates, or neither
-- (back to the account favourite). Only the set row changes.
create function public.study_set_flashcard_set_template_admin(p_user_id uuid, p_set_id uuid, p_template_id uuid, p_base text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_set public.study_flashcard_sets;
begin
  if p_template_id is not null and not exists (
    select 1 from public.study_card_templates where id = p_template_id and user_id = p_user_id and deleted_at is null) then
    raise exception 'CARD_TEMPLATE_NOT_FOUND';
  end if;
  update public.study_flashcard_sets set template_id = p_template_id, template_base = p_base, updated_at = now()
  where id = p_set_id and user_id = p_user_id returning * into v_set;
  if not found then raise exception 'FLASHCARD_NOT_FOUND'; end if;
  return to_jsonb(v_set);
end $$;

revoke all on function public.study_add_flashcard_notes_admin(uuid, uuid, jsonb),
  public.study_create_flashcard_deck_admin(uuid, uuid, jsonb),
  public.study_save_card_template_admin(uuid, uuid, integer, uuid, jsonb),
  public.study_set_flashcard_set_template_admin(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.study_add_flashcard_notes_admin(uuid, uuid, jsonb),
  public.study_create_flashcard_deck_admin(uuid, uuid, jsonb),
  public.study_save_card_template_admin(uuid, uuid, integer, uuid, jsonb),
  public.study_set_flashcard_set_template_admin(uuid, uuid, uuid, text)
  to service_role;
commit;
