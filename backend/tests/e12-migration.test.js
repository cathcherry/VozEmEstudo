import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sql=(name)=>readFileSync(resolve(root,name),'utf8');
const migration=sql('database/migrations/20261104233000_quiz_review.sql');

test('E12 is an additive transactional migration that requires E10',()=>{
  assert.match(migration,/E12_ABORT: E10 ainda nao esta instalado/);
  assert.match(migration,/\bbegin;/i);assert.match(migration,/\bcommit;/i);
  assert.match(migration,/create table public\.quiz_session_items/);
  assert.match(migration,/quiz_review_source_scope_fk/);
  assert.doesNotMatch(migration,/\b(drop table|truncate|delete from public\.questions)\b/i);
});
test('review source and question IDs are chosen inside the database',()=>{
  assert.match(migration,/public\.quiz_create_review_session_admin/);
  assert.match(migration,/v_source\.status<>'completed'/);
  assert.match(migration,/not a\.is_correct/);
  assert.match(migration,/quiz_review_item_question_batch_fk/);
  assert.match(migration,/v_session\.kind='review' and not exists/);
  assert.match(migration,/select count\(\*\) into v_total from public\.quiz_session_items/);
});
test('review RPCs are restricted and checks are read only',()=>{
  assert.match(migration,/revoke all on function public\.quiz_create_review_session_admin/);
  assert.match(migration,/to service_role/);
  for(const name of ['database/checks/e12-preflight.sql','database/checks/e12-postflight.sql']){
    const s=sql(name);
    assert.match(s,/begin read only;/);assert.match(s,/rollback;/);
    assert.doesNotMatch(s,/\b(create table|insert into|update public\.|delete from|drop table)\b/i);
  }
});
