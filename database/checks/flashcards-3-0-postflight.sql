-- Flashcards 3.0 — postflight (somente leitura). Rodar depois da migration.
-- Esperado: cards_after = cards_before do preflight; reviews_after = reviews_before;
-- untyped_term_cards = 0; rls_enabled = true; anon/authenticated sem privilegios.
select
  (select count(*) from public.study_flashcards) as cards_after,
  (select count(*) from public.study_flashcard_reviews) as reviews_after,
  (select count(*) from public.study_flashcards where note_type = 'term') as term_cards,
  (select count(*) from public.study_flashcards where card_style = 'term_definition' and note_type <> 'term') as untyped_term_cards,
  (select relrowsecurity from pg_class where oid = 'public.study_card_templates'::regclass) as rls_enabled,
  not has_table_privilege('authenticated', 'public.study_card_templates', 'select')
    and not has_table_privilege('anon', 'public.study_card_templates', 'select') as no_browser_access,
  exists (select 1 from storage.buckets where id = 'flashcard-media' and public = false) as private_bucket;
