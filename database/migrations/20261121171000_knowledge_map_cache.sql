-- Voz em Estudo 3.3 / Cache de mapas de conhecimento (Marco C, camada de otimizacao) — MIGRACAO
-- CANDIDATA (nao aplicada em producao).
-- Depende de: 001_initial (materials, transcription_versions). NAO depende de
-- 20261121170000_multi_lesson.sql, e a geracao multiaula funciona sem esta tabela (cada pedido
-- analisa as aulas de novo). Aditiva: nada existente e removido ou substituido.
-- Um mapa de conhecimento (conceitos, definicoes curtas, relacoes, cada um com evidencia =
-- posicao do trecho + citacao conferida no segments_snapshot daquela revisao) e guardado por
-- (source_revision_id, prompt_version, model_family). Revisoes sao imutaveis, entao o mapa vale
-- enquanto a chave valer; uma revisao nova, um prompt novo ou outro modelo produzem outra chave.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
begin
  if to_regclass('public.transcription_versions') is null or to_regclass('public.materials') is null then
    raise exception 'KNOWLEDGE_MAP_ABORT: aplicar 001_initial antes';
  end if;
  if to_regclass('public.knowledge_maps') is not null then
    raise exception 'KNOWLEDGE_MAP_ABORT: knowledge_maps ja existe; nao reaplicar';
  end if;
end
$guard$;

create table public.knowledge_maps (
  id uuid primary key default gen_random_uuid(),
  source_revision_id uuid not null references public.transcription_versions(id) on delete cascade,
  -- Owner of the revision's lesson: a map is never read by another account.
  material_id uuid not null references public.materials(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt_version text not null check (char_length(prompt_version) between 1 and 60),
  model_family text not null check (char_length(model_family) between 1 and 80),
  map jsonb not null check (jsonb_typeof(map) = 'object' and pg_column_size(map) <= 262144),
  model text check (model is null or char_length(model) <= 120),
  hit_count integer not null default 0 check (hit_count >= 0),
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  constraint knowledge_maps_key unique (source_revision_id, prompt_version, model_family)
);
create index knowledge_maps_owner_idx on public.knowledge_maps(user_id, created_at desc);

alter table public.knowledge_maps enable row level security;
revoke all on table public.knowledge_maps from public, anon, authenticated;
grant select, insert, update, delete on table public.knowledge_maps to service_role;

-- Cached maps of the caller's own revisions for one prompt version and model family.
create function public.knowledge_map_get_admin(p_user_id uuid, p_revision_ids uuid[], p_prompt_version text, p_model_family text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  with hit as (
    update public.knowledge_maps set hit_count = hit_count + 1, last_used_at = now()
    where user_id = p_user_id and source_revision_id = any(coalesce(p_revision_ids, '{}'::uuid[]))
      and prompt_version = p_prompt_version and model_family = p_model_family
    returning source_revision_id, map, model, hit_count, created_at)
  select coalesce(jsonb_agg(jsonb_build_object('revisionId', source_revision_id, 'map', map, 'model', model,
    'hitCount', hit_count, 'createdAt', created_at)), '[]'::jsonb) into v_result from hit;
  return v_result;
end $$;

-- Stores a map of the caller's own revision. The first writer wins: a concurrent second analysis
-- of the same key keeps the stored map (returned with created = false).
create function public.knowledge_map_put_admin(p_user_id uuid, p_revision_id uuid, p_prompt_version text,
  p_model_family text, p_map jsonb, p_model text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_material uuid; v_row public.knowledge_maps; v_created boolean := false;
begin
  select m.id into v_material from public.transcription_versions tv
    join public.transcriptions t on t.id = tv.transcription_id
    join public.materials m on m.id = t.material_id and m.user_id = p_user_id
    where tv.id = p_revision_id;
  if v_material is null then raise exception 'KNOWLEDGE_MAP_SOURCE_FORBIDDEN'; end if;
  insert into public.knowledge_maps(source_revision_id, material_id, user_id, prompt_version, model_family, map, model)
    values (p_revision_id, v_material, p_user_id, p_prompt_version, p_model_family, p_map, left(p_model, 120))
    on conflict on constraint knowledge_maps_key do nothing
    returning * into v_row;
  if v_row.id is not null then v_created := true;
  else
    select * into v_row from public.knowledge_maps
      where source_revision_id = p_revision_id and prompt_version = p_prompt_version and model_family = p_model_family;
  end if;
  return jsonb_build_object('revisionId', v_row.source_revision_id, 'map', v_row.map, 'model', v_row.model,
    'created', v_created);
end $$;

revoke all on function public.knowledge_map_get_admin(uuid, uuid[], text, text),
  public.knowledge_map_put_admin(uuid, uuid, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.knowledge_map_get_admin(uuid, uuid[], text, text),
  public.knowledge_map_put_admin(uuid, uuid, text, text, jsonb, text)
  to service_role;
commit;
