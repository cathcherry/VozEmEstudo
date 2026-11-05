-- E18/E19 candidata. Calendário privado e cópias compartilháveis revogáveis. Não aplicada.
begin;
alter table public.study_tasks add constraint study_tasks_calendar_owner_unique unique(id,user_id);
create table public.study_calendar_events (
  id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(length(trim(title)) between 1 and 200),description text not null default '' check(length(description)<=3000),
  starts_at timestamptz not null,ends_at timestamptz not null,material_id uuid,task_id uuid,
  version integer not null default 1,last_request_id uuid not null,last_body jsonb not null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),deleted_at timestamptz,
  foreign key(material_id,user_id) references public.materials(id,user_id) on delete set null(material_id),
  foreign key(task_id,user_id) references public.study_tasks(id,user_id) on delete set null(task_id),
  check(ends_at>starts_at and ends_at<=starts_at+interval '7 days')
);
create index calendar_owner_start on public.study_calendar_events(user_id,starts_at);
create table public.material_shares (
  id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,material_id uuid not null,
  request_id uuid not null,token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
  source_revision_id uuid not null references public.transcription_versions(id) on delete cascade,
  include_transcript boolean not null,include_summary boolean not null,expiry_days integer not null check(expiry_days in(1,7,30)),
  snapshot jsonb not null check(length(snapshot::text)<=200000),created_at timestamptz not null default now(),expires_at timestamptz not null,revoked_at timestamptz,
  unique(user_id,request_id),foreign key(material_id,user_id) references public.materials(id,user_id) on delete cascade,
  check(include_transcript or include_summary)
);
create index shares_owner_created on public.material_shares(user_id,created_at desc);
alter table public.study_calendar_events enable row level security;
alter table public.material_shares enable row level security;
revoke all on public.study_calendar_events,public.material_shares from public,anon,authenticated;
grant select,insert,update,delete on public.study_calendar_events,public.material_shares to service_role;

create function public.study_save_calendar_admin(p_user_id uuid,p_id uuid,p_version integer,p_request_id uuid,p_body jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.study_calendar_events;
begin
  if p_body->>'materialId' is not null and not exists(select 1 from public.materials where id=(p_body->>'materialId')::uuid and user_id=p_user_id) then raise exception 'LEARNING_NOT_FOUND';end if;
  if p_body->>'taskId' is not null and not exists(select 1 from public.study_tasks where id=(p_body->>'taskId')::uuid and user_id=p_user_id) then raise exception 'LEARNING_NOT_FOUND';end if;
  select * into r from public.study_calendar_events where id=p_id for update;
  if found then
    if r.user_id<>p_user_id then raise exception 'LEARNING_NOT_FOUND';end if;
    if r.last_request_id=p_request_id then
      if r.last_body is distinct from p_body then raise exception 'LEARNING_REQUEST_CONFLICT';end if;return to_jsonb(r);
    end if;
    if r.version<>p_version then raise exception 'LEARNING_VERSION_CONFLICT';end if;
    update public.study_calendar_events set title=coalesce(p_body->>'title',title),description=coalesce(p_body->>'description',description),
      starts_at=coalesce((p_body->>'startsAt')::timestamptz,starts_at),ends_at=coalesce((p_body->>'endsAt')::timestamptz,ends_at),
      material_id=case when p_body ? 'materialId' then (p_body->>'materialId')::uuid else material_id end,
      task_id=case when p_body ? 'taskId' then (p_body->>'taskId')::uuid else task_id end,
      deleted_at=case when (p_body->>'deleted')::boolean then clock_timestamp() else deleted_at end,
      version=version+1,last_request_id=p_request_id,last_body=p_body,updated_at=clock_timestamp() where id=p_id returning * into r;
  else
    if p_version<>0 then raise exception 'LEARNING_VERSION_CONFLICT';end if;
    insert into public.study_calendar_events(id,user_id,title,description,starts_at,ends_at,material_id,task_id,last_request_id,last_body)
      values(p_id,p_user_id,p_body->>'title',coalesce(p_body->>'description',''),(p_body->>'startsAt')::timestamptz,(p_body->>'endsAt')::timestamptz,
        (p_body->>'materialId')::uuid,(p_body->>'taskId')::uuid,p_request_id,p_body) returning * into r;
  end if;return to_jsonb(r);
end $$;
create function public.study_calendar_feed_admin(p_user_id uuid,p_from timestamptz,p_to timestamptz,p_from_day date,p_to_day date,p_offset integer)
returns jsonb language sql security invoker set search_path='' as $$
  with items as (
    select e.starts_at sort_time,e.id, jsonb_build_object('kind','event','id',e.id,'title',e.title,'description',e.description,
      'startsAt',e.starts_at,'endsAt',e.ends_at,'materialId',e.material_id,'taskId',e.task_id,'version',e.version) item
      from public.study_calendar_events e where e.user_id=p_user_id and e.deleted_at is null and e.starts_at<p_to and e.ends_at>p_from
    union all
    select t.due_date::timestamp at time zone 'UTC',t.id,jsonb_build_object('kind','task','id',t.id,'title',t.title,'date',t.due_date,'materialId',t.material_id)
      from public.study_tasks t join public.study_goals g on g.id=t.goal_id and g.user_id=t.user_id
      where t.user_id=p_user_id and t.completed_at is null and g.status<>'archived' and t.due_date>=p_from_day and t.due_date<p_to_day
  ), page as (select * from items order by sort_time,id limit 100 offset p_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(item order by sort_time,id) from page),'[]'::jsonb),
    'total',(select count(*) from items),'limit',100,'offset',p_offset)
$$;
create function public.study_create_share_admin(p_user_id uuid,p_id uuid,p_material_id uuid,p_request_id uuid,p_hash text,p_revision_id uuid,p_transcript boolean,p_summary boolean,p_days integer,p_permission_version text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.materials;v public.transcription_versions;s public.summary_versions;r public.material_shares;snap jsonb;
begin
  select * into m from public.materials where id=p_material_id and user_id=p_user_id for update;
  if not found then raise exception 'LEARNING_NOT_FOUND';end if;
  select * into r from public.material_shares where user_id=p_user_id and request_id=p_request_id;
  if found then
    if r.material_id<>p_material_id or r.token_hash<>p_hash or r.source_revision_id<>p_revision_id or r.include_transcript<>p_transcript or r.include_summary<>p_summary or r.expiry_days<>p_days
      then raise exception 'LEARNING_REQUEST_CONFLICT';end if;
    return jsonb_build_object('id',r.id,'expiresAt',r.expires_at);
  end if;
  if p_days not in(1,7,30) or not (p_transcript or p_summary) then raise exception 'LEARNING_INVALID_INPUT';end if;
  perform public.require_material_permission_admin(p_user_id,p_material_id,p_permission_version);
  select tv.* into v from public.transcription_versions tv join public.transcriptions t on t.id=tv.transcription_id
    where tv.id=p_revision_id and t.material_id=p_material_id and tv.revision=t.current_revision;
  if not found or not exists(select 1 from public.transcription_confirmations where user_id=p_user_id and material_id=p_material_id
    and transcription_version_id=p_revision_id and consent_version=p_permission_version) then raise exception 'LEARNING_CONFIRMATION_REQUIRED';end if;
  snap:=jsonb_build_object('title',m.title,'subject',m.subject,'revision',v.revision);
  if p_transcript then snap:=snap||jsonb_build_object('transcript',v.full_text);end if;
  if p_summary then
    select * into s from public.summary_versions where material_id=p_material_id and is_current and source_transcription_version_id=v.id;
    if not found then raise exception 'LEARNING_SUMMARY_REQUIRED';end if;
    snap:=snap||jsonb_build_object('summary',s.text,'summaryVersion',s.version);
  end if;
  if (select count(*) from public.material_shares where user_id=p_user_id and revoked_at is null and expires_at>clock_timestamp())>=100
    then raise exception 'LEARNING_SHARE_LIMIT';end if;
  insert into public.material_shares(id,user_id,material_id,request_id,token_hash,source_revision_id,include_transcript,include_summary,expiry_days,snapshot,expires_at)
    values(p_id,p_user_id,p_material_id,p_request_id,p_hash,p_revision_id,p_transcript,p_summary,p_days,snap,clock_timestamp()+make_interval(days=>p_days)) returning * into r;
  return jsonb_build_object('id',r.id,'expiresAt',r.expires_at);
end $$;
create function public.study_resolve_share_admin(p_hash text)
returns jsonb language sql security invoker set search_path='' as $$
  select snapshot from public.material_shares where token_hash=p_hash and revoked_at is null and expires_at>clock_timestamp()
$$;
revoke all on function public.study_save_calendar_admin(uuid,uuid,integer,uuid,jsonb),public.study_calendar_feed_admin(uuid,timestamptz,timestamptz,date,date,integer),
  public.study_create_share_admin(uuid,uuid,uuid,uuid,text,uuid,boolean,boolean,integer,text),public.study_resolve_share_admin(text) from public,anon,authenticated;
grant execute on function public.study_save_calendar_admin(uuid,uuid,integer,uuid,jsonb),public.study_calendar_feed_admin(uuid,timestamptz,timestamptz,date,date,integer),
  public.study_create_share_admin(uuid,uuid,uuid,uuid,text,uuid,boolean,boolean,integer,text),public.study_resolve_share_admin(text) to service_role;
commit;
