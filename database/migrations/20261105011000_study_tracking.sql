-- E08/E09 candidata. Depende de E05: materials UNIQUE(id,user_id). Nao aplicada.
begin;
create table public.study_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  weekly_goal_minutes integer not null default 120 check (weekly_goal_minutes between 0 and 10080),
  timezone text not null default 'UTC',
  updated_at timestamptz not null default now()
);
create table public.study_progress (
  material_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position_seconds numeric not null default 0 check (position_seconds between 0 and 7200),
  duration_seconds numeric not null default 0 check (duration_seconds between 0 and 7200),
  playback_rate numeric not null default 1 check (playback_rate between 0.5 and 3),
  completed boolean not null default false,
  intervals jsonb not null default '[]' check (jsonb_typeof(intervals)='array'),
  version integer not null default 0,
  last_request_id uuid, last_patch jsonb,
  updated_at timestamptz not null default now(),
  primary key(user_id,material_id),
  foreign key(material_id,user_id) references public.materials(id,user_id) on delete cascade
);
create table public.study_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid,
  kind text not null check (kind in ('reading','pomodoro')),
  started_at timestamptz not null default clock_timestamp(),
  last_tick_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  total_seconds integer not null default 0 check (total_seconds between 0 and 86400),
  last_sequence integer not null default 0,
  last_active boolean, last_close boolean,
  unique(id,user_id),
  foreign key(material_id,user_id) references public.materials(id,user_id) on delete set null (material_id)
);
create unique index study_one_active_session on public.study_sessions(user_id) where ended_at is null;
create index study_session_user_time on public.study_sessions(user_id,started_at desc);
create table public.study_time_credits (
  session_id uuid not null,
  user_id uuid not null,
  sequence integer not null,
  credited_at timestamptz not null default clock_timestamp(),
  seconds integer not null check (seconds between 1 and 30),
  primary key(session_id,sequence),
  foreign key(session_id,user_id) references public.study_sessions(id,user_id) on delete cascade
);
create index study_credit_user_time on public.study_time_credits(user_id,credited_at);
alter table public.study_settings enable row level security;
alter table public.study_progress enable row level security;
alter table public.study_sessions enable row level security;
alter table public.study_time_credits enable row level security;
revoke all on public.study_settings,public.study_progress,public.study_sessions,public.study_time_credits from public,anon,authenticated;
grant select,insert,update,delete on public.study_settings,public.study_progress,public.study_sessions,public.study_time_credits to service_role;

create function public.study_save_progress_admin(p_user_id uuid,p_material_id uuid,p_version integer,p_request_id uuid,p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.study_progress; d numeric; merged jsonb;
begin
  if not exists(select 1 from public.materials where id=p_material_id and user_id=p_user_id) then raise exception 'STUDY_NOT_FOUND'; end if;
  if p_request_id is null or p_version is null or p_version<0 or p_patch is null or jsonb_typeof(p_patch)<>'object'
    or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('position','playbackRate','completed','intervals'))
    then raise exception 'STUDY_INVALID_INPUT'; end if;
  select least(7200,coalesce(duration_ms,0)::numeric/1000) into d from public.audio_files where material_id=p_material_id;
  d:=coalesce(d,0);
  insert into public.study_progress(user_id,material_id) values(p_user_id,p_material_id) on conflict do nothing;
  select * into r from public.study_progress where user_id=p_user_id and material_id=p_material_id for update;
  if r.last_request_id=p_request_id then
    if r.last_patch is distinct from p_patch then raise exception 'STUDY_REQUEST_CONFLICT'; end if;
    return to_jsonb(r);
  end if;
  if r.version<>p_version then raise exception 'STUDY_PROGRESS_CONFLICT'; end if;
  if p_patch ? 'position' and (jsonb_typeof(p_patch->'position')<>'number' or (p_patch->>'position')::numeric not between 0 and 7200)
    then raise exception 'STUDY_INVALID_INPUT'; end if;
  if p_patch ? 'playbackRate' and (jsonb_typeof(p_patch->'playbackRate')<>'number' or (p_patch->>'playbackRate')::numeric not in (0.5,0.75,1,1.25,1.5,2,2.5,3))
    then raise exception 'STUDY_INVALID_INPUT'; end if;
  if p_patch ? 'completed' and jsonb_typeof(p_patch->'completed')<>'boolean' then raise exception 'STUDY_INVALID_INPUT'; end if;
  merged:=r.intervals;
  if p_patch ? 'intervals' then
    if jsonb_typeof(p_patch->'intervals')<>'array' or jsonb_array_length(p_patch->'intervals')>300 then raise exception 'STUDY_INVALID_INPUT'; end if;
    if exists(select 1 from jsonb_array_elements(p_patch->'intervals') e
      where jsonb_typeof(e)<>'array' or jsonb_array_length(e)<>2 or jsonb_typeof(e->0)<>'number' or jsonb_typeof(e->1)<>'number'
        or (e->>0)::numeric<0 or (e->>1)::numeric<=(e->>0)::numeric or (e->>1)::numeric>7200)
      then raise exception 'STUDY_INVALID_INPUT'; end if;
    with spans as (
      select greatest(0,(e->>0)::numeric) a,least(d,(e->>1)::numeric) b
      from jsonb_array_elements(r.intervals || (p_patch->'intervals')) e
    ), previous as (
      select a,b,max(b) over(order by a,b rows between unbounded preceding and 1 preceding) prev from spans where b>a
    ), groups as (
      select a,b,sum(case when prev is null or a>prev then 1 else 0 end) over(order by a,b) g from previous
    ), unions as (select min(a) a,max(b) b from groups group by g order by min(a))
    select coalesce(jsonb_agg(jsonb_build_array(a,b) order by a),'[]'::jsonb) into merged from unions;
    if jsonb_array_length(merged)>600 then raise exception 'STUDY_INTERVAL_LIMIT'; end if;
  end if;
  update public.study_progress set
    position_seconds=least(d,coalesce((p_patch->>'position')::numeric,r.position_seconds)),duration_seconds=d,
    playback_rate=coalesce((p_patch->>'playbackRate')::numeric,r.playback_rate),
    completed=coalesce((p_patch->>'completed')::boolean,r.completed),intervals=merged,
    version=r.version+1,last_request_id=p_request_id,last_patch=p_patch,updated_at=clock_timestamp()
    where user_id=p_user_id and material_id=p_material_id returning * into r;
  return to_jsonb(r);
end $$;

create function public.study_start_session_admin(p_user_id uuid,p_session_id uuid,p_material_id uuid,p_kind text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.study_sessions; t timestamptz:=clock_timestamp();
begin
  if p_session_id is null or p_kind not in ('reading','pomodoro') or p_kind is null then raise exception 'STUDY_INVALID_INPUT'; end if;
  if p_material_id is not null and not exists(select 1 from public.materials where id=p_material_id and user_id=p_user_id) then raise exception 'STUDY_NOT_FOUND'; end if;
  insert into public.study_settings(user_id) values(p_user_id) on conflict do nothing;
  perform 1 from public.study_settings where user_id=p_user_id for update;
  select * into r from public.study_sessions where id=p_session_id;
  if found then
    if r.user_id<>p_user_id then raise exception 'STUDY_NOT_FOUND'; end if;
    if r.kind<>p_kind or r.material_id is distinct from p_material_id then raise exception 'STUDY_REQUEST_CONFLICT'; end if;
    return to_jsonb(r);
  end if;
  if exists(select 1 from public.study_sessions where user_id=p_user_id and ended_at is null and last_tick_at>t-interval '45 seconds')
    then raise exception 'STUDY_SESSION_ACTIVE'; end if;
  update public.study_sessions set ended_at=t where user_id=p_user_id and ended_at is null;
  insert into public.study_sessions(id,user_id,material_id,kind,started_at,last_tick_at)
    values(p_session_id,p_user_id,p_material_id,p_kind,t,t) returning * into r;
  return to_jsonb(r);
end $$;

create function public.study_tick_session_admin(p_user_id uuid,p_session_id uuid,p_sequence integer,p_active boolean,p_close boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.study_sessions; t timestamptz:=clock_timestamp(); elapsed numeric; credit integer:=0;
begin
  perform 1 from public.study_settings where user_id=p_user_id for update;
  select * into r from public.study_sessions where id=p_session_id and user_id=p_user_id for update;
  if not found then raise exception 'STUDY_NOT_FOUND'; end if;
  if p_sequence is null or p_sequence<1 or p_active is null or p_close is null then raise exception 'STUDY_INVALID_INPUT'; end if;
  if p_sequence=r.last_sequence and r.last_active is not distinct from p_active and r.last_close is not distinct from p_close then return to_jsonb(r); end if;
  if p_sequence is null or p_sequence<>r.last_sequence+1 or p_active is null or p_close is null then raise exception 'STUDY_REQUEST_CONFLICT'; end if;
  if r.ended_at is not null then return to_jsonb(r); end if;
  elapsed:=extract(epoch from t-r.last_tick_at);
  if p_active and elapsed>=0 and elapsed<=45 then credit:=least(30,floor(elapsed)::integer,86400-r.total_seconds); end if;
  if credit>0 then insert into public.study_time_credits(session_id,user_id,sequence,credited_at,seconds)
    values(p_session_id,p_user_id,p_sequence,t,credit); end if;
  update public.study_sessions set last_tick_at=t,last_sequence=p_sequence,last_active=p_active,last_close=p_close,
    total_seconds=total_seconds+credit,
    ended_at=case when p_close or elapsed>45 or total_seconds+credit>=86400 then t else null end
    where id=p_session_id returning * into r;
  return to_jsonb(r);
end $$;

create function public.study_save_settings_admin(p_user_id uuid,p_goal integer,p_timezone text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.study_settings;
begin
  if p_goal is null or p_goal not between 0 and 10080 or p_timezone is null
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'STUDY_INVALID_INPUT'; end if;
  insert into public.study_settings(user_id,weekly_goal_minutes,timezone) values(p_user_id,p_goal,p_timezone)
    on conflict(user_id) do update set weekly_goal_minutes=p_goal,timezone=p_timezone,updated_at=clock_timestamp()
    returning * into r;
  return to_jsonb(r);
end $$;

create function public.study_overview_admin(p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg public.study_settings; week date; t timestamptz:=clock_timestamp(); days jsonb;
begin
  select * into cfg from public.study_settings where user_id=p_user_id;
  if not found then cfg.weekly_goal_minutes:=120; cfg.timezone:='UTC'; end if;
  week:=date_trunc('week',t at time zone cfg.timezone)::date;
  select jsonb_agg(jsonb_build_object('date',d::date,'seconds',coalesce((
    select sum(c.seconds) from public.study_time_credits c where c.user_id=p_user_id
      and c.credited_at>=(week::timestamp at time zone cfg.timezone)
      and c.credited_at<((week+7)::timestamp at time zone cfg.timezone)
      and (c.credited_at at time zone cfg.timezone)::date=d::date),0)) order by d)
    into days from generate_series(week::timestamp,(week+6)::timestamp,interval '1 day') d;
  return jsonb_build_object('weekStart',week,'timezone',cfg.timezone,'goalMinutes',cfg.weekly_goal_minutes,'days',days,
    'weekSeconds',coalesce((select sum((e->>'seconds')::integer) from jsonb_array_elements(days) e),0),
    'completedMaterials',(select count(*) from public.study_progress where user_id=p_user_id and completed),
    'activeSession',(select to_jsonb(s) from public.study_sessions s where user_id=p_user_id and ended_at is null and last_tick_at>t-interval '45 seconds'));
end $$;
revoke all on function public.study_save_progress_admin(uuid,uuid,integer,uuid,jsonb),
  public.study_start_session_admin(uuid,uuid,uuid,text),public.study_tick_session_admin(uuid,uuid,integer,boolean,boolean),
  public.study_save_settings_admin(uuid,integer,text),public.study_overview_admin(uuid) from public,anon,authenticated;
grant execute on function public.study_save_progress_admin(uuid,uuid,integer,uuid,jsonb),
  public.study_start_session_admin(uuid,uuid,uuid,text),public.study_tick_session_admin(uuid,uuid,integer,boolean,boolean),
  public.study_save_settings_admin(uuid,integer,text),public.study_overview_admin(uuid) to service_role;
commit;
