-- E14/E15 candidata: anotações privadas ligadas a revisões imutáveis. Não aplicada.
begin;
create table public.study_annotations (
  id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null,source_revision_id uuid not null references public.transcription_versions(id) on delete cascade,
  source_revision integer not null,segment_position integer,start_offset integer,end_offset integer,
  quote text not null default '' check(length(quote)<=1000),note_text text not null default '' check(length(note_text)<=5000),
  color text not null default 'yellow' check(color in ('yellow','green','blue')),
  version integer not null default 1,last_request_id uuid not null,last_body jsonb not null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),deleted_at timestamptz,
  foreign key(material_id,user_id) references public.materials(id,user_id) on delete cascade,
  check(length(trim(note_text))>0 or length(quote)>0)
);
create index annotation_owner_material on public.study_annotations(user_id,material_id,created_at desc);
alter table public.study_annotations enable row level security;
revoke all on public.study_annotations from public,anon,authenticated;
grant select,insert,update,delete on public.study_annotations to service_role;
create function public.study_save_annotation_admin(p_user_id uuid,p_id uuid,p_material_id uuid,p_version integer,p_request_id uuid,p_body jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.study_annotations;v public.transcription_versions;segment text;
begin
  perform 1 from public.materials where id=p_material_id and user_id=p_user_id for update;
  if not found then raise exception 'LEARNING_NOT_FOUND';end if;
  select * into r from public.study_annotations where id=p_id for update;
  if found then
    if r.user_id<>p_user_id or r.material_id<>p_material_id then raise exception 'LEARNING_NOT_FOUND';end if;
    if r.last_request_id=p_request_id then
      if r.last_body is distinct from p_body then raise exception 'LEARNING_REQUEST_CONFLICT';end if;return to_jsonb(r);
    end if;
    if r.version<>p_version then raise exception 'LEARNING_VERSION_CONFLICT';end if;
    if p_body ?| array['sourceRevisionId','segmentPosition','startOffset','endOffset','quote'] then raise exception 'LEARNING_ANCHOR_IMMUTABLE';end if;
    update public.study_annotations set note_text=coalesce(p_body->>'noteText',note_text),color=coalesce(p_body->>'color',color),
      deleted_at=case when p_body ? 'deleted' then case when (p_body->>'deleted')::boolean then clock_timestamp() else null end else deleted_at end,
      version=version+1,last_request_id=p_request_id,last_body=p_body,updated_at=clock_timestamp() where id=p_id returning * into r;
  else
    if p_version<>0 then raise exception 'LEARNING_VERSION_CONFLICT';end if;
    select tv.* into v from public.transcription_versions tv join public.transcriptions t on t.id=tv.transcription_id
      where tv.id=(p_body->>'sourceRevisionId')::uuid and t.material_id=p_material_id;
    if not found then raise exception 'LEARNING_NOT_FOUND';end if;
    if coalesce(p_body->>'quote','')<>'' then
      select e->>'text' into segment from jsonb_array_elements(v.segments_snapshot) e
        where (e->>'position')::integer=(p_body->>'segmentPosition')::integer;
      if segment is null or (p_body->>'startOffset')::integer<0 or (p_body->>'endOffset')::integer>length(segment) or (p_body->>'endOffset')::integer<=(p_body->>'startOffset')::integer
        or substring(segment from (p_body->>'startOffset')::integer+1 for (p_body->>'endOffset')::integer-(p_body->>'startOffset')::integer) is distinct from p_body->>'quote'
        then raise exception 'LEARNING_ANCHOR_CONFLICT';end if;
    end if;
    insert into public.study_annotations(id,user_id,material_id,source_revision_id,source_revision,segment_position,start_offset,end_offset,quote,note_text,color,last_request_id,last_body)
      values(p_id,p_user_id,p_material_id,v.id,v.revision,(p_body->>'segmentPosition')::integer,(p_body->>'startOffset')::integer,(p_body->>'endOffset')::integer,
        coalesce(p_body->>'quote',''),coalesce(p_body->>'noteText',''),coalesce(p_body->>'color','yellow'),p_request_id,p_body) returning * into r;
  end if;
  return to_jsonb(r);
end $$;
create function public.study_list_annotations_admin(p_user_id uuid,p_material_id uuid,p_query text,p_offset integer)
returns jsonb language sql security invoker set search_path='' as $$
  with matches as (select * from public.study_annotations where user_id=p_user_id and deleted_at is null
    and (p_material_id is null or material_id=p_material_id)
    and (coalesce(p_query,'')='' or position(lower(p_query) in lower(note_text||' '||quote))>0)),
  page as (select * from matches order by created_at desc,id limit 50 offset p_offset)
  select jsonb_build_object('notes',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id) from page),'[]'::jsonb),
    'total',(select count(*) from matches),'offset',p_offset,'limit',50)
$$;
revoke all on function public.study_save_annotation_admin(uuid,uuid,uuid,integer,uuid,jsonb),public.study_list_annotations_admin(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.study_save_annotation_admin(uuid,uuid,uuid,integer,uuid,jsonb),public.study_list_annotations_admin(uuid,uuid,text,integer) to service_role;
commit;
