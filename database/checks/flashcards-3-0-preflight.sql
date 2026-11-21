-- Flashcards 3.0 — preflight (somente leitura). Rodar antes de 20261121150000_flashcards_3_0.sql.
-- Esperado: prerequisites = true, already_applied = false, bucket_exists = false.
select
  to_regclass('public.study_flashcards') is not null
    and to_regclass('public.study_flashcard_sets') is not null
    and to_regprocedure('public.study_add_flashcards_admin(uuid,uuid,jsonb)') is not null as prerequisites,
  to_regclass('public.study_card_templates') is not null as already_applied,
  exists (select 1 from storage.buckets where id = 'flashcard-media') as bucket_exists,
  (select count(*) from public.study_flashcards) as cards_before,
  (select count(*) from public.study_flashcards where card_style = 'term_definition') as term_cards_to_backfill,
  (select count(*) from public.study_flashcard_reviews) as reviews_before;
