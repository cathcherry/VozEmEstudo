-- AudioEstudo — esquema inicial para Supabase/PostgreSQL
-- Aplicar primeiro em projeto de desenvolvimento.

create extension if not exists pgcrypto;

do $$ begin
  create type public.material_status as enum
    ('PENDENTE','PROCESSANDO','PARCIAL','PRONTO','FALHOU');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_status as enum
    ('PENDENTE','EM_EXECUCAO','AGUARDANDO_REPETICAO','CONCLUIDA','FALHOU','CANCELADA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_type as enum
    ('PROCESSAMENTO_INICIAL','REGERAR_RESUMO','GERAR_QUESTOES','RETRANSCRIBIR_AUDIO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.processing_stage as enum
    ('VALIDACAO','TRANSCRICAO','RESUMO','QUESTOES','FINALIZACAO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.revision_origin as enum
    ('ASR','EDICAO_USUARIO','RESTAURACAO');
exception when duplicate_object then null; end $$;

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  subject text,
  status public.material_status not null default 'PENDENTE',
  current_stage public.processing_stage,
  initial_question_count smallint not null default 5
    check (initial_question_count in (3,5,10,20)),
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists materials_user_created_idx
  on public.materials(user_id, created_at desc);

create table if not exists public.audio_files (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null unique references public.materials(id) on delete cascade,
  original_name text not null,
  mime_type text not null,
  extension text not null check (lower(extension) in ('mp3','wav','m4a')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 104857600),
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  retain_original boolean not null default false,
  storage_path text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.transcriptions (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null unique references public.materials(id) on delete cascade,
  language text not null default 'pt',
  current_revision integer not null default 1 check (current_revision >= 1),
  current_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transcription_segments (
  id uuid primary key default gen_random_uuid(),
  transcription_id uuid not null references public.transcriptions(id) on delete cascade,
  position integer not null check (position >= 0),
  start_ms bigint not null check (start_ms >= 0),
  end_ms bigint not null check (end_ms >= start_ms),
  original_text text not null,
  current_text text not null,
  edited_at timestamptz,
  unique(transcription_id, position)
);

create index if not exists transcription_segments_order_idx
  on public.transcription_segments(transcription_id, position);

create table if not exists public.transcription_versions (
  id uuid primary key default gen_random_uuid(),
  transcription_id uuid not null references public.transcriptions(id) on delete cascade,
  revision integer not null check (revision >= 1),
  origin public.revision_origin not null,
  full_text text not null,
  segments_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(transcription_id, revision)
);

create table if not exists public.summary_versions (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  version integer not null check (version >= 1),
  text text not null,
  source_transcription_revision integer not null check (source_transcription_revision >= 1),
  model text not null,
  prompt_version text not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique(material_id, version)
);

create unique index if not exists summary_one_current_idx
  on public.summary_versions(material_id)
  where is_current = true;

create table if not exists public.question_batches (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  source_transcription_revision integer not null check (source_transcription_revision >= 1),
  requested_count smallint not null check (requested_count in (3,5,10,20)),
  generated_count smallint not null check (generated_count >= 0),
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);

create index if not exists question_batches_material_idx
  on public.question_batches(material_id, created_at);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.question_batches(id) on delete cascade,
  position integer not null check (position >= 0),
  statement text not null,
  options jsonb not null,
  correct_index smallint not null check (correct_index between 0 and 3),
  explanation text,
  created_at timestamptz not null default now(),
  unique(batch_id, position),
  constraint questions_options_array check (
    jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4
  )
);

create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  type public.job_type not null,
  status public.job_status not null default 'PENDENTE',
  current_stage public.processing_stage,
  params jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts >= 1),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists processing_jobs_queue_idx
  on public.processing_jobs(status, next_attempt_at, created_at);

create table if not exists public.processing_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.processing_jobs(id) on delete cascade,
  status public.job_status,
  stage public.processing_stage,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists processing_job_events_job_idx
  on public.processing_job_events(job_id, created_at);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists materials_set_updated_at on public.materials;
create trigger materials_set_updated_at
before update on public.materials
for each row execute function public.set_updated_at();

drop trigger if exists transcriptions_set_updated_at on public.transcriptions;
create trigger transcriptions_set_updated_at
before update on public.transcriptions
for each row execute function public.set_updated_at();

drop trigger if exists processing_jobs_set_updated_at on public.processing_jobs;
create trigger processing_jobs_set_updated_at
before update on public.processing_jobs
for each row execute function public.set_updated_at();

-- Worker: reivindica um job elegível de maneira atômica.
create or replace function public.claim_next_processing_job(p_worker_id text)
returns setof public.processing_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  select id into v_job_id
  from public.processing_jobs
  where status in ('PENDENTE','AGUARDANDO_REPETICAO')
    and next_attempt_at <= now()
  order by created_at
  for update skip locked
  limit 1;

  if v_job_id is null then return; end if;

  update public.processing_jobs
  set status = 'EM_EXECUCAO',
      locked_at = now(),
      locked_by = p_worker_id,
      started_at = coalesce(started_at, now()),
      attempt_count = attempt_count + 1
  where id = v_job_id;

  return query
  select * from public.processing_jobs where id = v_job_id;
end;
$$;

-- Privilégios explícitos da Data API.
-- O projeto foi criado com "Automatically expose new tables" DESLIGADO.
-- Portanto, somente o papel de servidor recebe acesso às tabelas da aplicação.
-- O navegador usa Auth/Storage e acessa os dados da aplicação pela API Express.
grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.materials,
  public.audio_files,
  public.transcriptions,
  public.transcription_segments,
  public.transcription_versions,
  public.summary_versions,
  public.question_batches,
  public.questions,
  public.processing_jobs,
  public.processing_job_events
to service_role;
grant usage, select on all sequences in schema public to service_role;

-- O worker é o único chamador permitido da função de claim da fila.
revoke all on function public.claim_next_processing_job(text) from public, anon, authenticated;
grant execute on function public.claim_next_processing_job(text) to service_role;

-- Row Level Security
alter table public.materials enable row level security;
alter table public.audio_files enable row level security;
alter table public.transcriptions enable row level security;
alter table public.transcription_segments enable row level security;
alter table public.transcription_versions enable row level security;
alter table public.summary_versions enable row level security;
alter table public.question_batches enable row level security;
alter table public.questions enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.processing_job_events enable row level security;

create policy materials_select_own on public.materials
for select using (auth.uid() = user_id);
create policy materials_insert_own on public.materials
for insert with check (auth.uid() = user_id);
create policy materials_update_own on public.materials
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy materials_delete_own on public.materials
for delete using (auth.uid() = user_id);

create policy audio_files_select_own on public.audio_files
for select using (
  exists (select 1 from public.materials m
          where m.id = audio_files.material_id and m.user_id = auth.uid())
);

create policy transcriptions_select_own on public.transcriptions
for select using (
  exists (select 1 from public.materials m
          where m.id = transcriptions.material_id and m.user_id = auth.uid())
);

create policy transcription_segments_select_own on public.transcription_segments
for select using (
  exists (
    select 1 from public.transcriptions t
    join public.materials m on m.id = t.material_id
    where t.id = transcription_segments.transcription_id
      and m.user_id = auth.uid()
  )
);

create policy transcription_versions_select_own on public.transcription_versions
for select using (
  exists (
    select 1 from public.transcriptions t
    join public.materials m on m.id = t.material_id
    where t.id = transcription_versions.transcription_id
      and m.user_id = auth.uid()
  )
);

create policy summary_versions_select_own on public.summary_versions
for select using (
  exists (select 1 from public.materials m
          where m.id = summary_versions.material_id and m.user_id = auth.uid())
);

create policy question_batches_select_own on public.question_batches
for select using (
  exists (select 1 from public.materials m
          where m.id = question_batches.material_id and m.user_id = auth.uid())
);

create policy questions_select_own on public.questions
for select using (
  exists (
    select 1 from public.question_batches qb
    join public.materials m on m.id = qb.material_id
    where qb.id = questions.batch_id and m.user_id = auth.uid()
  )
);

create policy processing_jobs_select_own on public.processing_jobs
for select using (
  exists (select 1 from public.materials m
          where m.id = processing_jobs.material_id and m.user_id = auth.uid())
);

create policy processing_job_events_select_own on public.processing_job_events
for select using (
  exists (
    select 1 from public.processing_jobs j
    join public.materials m on m.id = j.material_id
    where j.id = processing_job_events.job_id and m.user_id = auth.uid()
  )
);

-- Escritas internas em saídas geradas/jobs podem ser feitas pelo backend/worker
-- com credencial administrativa mantida somente no servidor.

-- ============================================================
-- Complementos da implementação v0.1
-- ============================================================

-- Bucket privado de áudio: 100 MB e formatos utilizados pelo projeto.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audios',
  'audios',
  false,
  104857600,
  array['audio/mpeg','audio/wav','audio/x-wav','audio/mp4','audio/x-m4a','audio/m4a']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Upload do front-end: temp/{userId}/{materialId}/arquivo.ext
create policy "audio_upload_own_temp"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'audios'
  and (storage.foldername(name))[1] = 'temp'
  and (storage.foldername(name))[2] = (select auth.jwt()->>'sub')
);

-- Permite que o próprio usuário remova um upload temporário quando a criação do material falhar.
create policy "audio_delete_owned"
on storage.objects for delete to authenticated
using (
  bucket_id = 'audios'
  and owner_id = (select auth.jwt()->>'sub')
);

-- Leitura privada do próprio objeto (o app normalmente usa URL assinada pelo servidor).
create policy "audio_read_owned"
on storage.objects for select to authenticated
using (
  bucket_id = 'audios'
  and owner_id = (select auth.jwt()->>'sub')
);

-- Aplica um conjunto de edições como UMA nova revisão.
-- Função administrativa: a API valida a propriedade do material antes da chamada.
create or replace function public.apply_transcription_edits_admin(
  p_material_id uuid,
  p_expected_revision integer,
  p_edits jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transcription_id uuid;
  v_current_revision integer;
  v_new_revision integer;
  v_edit jsonb;
  v_full_text text;
  v_snapshot jsonb;
begin
  select id, current_revision
  into v_transcription_id, v_current_revision
  from public.transcriptions
  where material_id = p_material_id
  for update;

  if v_transcription_id is null then
    raise exception 'TRANSCRIPTION_NOT_FOUND';
  end if;

  if v_current_revision <> p_expected_revision then
    raise exception 'REVISION_CONFLICT';
  end if;

  for v_edit in select * from jsonb_array_elements(p_edits)
  loop
    update public.transcription_segments
    set current_text = coalesce(v_edit->>'text', ''), edited_at = now()
    where id = (v_edit->>'id')::uuid
      and transcription_id = v_transcription_id;

    if not found then
      raise exception 'SEGMENT_NOT_FOUND';
    end if;
  end loop;

  v_new_revision := v_current_revision + 1;

  select string_agg(current_text, ' ' order by position),
         jsonb_agg(
           jsonb_build_object(
             'id', id,
             'position', position,
             'startMs', start_ms,
             'endMs', end_ms,
             'text', current_text
           ) order by position
         )
  into v_full_text, v_snapshot
  from public.transcription_segments
  where transcription_id = v_transcription_id;

  update public.transcriptions
  set current_revision = v_new_revision,
      current_text = coalesce(v_full_text, ''),
      updated_at = now()
  where id = v_transcription_id;

  insert into public.transcription_versions(
    transcription_id, revision, origin, full_text, segments_snapshot
  ) values (
    v_transcription_id,
    v_new_revision,
    'EDICAO_USUARIO',
    coalesce(v_full_text, ''),
    coalesce(v_snapshot, '[]'::jsonb)
  );

  return v_new_revision;
end;
$$;

-- Restaura snapshot antigo como uma NOVA revisão.
create or replace function public.restore_transcription_revision_admin(
  p_material_id uuid,
  p_revision integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transcription_id uuid;
  v_current_revision integer;
  v_snapshot jsonb;
  v_full_text text;
  v_new_revision integer;
  v_segment jsonb;
begin
  select id, current_revision
  into v_transcription_id, v_current_revision
  from public.transcriptions
  where material_id = p_material_id
  for update;

  if v_transcription_id is null then
    raise exception 'TRANSCRIPTION_NOT_FOUND';
  end if;

  select segments_snapshot, full_text
  into v_snapshot, v_full_text
  from public.transcription_versions
  where transcription_id = v_transcription_id
    and revision = p_revision;

  if v_snapshot is null then
    raise exception 'REVISION_NOT_FOUND';
  end if;

  -- A restauração preserva os IDs quando disponíveis; caso um snapshot antigo
  -- não contenha ID, usa a posição como correspondência.
  for v_segment in select * from jsonb_array_elements(v_snapshot)
  loop
    update public.transcription_segments
    set current_text = coalesce(v_segment->>'text', ''), edited_at = now()
    where transcription_id = v_transcription_id
      and (
        (v_segment ? 'id' and id = (v_segment->>'id')::uuid)
        or (not (v_segment ? 'id') and position = (v_segment->>'position')::integer)
      );
  end loop;

  v_new_revision := v_current_revision + 1;

  select string_agg(current_text, ' ' order by position),
         jsonb_agg(
           jsonb_build_object(
             'id', id,
             'position', position,
             'startMs', start_ms,
             'endMs', end_ms,
             'text', current_text
           ) order by position
         )
  into v_full_text, v_snapshot
  from public.transcription_segments
  where transcription_id = v_transcription_id;

  update public.transcriptions
  set current_revision = v_new_revision,
      current_text = coalesce(v_full_text, ''),
      updated_at = now()
  where id = v_transcription_id;

  insert into public.transcription_versions(
    transcription_id, revision, origin, full_text, segments_snapshot
  ) values (
    v_transcription_id,
    v_new_revision,
    'RESTAURACAO',
    coalesce(v_full_text, ''),
    coalesce(v_snapshot, '[]'::jsonb)
  );

  return v_new_revision;
end;
$$;

-- As funções administrativas não devem ser invocadas pelo navegador.
revoke all on function public.apply_transcription_edits_admin(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.restore_transcription_revision_admin(uuid, integer) from public, anon, authenticated;
grant execute on function public.apply_transcription_edits_admin(uuid, integer, jsonb) to service_role;
grant execute on function public.restore_transcription_revision_admin(uuid, integer) to service_role;
