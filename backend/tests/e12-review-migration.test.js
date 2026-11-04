import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const read=(p)=>readFileSync(resolve(root,p),'utf8');
const sql=read('database/migrations/20261104233000_quiz_review.sql');

test('E12 é aditiva, depende de E10 e não pode ser aplicada novamente',()=>{
  assert.match(sql,/E12_ABORT: E10 ainda nao esta instalado/);
  assert.match(sql,/E12_ABORT: objetos E12 ja existem/);
  assert.match(sql,/\bbegin;/i);
  assert.match(sql,/\bcommit;/i);
  assert.match(sql,/create table public\.quiz_session_items/);
  assert.match(sql,/add column kind text not null default 'full'/);
  assert.doesNotMatch(sql,/\b(drop table|truncate table|delete from public\.questions)\b/i);
});

test('revisão usa referências originais vinculadas a conta, lote e tentativa',()=>{
  assert.match(sql,/foreign key \(source_session_id,user_id,batch_id\)/);
  assert.match(sql,/foreign key\(session_id,user_id,batch_id\)/);
  assert.match(sql,/foreign key\(question_id,batch_id\)/);
  assert.match(sql,/v_source\.status<>'completed'/);
  assert.match(sql,/and not a\.is_correct/);
  assert.match(sql,/v_session\.kind='review' and not exists/);
  assert.match(sql,/for update/);
  assert.match(sql,/select count\(\*\) into v_total from public\.quiz_session_items/);
});

test('papéis de navegador não recebem acesso à tabela nem às RPCs',()=>{
  assert.match(sql,/enable row level security/);
  assert.match(sql,/revoke all on table public\.quiz_session_items from public,anon,authenticated/);
  assert.match(sql,/revoke all on function public\.quiz_create_review_session_admin/);
  assert.match(sql,/revoke all on function public\.quiz_submit_answer_admin/);
  assert.match(sql,/to service_role/);
});

test('preflight e postflight são estritamente de leitura',()=>{
  for(const path of ['database/checks/e12-preflight.sql','database/checks/e12-postflight.sql']){
    const check=read(path);
    assert.match(check,/begin read only;/);
    assert.match(check,/rollback;/);
    assert.doesNotMatch(check,/\b(create table|drop table|insert into|update public\.|delete from)\b/i);
  }
});
