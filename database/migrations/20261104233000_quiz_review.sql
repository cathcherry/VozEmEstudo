-- E12: revisao de erros de sessoes E10, sem duplicar questoes.
-- CANDIDATA NAO EXECUTADA. Depende de E10; usar backup, preflight e autorizacao.
-- Tudo em uma transacao. Desativar FEATURE_QUIZ_REVIEW ate confirmar postflight.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

do $guard$
begin
  if to_regclass('public.quiz_sessions') is null
    or to_regclass('public.quiz_session_answers') is null
    or to_regprocedure('public.quiz_submit_answer_admin(uuid,uuid,uuid,integer)') is null
    or to_regprocedure('public.quiz_finish_session_admin(uuid,uuid)') is null then
    raise exception 'E12_ABORT: E10 ainda nao esta instalado e verificado';
  end if;
  if to_regclass('public.quiz_session_items') is not null
    or to_regprocedure('public.quiz_create_review_session_admin(uuid,uuid,text)') is not null
    or exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='quiz_sessions'
        and column_name in ('kind','source_session_id')
    ) then
    raise exception 'E12_ABORT: objetos E12 ja existem, nao reaplicar';
  end if;
end $guard$;

alter table public.quiz_sessions
  add column kind text not null default 'full'
    check(kind in ('full','review')),
  add column source_session_id uuid,
  add constraint quiz_review_source_scope_fk
    foreign key (source_session_id,user_id,batch_id)
    references public.quiz_sessions(id,user_id,batch_id) on delete cascade,
  add constraint quiz_review_kind_source_check
    check ((kind='full' and source_session_id is null)
      or (kind='review' and source_session_id is not null));

-- These are REFERENCES to original questions. No question rows or answers copied.
create table public.quiz_session_items (
  session_id uuid not null,
  user_id uuid not null,
  batch_id uuid not null,
  question_id uuid not null,
  position integer not null check(position>=0),
  primary key(session_id,question_id),
  constraint quiz_review_item_position_unique unique(session_id,position),
  constraint quiz_review_item_session_scope_fk
    foreign key(session_id,user_id,batch_id)
    references public.quiz_sessions(id,user_id,batch_id) on delete cascade,
  constraint quiz_review_item_question_batch_fk
    foreign key(question_id,batch_id)
    references public.questions(id,batch_id) on delete cascade
);
create index quiz_review_source_idx on public.quiz_sessions(source_session_id)
  where source_session_id is not null;
create index quiz_review_items_question_idx on public.quiz_session_items(question_id);

-- Only completed, owned sessions can source a review. The server chooses
-- wrong question IDs using stored answers, not an untrusted client list.
create function public.quiz_create_review_session_admin(
  p_user_id uuid,p_source_session_id uuid,p_feedback_mode text
) returns uuid
language plpgsql security invoker
set search_path=pg_catalog,public as $review$
declare
  v_source public.quiz_sessions%rowtype;
  v_new_id uuid;
  v_wrong_count integer;
begin
  if p_feedback_mode not in ('immediate','deferred') or p_feedback_mode is null then
    raise exception 'QUIZ_INVALID_FEEDBACK_MODE' using errcode='P0001';
  end if;
  select * into v_source from public.quiz_sessions
  where id=p_source_session_id and user_id=p_user_id for share;
  if not found then
    raise exception 'QUIZ_SESSION_NOT_FOUND' using errcode='P0001';
  end if;
  if v_source.status<>'completed' then
    raise exception 'QUIZ_REVIEW_LOCKED' using errcode='P0001';
  end if;
  select count(*) into v_wrong_count from public.quiz_session_answers a
  where a.session_id=v_source.id and a.user_id=p_user_id and not a.is_correct;
  if v_wrong_count=0 then
    raise exception 'QUIZ_NOTHING_TO_REVIEW' using errcode='P0001';
  end if;

  insert into public.quiz_sessions(
    user_id,material_id,batch_id,feedback_mode,kind,source_session_id
  ) values (
    p_user_id,v_source.material_id,v_source.batch_id,p_feedback_mode,'review',v_source.id
  ) returning id into v_new_id;

  insert into public.quiz_session_items(
    session_id,user_id,batch_id,question_id,position
  )
  select v_new_id,p_user_id,v_source.batch_id,a.question_id,
    (row_number() over(order by q.position,q.id)-1)::integer
  from public.quiz_session_answers a
  join public.questions q on q.id=a.question_id and q.batch_id=v_source.batch_id
  where a.session_id=v_source.id and a.user_id=p_user_id and not a.is_correct;

  return v_new_id;
end $review$;

-- E10 is replaced only after new table exists; signatures/return contracts
-- remain identical. This makes the source and review sessions interoperable.
create or replace function public.quiz_submit_answer_admin(
  p_user_id uuid,p_session_id uuid,p_question_id uuid,p_selected_index integer
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public as $submit$
declare
  v_session public.quiz_sessions%rowtype;
  v_question public.questions%rowtype;
  v_answer public.quiz_session_answers%rowtype;
begin
  if p_selected_index is null or p_selected_index not between 0 and 3 then
    raise exception 'QUIZ_INVALID_SELECTION' using errcode='P0001';
  end if;
  select * into v_session from public.quiz_sessions
  where id=p_session_id and user_id=p_user_id for update;
  if not found then
    raise exception 'QUIZ_SESSION_NOT_FOUND' using errcode='P0001';
  end if;
  if v_session.status<>'active' then
    raise exception 'QUIZ_SESSION_COMPLETE' using errcode='P0001';
  end if;
  select * into v_question from public.questions
  where id=p_question_id and batch_id=v_session.batch_id;
  if not found then
    raise exception 'QUIZ_QUESTION_NOT_IN_SESSION' using errcode='P0001';
  end if;
  if v_session.kind='review' and not exists(
    select 1 from public.quiz_session_items
    where session_id=v_session.id and user_id=p_user_id and question_id=p_question_id
  ) then
    raise exception 'QUIZ_QUESTION_NOT_IN_SESSION' using errcode='P0001';
  end if;

  insert into public.quiz_session_answers(
    session_id,user_id,batch_id,question_id,selected_index,is_correct
  ) values(
    v_session.id,v_session.user_id,v_session.batch_id,v_question.id,
    p_selected_index,p_selected_index=v_question.correct_index
  ) on conflict(session_id,question_id) do nothing;

  select * into v_answer from public.quiz_session_answers
  where session_id=p_session_id and question_id=p_question_id;
  if v_answer.selected_index<>p_selected_index then
    raise exception 'QUIZ_ALREADY_ANSWERED' using errcode='P0001';
  end if;
  if v_session.feedback_mode='immediate' then
    return jsonb_build_object(
      'recorded',true,'selectedIndex',v_answer.selected_index,
      'correct',v_answer.is_correct,'correctIndex',v_question.correct_index,
      'explanation',v_question.explanation
    );
  end if;
  return jsonb_build_object('recorded',true,'selectedIndex',v_answer.selected_index);
end $submit$;

create or replace function public.quiz_finish_session_admin(
  p_user_id uuid,p_session_id uuid
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public as $finish$
declare
  v_session public.quiz_sessions%rowtype;
  v_total integer;
  v_answered integer;
begin
  select * into v_session from public.quiz_sessions
  where id=p_session_id and user_id=p_user_id for update;
  if not found then
    raise exception 'QUIZ_SESSION_NOT_FOUND' using errcode='P0001';
  end if;
  if v_session.status='completed' then
    return jsonb_build_object('status','completed','completedAt',v_session.completed_at);
  end if;
  if v_session.kind='review' then
    select count(*) into v_total from public.quiz_session_items
      where session_id=v_session.id and user_id=p_user_id;
  else
    select count(*) into v_total from public.questions where batch_id=v_session.batch_id;
  end if;
  select count(*) into v_answered from public.quiz_session_answers
    where session_id=v_session.id and user_id=p_user_id;
  if v_total=0 or v_total<>v_answered then
    raise exception 'QUIZ_INCOMPLETE' using errcode='P0001';
  end if;
  update public.quiz_sessions set status='completed',completed_at=now()
    where id=v_session.id returning * into v_session;
  return jsonb_build_object('status','completed','completedAt',v_session.completed_at);
end $finish$;

alter table public.quiz_session_items enable row level security;
create policy quiz_review_items_select_own on public.quiz_session_items
for select to authenticated using (user_id=(select auth.uid()));
revoke all on table public.quiz_session_items from public,anon,authenticated;
grant select,insert,update,delete on table public.quiz_session_items to service_role;

revoke all on function public.quiz_create_review_session_admin(uuid,uuid,text)
  from public,anon,authenticated;
revoke all on function public.quiz_submit_answer_admin(uuid,uuid,uuid,integer)
  from public,anon,authenticated;
revoke all on function public.quiz_finish_session_admin(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.quiz_create_review_session_admin(uuid,uuid,text)
  to service_role;
grant execute on function public.quiz_submit_answer_admin(uuid,uuid,uuid,integer)
  to service_role;
grant execute on function public.quiz_finish_session_admin(uuid,uuid)
  to service_role;
commit;
