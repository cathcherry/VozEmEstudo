-- Class contributions preflight: READ ONLY. Shows no personal data (counts only).
-- Run before 20261122090000_classroom_contributions.sql. "prerequisites" must be true and
-- "already_applied" false; otherwise the migration refuses to run. Keep the counts.
select
  (to_regclass('public.classrooms') is not null
    and to_regclass('public.classroom_members') is not null
    and to_regclass('public.classroom_shared_items') is not null
    and to_regprocedure('public.classroom_require_admin(uuid,uuid,text)') is not null
    and to_regprocedure('public.classroom_member_name(uuid,uuid)') is not null
    and to_regclass('public.multi_lesson_materials') is not null
    and to_regclass('public.study_flashcard_sets') is not null
    and to_regprocedure('public.set_updated_at()') is not null) as prerequisites,
  to_regclass('public.classroom_contributions') is not null as already_applied,
  (select count(*) from public.classroom_shared_items) as shared_items_before,
  (select count(*) from public.multi_lesson_materials) as integrated_materials_before,
  (select count(*) from public.classroom_members) as members_before;
