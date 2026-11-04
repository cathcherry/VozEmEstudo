-- E10: candidato transacional; NAO EXECUTAR sem backup, preflight e aprovacao.
-- Depende E05 (FK composta em materials). Nao altera gabaritos/materiais legados.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $g$ begin
  if to_regclass('public.study_tasks') is null
    or to_regclass('public.question_batches') is null
    or to_regclass('public.questions') is null
    or not exists (select 1 from pg_constraint where conrelid='public.materials'::regclass
      and conname='materials_id_user_planning_unique') then
    raise exception 'E10_ABORT: aplicar e verificar E03/E05 antes de E10';
  end if;
  if to_regclass('public.quiz_sessions') is not null
    or to_regclass('public.quiz_session_answers') is not null
    or to_regprocedure('public.quiz_submit_answer_admin(uuid,uuid,uuid,integer)') is not null then
    raise exception 'E10_ABORT: objetos E10 ja existem, nao reaplicar';
  end if;
end $g$;

alter table public.question_batches add constraint quiz_batches_id_material_unique unique(id,material_id);
alter table public.questions add constraint quiz_questions_id_batch_unique unique(id,batch_id);

create table public.quiz_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null,
  batch_id uuid not null,
  feedback_mode text not null check (feedback_mode in ('immediate','deferred')),
  status text not null default 'active' check (status in ('active','completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint quiz_sessions_material_owner_fk foreign key(material_id,user_id)
    references public.materials(id,user_id) on delete cascade,
  constraint quiz_sessions_batch_material_fk foreign key(batch_id,material_id)
    references public.question_batches(id,material_id) on delete cascade,
  constraint quiz_sessions_scope_unique unique(id,user_id,batch_id),
  constraint quiz_sessions_completed_check check (
    (status='active' and completed_at is null) or
    (status='completed' and completed_at is not null))
);
create table public.quiz_session_answers (
  session_id uuid not null,
  user_id uuid not null,
  batch_id uuid not null,
  question_id uuid not null,
  selected_index integer not null check(selected_index between 0 and 3),
  is_correct boolean not null,
  answered_at timestamptz not null default now(),
  primary key(session_id,question_id),
  constraint quiz_answers_owned_session_fk foreign key(session_id,user_id,batch_id)
    references public.quiz_sessions(id,user_id,batch_id) on delete cascade,
  constraint quiz_answers_question_in_batch_fk foreign key(question_id,batch_id)
    references public.questions(id,batch_id) on delete cascade
);
create index quiz_sessions_owner_created_idx on public.quiz_sessions(user_id,created_at desc);
create index quiz_sessions_batch_idx on public.quiz_sessions(batch_id);
create index quiz_answers_user_session_idx on public.quiz_session_answers(user_id,session_id);

-- Gabarito e enviado apenas ao responder no modo imediato.
-- Finalizacao segura ocorre no RPC independente e libera revisao do modo deferred.
create function public.quiz_submit_answer_admin(
  p_user_id uuid, p_session_id uuid, p_question_id uuid, p_selected_index integer
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public as $fn$
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
  if not found then raise exception 'QUIZ_SESSION_NOT_FOUND' using errcode='P0001'; end if;
  if v_session.status <> 'active' then
    raise exception 'QUIZ_SESSION_COMPLETE' using errcode='P0001';
  end if;
  select * into v_question from public.questions
  where id=p_question_id and batch_id=v_session.batch_id;
  if not found then
    raise exception 'QUIZ_QUESTION_NOT_IN_SESSION' using errcode='P0001';
  end if;
  insert into public.quiz_session_answers(
    session_id,user_id,batch_id,question_id,selected_index,is_correct
  ) values (v_session.id,v_session.user_id,v_session.batch_id,v_question.id,
    p_selected_index,p_selected_index=v_question.correct_index)
  on conflict(session_id,question_id) do nothing;
  select * into v_answer from public.quiz_session_answers
  where session_id=p_session_id and question_id=p_question_id;
  if v_answer.selected_index <> p_selected_index then
    raise exception 'QUIZ_ALREADY_ANSWERED' using errcode='P0001';
  end if;
  if v_session.feedback_mode='immediate' then
    return jsonb_build_object(
      'recorded',true,'selectedIndex',v_answer.selected_index,
      'correct',v_answer.is_correct,'correctIndex',v_question.correct_index,
      'explanation',v_question.explanation);
  end if;
  return jsonb_build_object('recorded',true,'selectedIndex',v_answer.selected_index);
end $fn$;

create function public.quiz_finish_session_admin(
  p_user_id uuid,p_session_id uuid
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public as $fn$
declare
  v_session public.quiz_sessions%rowtype;
  v_total integer;
  v_answered integer;
begin
  select * into v_session from public.quiz_sessions
  where id=p_session_id and user_id=p_user_id for update;
  if not found then raise exception 'QUIZ_SESSION_NOT_FOUND' using errcode='P0001'; end if;
  if v_session.status='completed' then
    return jsonb_build_object('status','completed','completedAt',v_session.completed_at);
  end if;
  select count(*) into v_total from public.questions where batch_id=v_session.batch_id;
  select count(*) into v_answered from public.quiz_session_answers
  where session_id=v_session.id and user_id=p_user_id;
  if v_total=0 or v_total<>v_answered then
    raise exception 'QUIZ_INCOMPLETE' using errcode='P0001';
  end if;
  update public.quiz_sessions set status='completed',completed_at=now()
  where id=v_session.id returning * into v_session;
  return jsonb_build_object('status','completed','completedAt',v_session.completed_at);
end $fn$;

alter table public.quiz_sessions enable row level security;
alter table public.quiz_session_answers enable row level security;
create policy quiz_sessions_select_own on public.quiz_sessions
  for select to authenticated using(user_id=(select auth.uid()));
create policy quiz_answers_select_own on public.quiz_session_answers
  for select to authenticated using(user_id=(select auth.uid()));

revoke all on table public.quiz_sessions,public.quiz_session_answers from public,anon,authenticated;
grant select,insert,update,delete on table public.quiz_sessions,public.quiz_session_answers to service_role;
revoke all on function public.quiz_submit_answer_admin(uuid,uuid,uuid,integer)
  from public,anon,authenticated;
revoke all on function public.quiz_finish_session_admin(uuid,uuid) from public,anon,authenticated;
grant execute on function public.quiz_submit_answer_admin(uuid,uuid,uuid,integer) to service_role;
grant execute on function public.quiz_finish_session_admin(uuid,uuid) to service_role;
commit;
