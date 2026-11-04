-- E03 / Voz em Estudo — Biblioteca 2.0
-- MIGRACAO ADITIVA DE USO UNICO. NAO EXECUTAR SEM APROVACAO EXPLICITA.
-- Fonte: 001_initial.sql + 20261009101846_academic_review.sql.
-- Aplicar somente depois de database/checks/e03-preflight.sql e backup validado.
-- O SQL Editor NAO registra automaticamente esta migration no ledger do Supabase.
-- Nao reaplicar se houver tabela/coluna ja existente. Nao alterar dados derivados.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Falhar antes de mudar algo se o ambiente nao corresponder a E02.
do $guard$
begin
  if to_regclass('public.materials') is null
      or to_regclass('public.material_permissions') is null
      or to_regprocedure('public.set_updated_at()') is null then
    raise exception 'E03_ABORT: esquema E02 ou funcao set_updated_at ausente';
  end if;
  if to_regclass('public.study_subjects') is not null
      or to_regclass('public.study_units') is not null
      or exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'materials'
          and column_name in ('subject_id', 'unit_id')
      ) then
    raise exception 'E03_ABORT: estruturas E03 ja existem (nao reaplicar)';
  end if;
  if exists (
    select 1 from public.materials
    where subject is not null
      and char_length(btrim(regexp_replace(subject, '[[:space:]]+', ' ', 'g'))) > 120
  ) then
    raise exception 'E03_ABORT: rotulo legado de disciplina ultrapassa 120 caracteres; revisar sem truncar';
  end if;
end
$guard$;

create table public.study_subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  normalized_name text not null check (char_length(normalized_name) between 1 and 120),
  color_token text,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_subjects_owner_normalized_unique unique(user_id, normalized_name),
  constraint study_subjects_id_owner_unique unique(id, user_id)
);

create table public.study_units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null,
  title text not null check (char_length(title) between 1 and 160),
  normalized_title text not null check (char_length(normalized_title) between 1 and 160),
  description text check (description is null or char_length(description) <= 500),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_units_subject_owner_fk
    foreign key (subject_id, user_id)
    references public.study_subjects(id, user_id) on delete restrict,
  constraint study_units_subject_title_unique unique(subject_id, normalized_title),
  constraint study_units_id_owner_unique unique(id, user_id),
  constraint study_units_id_subject_owner_unique unique(id, subject_id, user_id)
);

-- The database, not the caller, owns label normalization and timestamps.
-- The JS validator keeps UX-friendly values; these triggers are authoritative.
create function public.study_catalog_normalize_and_stamp()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_table_name = 'study_subjects' then
    new.name := btrim(regexp_replace(new.name, '[[:space:]]+', ' ', 'g'));
    new.normalized_name := lower(new.name);
  elsif tg_table_name = 'study_units' then
    new.title := btrim(regexp_replace(new.title, '[[:space:]]+', ' ', 'g'));
    new.normalized_title := lower(new.title);
  end if;
  new.updated_at := now();
  return new;
end
$function$;

create trigger study_subjects_normalize
before insert or update on public.study_subjects
for each row execute function public.study_catalog_normalize_and_stamp();

create trigger study_units_normalize
before insert or update on public.study_units
for each row execute function public.study_catalog_normalize_and_stamp();

-- ADD COLUMN leaves all historical IDs and contents untouched.
alter table public.materials
  add column subject_id uuid,
  add column unit_id uuid;

alter table public.materials
  add constraint materials_catalog_subject_owner_fk
  foreign key (subject_id, user_id)
  references public.study_subjects(id, user_id) on delete restrict;

alter table public.materials
  add constraint materials_catalog_unit_requires_subject
  check (unit_id is null or subject_id is not null);

alter table public.materials
  add constraint materials_catalog_unit_owner_fk
  foreign key (unit_id, subject_id, user_id)
  references public.study_units(id, subject_id, user_id) on delete restrict;

create index study_subjects_user_sort_idx
  on public.study_subjects(user_id, sort_order, name);
create index study_units_subject_sort_idx
  on public.study_units(subject_id, sort_order, title);
create index materials_user_subject_idx
  on public.materials(user_id, subject_id);
create index materials_user_unit_idx
  on public.materials(user_id, unit_id);

-- Backfill conservador: cada conta recebe as suas disciplinas.
-- Converte apenas os rotulos existentes em IDs; NAO altera materials.subject.
-- Rotulos vazios, null e apenas espacos permanecem sem vinculo.
with labels as (
  select user_id,
         btrim(regexp_replace(subject, '[[:space:]]+', ' ', 'g')) as label
  from public.materials
  where nullif(btrim(regexp_replace(subject, '[[:space:]]+', ' ', 'g')), '') is not null
)
insert into public.study_subjects (user_id, name, normalized_name)
select distinct on (user_id, lower(label))
       user_id, label, lower(label)
from labels
order by user_id, lower(label), label
on conflict (user_id, normalized_name) do nothing;

-- Preserve historical updated_at: the existing materials_set_updated_at trigger
-- stamps every UPDATE. Altering the trigger under the DDL transaction's table
-- lock is safe from concurrent writes; rollback restores it automatically.
-- Only this trigger is disabled, never E02 permission/review constraints.
lock table public.materials in access exclusive mode;
alter table public.materials disable trigger materials_set_updated_at;

update public.materials m
set subject_id = s.id
from public.study_subjects s
where m.subject_id is null
  and m.user_id = s.user_id
  and nullif(btrim(regexp_replace(m.subject, '[[:space:]]+', ' ', 'g')), '') is not null
  and s.normalized_name = lower(btrim(regexp_replace(m.subject, '[[:space:]]+', ' ', 'g')));

alter table public.materials enable trigger materials_set_updated_at;

-- API server-side has privileges; browser-facing roles do not.
alter table public.study_subjects enable row level security;
alter table public.study_units enable row level security;

create policy study_subjects_select_own on public.study_subjects
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy study_units_select_own on public.study_units
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.study_subjects, public.study_units
  from public, anon, authenticated;
grant select, insert, update, delete on table public.study_subjects, public.study_units
  to service_role;

revoke all on function public.study_catalog_normalize_and_stamp()
  from public, anon, authenticated;
grant execute on function public.study_catalog_normalize_and_stamp()
  to service_role;

-- Executed on explicit approval only, then compare e03-postflight.
commit;
