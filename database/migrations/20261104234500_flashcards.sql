-- E13 / Flashcards: MIGRACAO CANDIDATA NAO APLICADA.
-- Depende de E05 e da FK composta em materials. Aplicar somente com backup,
-- e13-preflight, aprovacao explicita e ambiente correto no SQL Editor.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
begin
  if to_regclass('public.materials') is null
    or to_regclass('public.study_tasks') is null
    or not exists (
      select 1 from pg_constraint
      where conrelid = 'public.materials'::regclass
        and conname = 'materials_id_user_planning_unique'
    ) then
    raise exception 'E13_ABORT: aplicar e verificar E03 e E05/E06 antes da E13';
  end if;
  if to_regclass('public.study_flashcards') is not null
    or to_regclass('public.study_flashcard_reviews') is not null
    or to_regprocedure('public.study_review_flashcard_admin(uuid,uuid,integer,uuid)') is not null then
    raise exception 'E13_ABORT: estruturas E13 ja existem; nao reaplicar';
  end if;
end
$guard$;

create table public.study_flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid,
  front_text text not null check (char_length(btrim(front_text)) between 1 and 1000),
  back_text text not null check (char_length(btrim(back_text)) between 1 and 2000),
  status text not null default 'active' check (status in ('active', 'archived')),
  due_at timestamptz not null default now(),
  interval_days integer not null default 0 check (interval_days between 0 and 3650),
  repetitions integer not null default 0 check (repetitions between 0 and 100000),
  ease_factor numeric(4,2) not null default 2.50
    check (ease_factor between 1.30 and 3.00),
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_flashcards_material_owner_fk
    foreign key (material_id, user_id)
    references public.materials(id, user_id) on delete set null (material_id),
  constraint study_flashcards_id_owner_unique unique (id, user_id)
);

create table public.study_flashcard_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null,
  request_id uuid not null,
  rating smallint not null check (rating between 0 and 3),
  interval_days integer not null check (interval_days between 0 and 3650),
  repetitions integer not null check (repetitions between 0 and 100000),
  ease_factor numeric(4,2) not null check (ease_factor between 1.30 and 3.00),
  due_at timestamptz not null,
  reviewed_at timestamptz not null default now(),
  constraint study_flashcard_reviews_card_owner_fk
    foreign key (card_id, user_id)
    references public.study_flashcards(id, user_id) on delete cascade,
  constraint study_flashcard_reviews_request_unique unique (user_id, request_id)
);

create index study_flashcards_due_idx
  on public.study_flashcards(user_id, due_at, id) where status = 'active';
create index study_flashcards_material_idx
  on public.study_flashcards(user_id, material_id);
create index study_flashcard_reviews_card_idx
  on public.study_flashcard_reviews(user_id, card_id, reviewed_at desc);

create trigger study_flashcards_set_updated_at
before update on public.study_flashcards
for each row execute function public.set_updated_at();

-- Ratings: 0=de novo (10 min); 1=dificil; 2=bom; 3=facil.
-- Revisoes sao serializadas pelo lock no cartao. request_id deduplica
-- um reenvio apos timeout de rede sem adiantar o cartao duas vezes.
create function public.study_review_flashcard_admin(
  p_user_id uuid, p_card_id uuid, p_rating integer, p_request_id uuid
) returns jsonb
language plpgsql security invoker
set search_path = pg_catalog, public
as $review$
declare
  v_card public.study_flashcards%rowtype;
  v_previous public.study_flashcard_reviews%rowtype;
  v_interval integer;
  v_repetitions integer;
  v_ease numeric(4,2);
  v_due timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  if p_user_id is null or p_card_id is null or p_request_id is null
    or p_rating is null or p_rating not between 0 and 3 then
    raise exception 'FLASHCARD_INVALID_REVIEW' using errcode = 'P0001';
  end if;

  select * into v_card from public.study_flashcards
  where id = p_card_id and user_id = p_user_id for update;
  if not found then
    raise exception 'FLASHCARD_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_previous from public.study_flashcard_reviews
  where user_id = p_user_id and request_id = p_request_id;
  if found then
    if v_previous.card_id <> p_card_id or v_previous.rating <> p_rating then
      raise exception 'FLASHCARD_REQUEST_CONFLICT' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'cardId', v_previous.card_id, 'dueAt', v_previous.due_at,
      'intervalDays', v_previous.interval_days,
      'repetitions', v_previous.repetitions,
      'easeFactor', v_previous.ease_factor, 'reviewedAt', v_previous.reviewed_at,
      'rating', v_previous.rating, 'replayed', true
    );
  end if;

  if v_card.status <> 'active' then
    raise exception 'FLASHCARD_ARCHIVED' using errcode = 'P0001';
  end if;

  if p_rating = 0 then
    v_interval := 0;
    v_repetitions := 0;
    v_ease := greatest(1.30, v_card.ease_factor - 0.20);
    v_due := v_now + interval '10 minutes';
  elsif p_rating = 1 then
    v_interval := least(3650, greatest(1, ceil(greatest(1, v_card.interval_days) * 1.20)::integer));
    v_repetitions := least(100000, v_card.repetitions + 1);
    v_ease := greatest(1.30, v_card.ease_factor - 0.15);
    v_due := v_now + make_interval(days => v_interval);
  elsif p_rating = 2 then
    v_interval := case
      when v_card.repetitions = 0 then 1
      when v_card.repetitions = 1 then 3
      else least(3650, greatest(1, ceil(v_card.interval_days * v_card.ease_factor)::integer))
    end;
    v_repetitions := least(100000, v_card.repetitions + 1);
    v_ease := v_card.ease_factor;
    v_due := v_now + make_interval(days => v_interval);
  else
    v_ease := least(3.00, v_card.ease_factor + 0.15);
    v_interval := case when v_card.repetitions = 0 then 4
      else least(3650, greatest(1, ceil(v_card.interval_days * (v_card.ease_factor + 0.30))::integer))
    end;
    v_repetitions := least(100000, v_card.repetitions + 1);
    v_due := v_now + make_interval(days => v_interval);
  end if;

  update public.study_flashcards set
    interval_days = v_interval, repetitions = v_repetitions,
    ease_factor = v_ease, due_at = v_due, last_reviewed_at = v_now
  where id = p_card_id and user_id = p_user_id;

  insert into public.study_flashcard_reviews (
    user_id, card_id, request_id, rating, interval_days, repetitions,
    ease_factor, due_at, reviewed_at
  ) values (
    p_user_id, p_card_id, p_request_id, p_rating, v_interval, v_repetitions,
    v_ease, v_due, v_now
  );

  return jsonb_build_object(
    'cardId', p_card_id, 'dueAt', v_due,
    'intervalDays', v_interval, 'repetitions', v_repetitions,
    'easeFactor', v_ease, 'reviewedAt', v_now,
    'rating', p_rating, 'replayed', false
  );
end
$review$;

alter table public.study_flashcards enable row level security;
alter table public.study_flashcard_reviews enable row level security;
create policy study_flashcards_select_own on public.study_flashcards
  for select to authenticated using (user_id = (select auth.uid()));
create policy study_flashcard_reviews_select_own on public.study_flashcard_reviews
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on table public.study_flashcards, public.study_flashcard_reviews
  from public, anon, authenticated;
grant select, insert, update, delete on table
  public.study_flashcards, public.study_flashcard_reviews to service_role;
revoke all on function public.study_review_flashcard_admin(uuid,uuid,integer,uuid)
  from public, anon, authenticated;
grant execute on function public.study_review_flashcard_admin(uuid,uuid,integer,uuid)
  to service_role;
commit;
