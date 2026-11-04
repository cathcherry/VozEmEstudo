import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readSql = (path) => readFileSync(resolve(root, path), 'utf8');
const migration = readSql('database/migrations/20261104234500_flashcards.sql');

test('E13 schema is guarded, additive and transactional', () => {
  assert.match(migration, /E13_ABORT: aplicar e verificar E03 e E05\/E06/);
  assert.match(migration, /\bbegin;/i);
  assert.match(migration, /\bcommit;/i);
  assert.match(migration, /create table public\.study_flashcards/);
  assert.match(migration, /create table public\.study_flashcard_reviews/);
  assert.match(migration, /foreign key \(material_id, user_id\)/);
  assert.match(migration, /foreign key \(card_id, user_id\)/);
  assert.doesNotMatch(migration, /\b(drop table|truncate|delete from public\.materials)\b/i);
});

test('review RPC is atomic, idempotent, scoped and server-only', () => {
  assert.match(migration, /study_review_flashcard_admin/);
  assert.match(migration, /where id = p_card_id and user_id = p_user_id for update/);
  assert.match(migration, /unique \(user_id, request_id\)/);
  assert.match(migration, /v_previous\.card_id <> p_card_id or v_previous\.rating <> p_rating/);
  assert.match(migration, /interval '10 minutes'/);
  assert.match(migration, /least\(3650,/);
  assert.match(migration, /return jsonb_build_object\(/);
  assert.match(migration, /revoke all on function public\.study_review_flashcard_admin/);
  assert.match(migration, /to service_role/);
});

test('RLS and grants prevent direct browser writes', () => {
  assert.match(migration, /alter table public\.study_flashcards enable row level security/);
  assert.match(migration, /alter table public\.study_flashcard_reviews enable row level security/);
  assert.match(migration, /revoke all on table public\.study_flashcards, public\.study_flashcard_reviews/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on table/);
});

test('preflight and postflight are read-only and check previous data counts', () => {
  for (const path of [
    'database/checks/e13-preflight.sql',
    'database/checks/e13-postflight.sql',
  ]) {
    const code = readSql(path);
    assert.match(code, /begin read only;/);
    assert.match(code, /rollback;/);
    assert.doesNotMatch(code, /\b(create table|drop table|insert into|delete from|update public\.)\b/i);
    assert.match(code, /public\.materials/);
    assert.match(code, /public\.study_tasks/);
  }
});
