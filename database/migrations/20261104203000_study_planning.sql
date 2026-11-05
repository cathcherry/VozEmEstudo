-- E05/E06 — Planejamento de estudos. CANDIDATA; NAO EXECUTAR SEM AUTORIZACAO.
-- Depende da migration E03 (study_subjects e study_units) validada no destino.
-- SQL de uso unico, transacional, sem alterar registros existentes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
begin
  if to_regclass('public.materials') is null
    or to_regclass('public.study_subjects') is null
    or to_regclass('public.study_units') is null
    or to_regclass('public.material_permissions') is null then
    raise exception 'E05_ABORT: aplicar e verificar E03 antes de E05/E06';
  end if;
  if to_regclass('public.study_goals') is not null
    or to_regclass('public.study_tasks') is not null
    or to_regclass('public.study_subgoals') is not null then
    raise exception 'E05_ABORT: estruturas de planejamento ja existem';
  end if;
end
$guard$;

-- Enables a composite FK that prevents cross-account task/material links
-- even if a future caller accidentally bypasses the service ownership check.
alter table public.materials
  add constraint materials_id_user_planning_unique unique (id, user_id);

create table public.study_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text check (description is null or char_length(description) <= 1000),
  target_date date,
  status text not null default 'active'
    check (status in ('active', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_goals_id_owner_unique unique(id, user_id)
);

-- Single-level subgoals: children of a root goal, not an unbounded tree.
-- Composite identity also prevents linking children to another account.
create table public.study_subgoals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_subgoals_goal_owner_fk
    foreign key (goal_id, user_id)
    references public.study_goals(id, user_id) on delete cascade,
  constraint study_subgoals_scope_unique unique(id, goal_id, user_id)
);

create table public.study_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null,
  subgoal_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 180),
  due_date date,
  material_id uuid,
  -- External references are stored as URLs, never fetched by the server.
  reference_url text check (
    reference_url is null or
    (char_length(reference_url) <= 2048 and reference_url ~ '^https://[^[:space:]]+$')
  ),
  -- New tasks naturally appear at the end, even after a manual reorder.
  sort_order bigint not null default (floor(extract(epoch from clock_timestamp()) * 1000)::bigint),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_tasks_goal_owner_fk
    foreign key (goal_id, user_id)
    references public.study_goals(id, user_id) on delete cascade,
  constraint study_tasks_subgoal_scope_fk
    foreign key (subgoal_id, goal_id, user_id)
    references public.study_subgoals(id, goal_id, user_id)
    on delete set null (subgoal_id),
  constraint study_tasks_material_owner_fk
    foreign key (material_id, user_id)
    references public.materials(id, user_id)
    on delete set null (material_id)
);

create index study_goals_owner_created_idx on public.study_goals(user_id, created_at desc);
create index study_subgoals_goal_created_idx
  on public.study_subgoals(goal_id, created_at);
create index study_tasks_subgoal_idx
  on public.study_tasks(subgoal_id)
  where subgoal_id is not null;
create index study_tasks_goal_created_idx on public.study_tasks(goal_id, sort_order, created_at);
create index study_tasks_owner_due_idx on public.study_tasks(user_id, due_date);
create index study_tasks_material_idx on public.study_tasks(material_id)
  where material_id is not null;

create trigger study_goals_set_updated_at
  before update on public.study_goals
  for each row execute function public.set_updated_at();
create trigger study_subgoals_set_updated_at
  before update on public.study_subgoals
  for each row execute function public.set_updated_at();
create trigger study_tasks_set_updated_at
  before update on public.study_tasks
  for each row execute function public.set_updated_at();

-- Reorders are single-transaction and only service_role may execute this RPC.
-- The lock serializes concurrent reorder and insert operations for one goal.
-- An exact list of the goal's tasks is required; no partial/cross-user reorder.
create function public.study_reorder_tasks(
  p_user_id uuid,
  p_goal_id uuid,
  p_task_ids uuid[]
) returns table (id uuid, sort_order bigint)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $reorder$
declare
  v_count integer;
begin
  if p_user_id is null or p_goal_id is null or p_task_ids is null
      or cardinality(p_task_ids) < 2 or cardinality(p_task_ids) > 500 then
    raise exception 'PLANNING_ORDER_INVALID' using errcode = '23514';
  end if;

  perform 1 from public.study_goals g
  where g.id = p_goal_id and g.user_id = p_user_id
  for update;
  if not found then
    raise exception 'PLANNING_GOAL_MISSING' using errcode = '23503';
  end if;

  select count(*) into v_count from public.study_tasks t
  where t.goal_id = p_goal_id and t.user_id = p_user_id;
  if cardinality(p_task_ids) <> v_count
    or (select count(distinct x.task_id) from unnest(p_task_ids) as x(task_id)) <> v_count
    or (select count(*) from public.study_tasks t
        where t.goal_id = p_goal_id and t.user_id = p_user_id
          and t.id = any(p_task_ids)) <> v_count then
    raise exception 'PLANNING_ORDER_CONFLICT' using errcode = '23514';
  end if;

  update public.study_tasks t
  set sort_order = ordered.ordinality * 1000
  from unnest(p_task_ids) with ordinality as ordered(task_id, ordinality)
  where t.id = ordered.task_id and t.goal_id = p_goal_id and t.user_id = p_user_id;

  return query
  select t.id, t.sort_order from public.study_tasks t
  where t.goal_id = p_goal_id and t.user_id = p_user_id
  order by t.sort_order, t.created_at, t.id;
end
$reorder$;

revoke all on function public.study_reorder_tasks(uuid, uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.study_reorder_tasks(uuid, uuid, uuid[])
to service_role;

alter table public.study_goals enable row level security;
alter table public.study_tasks enable row level security;
alter table public.study_subgoals enable row level security;

create policy study_goals_select_own on public.study_goals
  for select to authenticated using (user_id = (select auth.uid()));
create policy study_tasks_select_own on public.study_tasks
  for select to authenticated using (user_id = (select auth.uid()));

create policy study_subgoals_select_own on public.study_subgoals
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on table public.study_goals, public.study_subgoals, public.study_tasks
  from public, anon, authenticated;
grant select, insert, update, delete on table public.study_goals, public.study_subgoals, public.study_tasks
  to service_role;
commit;
