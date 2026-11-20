-- Flashcards 2.0: named sets, source references and set management. MIGRATION CANDIDATE, NOT APPLIED.
-- Requires E13 (study_flashcards). Apply only with backup, database/checks/authoring-preflight.sql,
-- explicit approval and the correct environment; then enable FEATURE_FLASHCARD_SETS.
-- Additive: one new table, nullable/defaulted columns, new functions. Existing cards, their schedule
-- and review history are not modified; the E13 review function is not replaced.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
begin
  if to_regclass('public.study_flashcards') is null
    or to_regprocedure('public.study_review_flashcard_admin(uuid,uuid,integer,uuid)') is null
    or to_regclass('public.transcription_versions') is null then
    raise exception 'FLASHCARD_SETS_ABORT: aplicar e verificar E02 e E13 antes desta migration';
  end if;
  if to_regclass('public.study_flashcard_sets') is not null then
    raise exception 'FLASHCARD_SETS_ABORT: estruturas ja existem; nao reaplicar';
  end if;
end
$guard$;

create table public.study_flashcard_sets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  status text not null default 'active' check (status in ('active', 'archived')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  source_revision_id uuid references public.transcription_versions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_flashcard_sets_material_owner_fk foreign key (material_id, user_id)
    references public.materials(id, user_id) on delete set null (material_id),
  constraint study_flashcard_sets_id_owner_unique unique (id, user_id)
);
create index study_flashcard_sets_owner_idx on public.study_flashcard_sets(user_id, material_id, created_at desc);
create trigger study_flashcard_sets_set_updated_at before update on public.study_flashcard_sets
for each row execute function public.set_updated_at();

alter table public.study_flashcards
  add column set_id uuid,
  add column source_revision_id uuid references public.transcription_versions(id) on delete set null,
  add column evidence text check (evidence is null or char_length(evidence) <= 1500),
  add column source_segments jsonb not null default '[]'::jsonb check (jsonb_typeof(source_segments) = 'array'),
  add column card_style text check (card_style is null or card_style in ('question_answer', 'term_definition', 'concise_explanation')),
  add column difficulty text check (difficulty is null or difficulty in ('basic', 'intermediate', 'advanced')),
  -- Marks cards archived together with their set, so restoring the set restores only those.
  add column archived_by_set boolean not null default false,
  add column focus text check (focus is null or focus in ('definitions', 'facts', 'concepts', 'processes', 'comparisons', 'application', 'cause_effect')),
  -- Deleting a set (explicit, confirmed in the interface) removes its cards and their history.
  add constraint study_flashcards_set_owner_fk foreign key (set_id, user_id)
    references public.study_flashcard_sets(id, user_id) on delete cascade;
create index study_flashcards_set_idx on public.study_flashcards(user_id, set_id) where set_id is not null;
-- The same front cannot appear twice in one set (exact duplicates after trimming and case).
create unique index study_flashcards_set_front_unique
  on public.study_flashcards(set_id, lower(btrim(front_text))) where set_id is not null;

-- Inserts cards into an owned set, skipping exact duplicates. Returns the number inserted.
create function public.study_add_flashcards_admin(p_user_id uuid, p_set_id uuid, p_cards jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_set public.study_flashcard_sets; v_card jsonb; v_count integer := 0; v_rows integer;
begin
  select * into v_set from public.study_flashcard_sets where id = p_set_id and user_id = p_user_id for update;
  if not found then raise exception 'FLASHCARD_NOT_FOUND'; end if;
  if jsonb_typeof(coalesce(p_cards, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_cards) not between 1 and 100 then
    raise exception 'FLASHCARD_INVALID_SET';
  end if;
  if (select count(*) from public.study_flashcards where set_id = p_set_id) + jsonb_array_length(p_cards) > 500 then
    raise exception 'FLASHCARD_SET_LIMIT';
  end if;
  for v_card in select value from jsonb_array_elements(p_cards) loop
    if coalesce(btrim(v_card->>'front'), '') = '' or coalesce(btrim(v_card->>'back'), '') = ''
      or (v_card ? 'sourceSegments' and jsonb_typeof(v_card->'sourceSegments') <> 'array') then
      raise exception 'FLASHCARD_INVALID_SET';
    end if;
    insert into public.study_flashcards(user_id, material_id, set_id, front_text, back_text, status, source_revision_id,
      evidence, source_segments, card_style, difficulty, focus)
    values (p_user_id, v_set.material_id, p_set_id, btrim(v_card->>'front'), btrim(v_card->>'back'), v_set.status,
      v_set.source_revision_id, nullif(btrim(coalesce(v_card->>'evidence', '')), ''),
      coalesce(v_card->'sourceSegments', '[]'::jsonb), v_card->>'style', v_card->>'difficulty', v_card->>'focus')
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  end loop;
  update public.study_flashcard_sets set updated_at = now() where id = p_set_id;
  return v_count;
end $$;

-- Creates a named set and its cards in one transaction; a retry with the same id returns it.
create function public.study_create_flashcard_set_admin(p_user_id uuid, p_set_id uuid, p_body jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_set public.study_flashcard_sets; v_material uuid; v_revision uuid; v_added integer;
begin
  select * into v_set from public.study_flashcard_sets where id = p_set_id;
  if found then
    if v_set.user_id <> p_user_id then raise exception 'FLASHCARD_NOT_FOUND'; end if;
    return to_jsonb(v_set) || jsonb_build_object('added', 0, 'replayed', true);
  end if;
  if jsonb_typeof(coalesce(p_body, 'null'::jsonb)) <> 'object' or coalesce(btrim(p_body->>'name'), '') = ''
    or (p_body ? 'config' and jsonb_typeof(p_body->'config') <> 'object') then
    raise exception 'FLASHCARD_INVALID_SET';
  end if;
  v_material := nullif(p_body->>'materialId', '')::uuid;
  v_revision := nullif(p_body->>'sourceRevisionId', '')::uuid;
  if v_material is not null and not exists (select 1 from public.materials where id = v_material and user_id = p_user_id) then
    raise exception 'FLASHCARD_NOT_FOUND';
  end if;
  if v_revision is not null and not exists (
    select 1 from public.transcription_versions tv join public.transcriptions t on t.id = tv.transcription_id
    where tv.id = v_revision and t.material_id = v_material) then
    raise exception 'FLASHCARD_NOT_FOUND';
  end if;
  -- Generated cards come only from a revision the owner confirmed (at any time: the transcript may
  -- have been edited after the preview). Direct API calls cannot bypass the human review.
  if v_revision is not null and not exists (
    select 1 from public.transcription_confirmations tc
    where tc.material_id = v_material and tc.user_id = p_user_id and tc.transcription_version_id = v_revision) then
    raise exception 'TRANSCRIPTION_CONFIRMATION_REQUIRED';
  end if;
  insert into public.study_flashcard_sets(id, user_id, material_id, name, config, source_revision_id)
  values (p_set_id, p_user_id, v_material, btrim(p_body->>'name'), coalesce(p_body->'config', '{}'::jsonb), v_revision)
  returning * into v_set;
  v_added := public.study_add_flashcards_admin(p_user_id, p_set_id, p_body->'cards');
  return to_jsonb(v_set) || jsonb_build_object('added', v_added, 'replayed', false);
end $$;

-- Rename and archive/restore. Archiving a set takes its active cards out of the review queue;
-- restoring brings back only those cards (a card archived on its own stays archived). Schedules and
-- review history are kept.
create function public.study_update_flashcard_set_admin(p_user_id uuid, p_set_id uuid, p_name text, p_status text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_set public.study_flashcard_sets;
begin
  if p_status is not null and p_status not in ('active', 'archived') then raise exception 'FLASHCARD_INVALID_SET'; end if;
  if p_name is not null and char_length(btrim(p_name)) not between 1 and 160 then raise exception 'FLASHCARD_INVALID_SET'; end if;
  update public.study_flashcard_sets set name = coalesce(btrim(p_name), name), status = coalesce(p_status, status)
    where id = p_set_id and user_id = p_user_id returning * into v_set;
  if not found then raise exception 'FLASHCARD_NOT_FOUND'; end if;
  if p_status = 'archived' then
    update public.study_flashcards set status = 'archived', archived_by_set = true
      where set_id = p_set_id and user_id = p_user_id and status = 'active';
  elsif p_status = 'active' then
    update public.study_flashcards set status = 'active', archived_by_set = false
      where set_id = p_set_id and user_id = p_user_id and archived_by_set;
  end if;
  return to_jsonb(v_set);
end $$;

create function public.study_delete_flashcard_set_admin(p_user_id uuid, p_set_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_cards integer;
begin
  select count(*) into v_cards from public.study_flashcards where set_id = p_set_id and user_id = p_user_id;
  delete from public.study_flashcard_sets where id = p_set_id and user_id = p_user_id;
  if not found then raise exception 'FLASHCARD_NOT_FOUND'; end if;
  return jsonb_build_object('id', p_set_id, 'deletedCards', v_cards);
end $$;

create function public.study_delete_flashcard_admin(p_user_id uuid, p_card_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.study_flashcards where id = p_card_id and user_id = p_user_id;
  if not found then raise exception 'FLASHCARD_NOT_FOUND'; end if;
  return jsonb_build_object('id', p_card_id);
end $$;

alter table public.study_flashcard_sets enable row level security;
create policy study_flashcard_sets_select_own on public.study_flashcard_sets
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on table public.study_flashcard_sets from public, anon, authenticated;
grant select, insert, update, delete on table public.study_flashcard_sets to service_role;
revoke all on function
  public.study_add_flashcards_admin(uuid,uuid,jsonb),
  public.study_create_flashcard_set_admin(uuid,uuid,jsonb),
  public.study_update_flashcard_set_admin(uuid,uuid,text,text),
  public.study_delete_flashcard_set_admin(uuid,uuid),
  public.study_delete_flashcard_admin(uuid,uuid)
  from public, anon, authenticated;
grant execute on function
  public.study_add_flashcards_admin(uuid,uuid,jsonb),
  public.study_create_flashcard_set_admin(uuid,uuid,jsonb),
  public.study_update_flashcard_set_admin(uuid,uuid,text,text),
  public.study_delete_flashcard_set_admin(uuid,uuid),
  public.study_delete_flashcard_admin(uuid,uuid)
  to service_role;
commit;
