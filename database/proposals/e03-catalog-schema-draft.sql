-- E03 / Biblioteca 2.0: PROPOSTA DE SCHEMA, NÃO EXECUTAR.
-- Criada sobre 001_initial.sql + E02 observados no código de 04/11/2026.
-- Requer preflight no Supabase autorizado, backup restaurável, revisão dos grants
-- efetivos, teste de rollback e aprovação. Não é migration aprovada nem foi executada.
-- Ao promover: usar identificador novo no ledger e adaptar ao schema real.
--
-- Compatibilidade: preservar materials.id/user_id/subject; nunca recriar materiais.
-- As associações intercontas usam FKs compostas. Nenhum DROP de dados legados.

begin;

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
  unique (user_id, normalized_name),
  unique (id, user_id)
);

create table public.study_units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null,
  title text not null check (char_length(title) between 1 and 160),
  normalized_title text not null check (char_length(normalized_title) between 1 and 160),
  description text,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_units_subject_owner_fk
    foreign key (subject_id, user_id)
    references public.study_subjects(id, user_id) on delete restrict,
  unique (subject_id, normalized_title),
  unique (id, user_id),
  unique (id, subject_id, user_id)
);

alter table public.materials
  add column subject_id uuid,
  add column unit_id uuid;

alter table public.materials
  add constraint materials_catalog_subject_owner_fk
  foreign key (subject_id, user_id)
  references public.study_subjects(id, user_id) on delete restrict;

alter table public.materials
  add constraint materials_catalog_unit_scope_check
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

-- Backfill conservador, a partir do rótulo antigo, separado por conta.
-- Valores vazios permanecem sem disciplina; o texto original NÃO é modificado.
with cleaned as (
  select user_id,
         btrim(regexp_replace(subject, '[[:space:]]+', ' ', 'g')) as label
  from public.materials
  where nullif(btrim(subject), '') is not null
)
insert into public.study_subjects(user_id, name, normalized_name)
select distinct on (user_id, lower(label))
       user_id, label, lower(label)
from cleaned
order by user_id, lower(label), label
on conflict (user_id, normalized_name) do nothing;

update public.materials m
set subject_id = s.id
from public.study_subjects s
where m.user_id = s.user_id
  and m.subject_id is null
  and nullif(btrim(m.subject), '') is not null
  and s.normalized_name = lower(btrim(regexp_replace(m.subject, '[[:space:]]+', ' ', 'g')));

create trigger study_subjects_set_updated_at
before update on public.study_subjects
for each row execute function public.set_updated_at();

create trigger study_units_set_updated_at
before update on public.study_units
for each row execute function public.set_updated_at();

alter table public.study_subjects enable row level security;
alter table public.study_units enable row level security;

create policy study_subjects_select_own on public.study_subjects
  for select to authenticated using (auth.uid() = user_id);
create policy study_units_select_own on public.study_units
  for select to authenticated using (auth.uid() = user_id);

-- API Express e worker usam cliente server-side; navegador não recebe grants
-- de escrita nas tabelas novas. Conferir effective privileges antes de aplicar.
revoke all on public.study_subjects, public.study_units
  from public, anon, authenticated;
grant select, insert, update, delete on public.study_subjects, public.study_units
  to service_role;

commit;

-- A fazer antes de promoção:
-- 1) definir tratamento de disciplinas arquivadas/duplicatas e exclusões com vínculos;
-- 2) testar índices, RLS, ownership, SQL sintético e reexecução controlada;
-- 3) definir sincronização do subject legado em novos uploads/renomeações;
-- 4) preparar consultas antes/depois e rollback NÃO destrutivo;
-- 5) obter aprovação de execução no ambiente certo.
