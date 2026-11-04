import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sql=(p)=>readFileSync(resolve(root,p),'utf8');
const migration=sql('database/migrations/20261104223000_quiz_sessions.sql');

test('E10 migration is gated, additive and transactional',()=>{
  assert.match(migration,/E10_ABORT: aplicar e verificar E03\/E05/);
  assert.match(migration,/\bbegin;/i);
  assert.match(migration,/\bcommit;/i);
  assert.match(migration,/create table public\.quiz_sessions/);
  assert.match(migration,/create table public\.quiz_session_answers/);
  assert.doesNotMatch(migration,/\b(drop table|truncate|delete from public\.materials)\b/i);
});

test('composite FKs tie sessions, materials, batches and answers to one owner',()=>{
  assert.match(migration,/foreign key\(material_id,user_id\)/);
  assert.match(migration,/foreign key\(batch_id,material_id\)/);
  assert.match(migration,/foreign key\(session_id,user_id,batch_id\)/);
  assert.match(migration,/foreign key\(question_id,batch_id\)/);
  assert.match(migration,/primary key\(session_id,question_id\)/);
});

test('RPC locks session row and suppresses deferred correctness',()=>{
  assert.match(migration,/public\.quiz_submit_answer_admin/);
  assert.match(migration,/public\.quiz_finish_session_admin/);
  assert.match(migration,/for update/);
  assert.match(migration,/on conflict\(session_id,question_id\) do nothing/);
  assert.match(migration,/if v_session\.feedback_mode='immediate' then/);
  assert.match(migration,/QUIZ_INCOMPLETE/);
  assert.match(migration,/revoke all on function public\.quiz_submit_answer_admin/);
  assert.match(migration,/revoke all on function public\.quiz_finish_session_admin/);
  assert.match(migration,/to service_role/);
});

test('preflight/postflight must be read-only and expose only aggregate checks',()=>{
  for(const p of ['database/checks/e10-preflight.sql','database/checks/e10-postflight.sql']){
    const content=sql(p);
    assert.match(content,/begin read only;/);
    assert.match(content,/rollback;/);
    assert.doesNotMatch(content,/\b(create table|insert into|update public\.|delete from|drop table)\b/i);
  }
});
