import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const base = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sql = (path) => readFileSync(resolve(base, path), 'utf8');
const migration = sql('database/migrations/20261104203000_study_planning.sql');
const checks = ['database/checks/e05-preflight.sql','database/checks/e05-postflight.sql'];

test('planning migration is gated by E03, transactional and non destructive', () => {
  assert.match(migration, /E05_ABORT: aplicar e verificar E03/);
  assert.match(migration, /create table public\.study_goals/);
  assert.match(migration, /create table public\.study_tasks/);
  assert.match(migration, /\bbegin;/i);
  assert.match(migration, /\bcommit;/i);
  assert.doesNotMatch(migration, /\b(drop table|truncate|delete from)\b/i);
});

test('database enforces task owner consistency including linked materials', () => {
  assert.match(migration, /unique \(id, user_id\)/);
  assert.match(migration, /foreign key \(goal_id, user_id\)/);
  assert.match(migration, /foreign key \(material_id, user_id\)/);
  assert.match(migration, /on delete set null \(material_id\)/);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on table public\.study_goals, public\.study_tasks/);
});

test('preflight and postflight never mutate data', () => {
  for(const p of checks) {
    const s = sql(p);
    assert.match(s,/begin read only;/);
    assert.match(s,/rollback;/);
    assert.doesNotMatch(s,/\b(create table|drop table|insert into|delete from|update public\.)\b/i);
  }
});
