-- E13 postflight: SOMENTE LEITURA. Comparar totais legados.
begin read only;
select
  (select count(*) from public.materials) as materials,
  (select count(*) from public.study_tasks) as study_tasks,
  (select count(*) from public.study_flashcards) as flashcards,
  (select count(*) from public.study_flashcard_reviews) as flashcard_reviews;
select c.relname as table_name,c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in ('study_flashcards','study_flashcard_reviews')
order by c.relname;
select
  has_table_privilege('anon','public.study_flashcards','SELECT') as anon_can_read_cards,
  has_table_privilege('authenticated','public.study_flashcards','SELECT')
    as authenticated_can_read_cards,
  has_table_privilege('anon','public.study_flashcard_reviews','SELECT')
    as anon_can_read_history,
  has_table_privilege('authenticated','public.study_flashcard_reviews','SELECT')
    as authenticated_can_read_history,
  has_function_privilege('anon',
    'public.study_review_flashcard_admin(uuid,uuid,integer,uuid)','EXECUTE')
    as anon_can_review,
  has_function_privilege('authenticated',
    'public.study_review_flashcard_admin(uuid,uuid,integer,uuid)','EXECUTE')
    as authenticated_can_review,
  has_function_privilege('service_role',
    'public.study_review_flashcard_admin(uuid,uuid,integer,uuid)','EXECUTE')
    as service_can_review;
select count(*) as cross_account_material_links from public.study_flashcards c
join public.materials m on m.id=c.material_id where c.user_id<>m.user_id;
select count(*) as cross_account_review_links from public.study_flashcard_reviews r
join public.study_flashcards c on c.id=r.card_id where r.user_id<>c.user_id;
select count(*) as duplicated_request_ids from (
  select user_id, request_id from public.study_flashcard_reviews
  group by user_id,request_id having count(*)>1
) duplicates;
rollback;
