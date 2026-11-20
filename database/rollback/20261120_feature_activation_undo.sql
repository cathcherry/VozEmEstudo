-- UNDO for the feature-activation migrations applied to audioestudo on 2026-11-20.
-- DO NOT RUN unless you deliberately want to remove these features again: it DELETES every
-- planning goal/task, quiz attempt, flashcard and review, study session, annotation, calendar
-- event and shared-lesson link created since. Turn the matching FEATURE_* flags off first.
--
-- Restores the schema to the pre-activation state (tested on a replica: catalog identical to the
-- state before the nine migrations). Each section is independent and idempotent, in reverse order,
-- so a partial activation can be undone by running only the sections after the last applied step.
begin;
set local lock_timeout = '5s';

-- 9. profile_state hardening: back to the previous grants, no key rule, no key limit.
drop trigger if exists profile_state_limit_keys on public.profile_state;
drop function if exists public.profile_state_limit_keys();
alter table public.profile_state drop constraint if exists profile_state_key_format;
grant trigger, truncate, references on table public.profile_state to anon;
grant insert, references, select, trigger, truncate, update on table public.profile_state to authenticated;

-- 8. E18/E19 calendar and lesson sharing.
drop function if exists public.study_save_calendar_admin(uuid, uuid, integer, uuid, jsonb);
drop function if exists public.study_calendar_feed_admin(uuid, timestamptz, timestamptz, date, date, integer);
drop function if exists public.study_create_share_admin(uuid, uuid, uuid, uuid, text, uuid, boolean, boolean, integer, text);
drop function if exists public.study_resolve_share_admin(text);
drop table if exists public.study_calendar_events;
drop table if exists public.material_shares;
alter table if exists public.study_tasks drop constraint if exists study_tasks_calendar_owner_unique;

-- 7. E14/E15 annotations.
drop function if exists public.study_save_annotation_admin(uuid, uuid, uuid, integer, uuid, jsonb);
drop function if exists public.study_list_annotations_admin(uuid, uuid, text, integer);
drop table if exists public.study_annotations;

-- 6. E08/E09 study tracking.
drop function if exists public.study_save_progress_admin(uuid, uuid, integer, uuid, jsonb);
drop function if exists public.study_start_session_admin(uuid, uuid, uuid, text);
drop function if exists public.study_tick_session_admin(uuid, uuid, integer, boolean, boolean);
drop function if exists public.study_save_settings_admin(uuid, integer, text);
drop function if exists public.study_overview_admin(uuid);
drop table if exists public.study_time_credits;
drop table if exists public.study_sessions;
drop table if exists public.study_progress;
drop table if exists public.study_settings;

-- 5. Flashcard sets.
drop function if exists public.study_add_flashcards_admin(uuid, uuid, jsonb);
drop function if exists public.study_create_flashcard_set_admin(uuid, uuid, jsonb);
drop function if exists public.study_update_flashcard_set_admin(uuid, uuid, text, text);
drop function if exists public.study_delete_flashcard_set_admin(uuid, uuid);
drop function if exists public.study_delete_flashcard_admin(uuid, uuid);
-- (columns added to study_flashcards disappear with the table in step 4)

-- 4. E13 flashcards.
drop function if exists public.study_review_flashcard_admin(uuid, uuid, integer, uuid);
drop table if exists public.study_flashcard_reviews;
drop table if exists public.study_flashcards cascade;
drop table if exists public.study_flashcard_sets;

-- 3 + 2. E12 review and E10 quiz sessions.
drop function if exists public.quiz_create_review_session_admin(uuid, uuid, text);
drop function if exists public.quiz_submit_answer_admin(uuid, uuid, uuid, integer);
drop function if exists public.quiz_finish_session_admin(uuid, uuid);
drop table if exists public.quiz_session_items;
drop table if exists public.quiz_session_answers;
drop table if exists public.quiz_sessions;
alter table public.questions drop constraint if exists quiz_questions_id_batch_unique;
alter table public.question_batches drop constraint if exists quiz_batches_id_material_unique;

-- 1. E05 planning. The materials(id, user_id) key predates E05 here and is kept.
drop function if exists public.study_reorder_tasks(uuid, uuid, uuid[]);
drop table if exists public.study_tasks;
drop table if exists public.study_subgoals;
drop table if exists public.study_goals;

commit;
