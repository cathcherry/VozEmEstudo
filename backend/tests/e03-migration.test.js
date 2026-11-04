import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sql = (name) => readFileSync(resolve(root, name), 'utf8');
const migration = sql('database/migrations/20261104190000_catalog_units.sql');
const before = sql('database/checks/e03-preflight.sql');
const after = sql('database/checks/e03-postflight.sql');

test('E03 migration is additive, atomic and must not be blindly reapplied', () => {
  assert.match(migration, /\bbegin;/i);
  assert.match(migration, /\bcommit;/i);
  assert.match(migration, /E03_ABORT: estruturas E03 ja existem/);
  assert.match(migration, /create table public\.study_subjects/);
  assert.match(migration, /create table public\.study_units/);
  assert.match(migration, /alter table public\.materials\s+add column subject_id uuid,\s+add column unit_id uuid/s);
  assert.doesNotMatch(migration, /\b(drop\s+table|truncate\s+table|delete\s+from\s+public\.materials)\b/i);
});

test('existing material IDs, ownership and timestamps remain intact', () => {
  assert.match(migration, /foreign key \(subject_id, user_id\)/);
  assert.match(migration, /foreign key \(unit_id, subject_id, user_id\)/);
  assert.match(migration, /disable trigger materials_set_updated_at/);
  assert.match(migration, /enable trigger materials_set_updated_at/);
  assert.match(migration, /m\.user_id = s\.user_id/);
  assert.match(migration, /where m\.subject_id is null/);
  assert.doesNotMatch(migration, /\bupdate\s+public\.transcriptions\b/i);
});

test('catalog must not expose direct table privileges to anonymous or authenticated roles', () => {
  for (const table of ['study_subjects', 'study_units'])
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(migration, /revoke all on table public\.study_subjects, public\.study_units[\s\S]*?from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on table public\.study_subjects, public\.study_units[\s\S]*?to service_role/);
});

test('preflight and postflight have only read-only queries and rollback their session', () => {
  for (const script of [before, after]) {
    assert.match(script, /begin read only;/);
    assert.match(script, /rollback;/);
    assert.doesNotMatch(script, /\b(insert\s+into|update\s+public\.|delete\s+from|create\s+table|drop\s+table)\b/i);
  }
  assert.match(before, /overlong_labels/);
  assert.match(after, /unlinked_existing_labeled_materials/);
  assert.match(after, /material_subject_owner_mismatch/);
});
