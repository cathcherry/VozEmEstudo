-- Voz em Estudo 3.4 — estado das migrations 3.3/3.4 num banco (SOMENTE LEITURA).
-- Rode no SQL Editor do projeto ANTES de qualquer mudança. Cada linha diz se a migration já foi
-- aplicada (pelo objeto que ela cria) e se os pré-requisitos dela existem.
-- Esperado em produção antes da janela: todas as linhas com "aplicada = false". "pre_requisitos" olha
-- os objetos das etapas anteriores: fica true à medida que a ordem é seguida (as linhas 4, 5, 7 e 8
-- só ficam true depois das anteriores). Antes de aplicar cada uma, rode o preflight dela.
-- Se alguma já estiver aplicada, NÃO reaplique (a guarda aborta) e pule para a seguinte.
select ordem, migration, aplicada, pre_requisitos from (values
  (1, '20261121130000_notes_3_0.sql',
      to_regclass('public.study_notebooks') is not null,
      to_regclass('public.study_annotations') is not null and to_regclass('public.transcription_confirmations') is not null
        and to_regclass('public.profile_state') is not null),
  (2, '20261121140000_classrooms.sql',
      to_regclass('public.classrooms') is not null,
      to_regclass('public.study_flashcard_sets') is not null
        and to_regprocedure('public.require_material_permission_admin(uuid,uuid,text)') is not null),
  (3, '20261121150000_flashcards_3_0.sql',
      to_regclass('public.study_card_templates') is not null,
      to_regprocedure('public.study_add_flashcards_admin(uuid,uuid,jsonb)') is not null),
  (4, '20261121160000_generation_reuse.sql',
      to_regclass('public.ai_generations') is not null,
      to_regclass('public.classroom_lessons') is not null),
  (5, '20261121170000_multi_lesson.sql',
      to_regclass('public.multi_lesson_materials') is not null,
      to_regclass('public.ai_generations') is not null and to_regclass('public.study_units') is not null),
  (6, '20261121171000_knowledge_map_cache.sql (opcional)',
      to_regclass('public.knowledge_maps') is not null,
      to_regclass('public.transcription_versions') is not null),
  (7, '20261121180000_multi_lesson_exports.sql',
      to_regclass('public.multi_lesson_exports') is not null,
      to_regclass('public.multi_lesson_materials') is not null
        and to_regprocedure('public.study_create_flashcard_deck_admin(uuid,uuid,jsonb)') is not null),
  (8, '20261122090000_classroom_contributions.sql',
      to_regclass('public.classroom_contributions') is not null,
      to_regclass('public.classrooms') is not null and to_regclass('public.multi_lesson_materials') is not null)
) as t(ordem, migration, aplicada, pre_requisitos)
order by ordem;
