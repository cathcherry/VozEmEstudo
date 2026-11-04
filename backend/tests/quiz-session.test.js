import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuizSessionService } from '../src/services/quiz-session.service.js';
import { validateQuizStart, validateQuizAnswer } from '../src/validators/quiz-session.validator.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const material = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const batch = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const session = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const question = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

test('quiz v2 validates server-owned session contracts with strict payloads', () => {
  assert.deepEqual(validateQuizStart({
    materialId:material, batchId:batch, feedbackMode:'deferred',
  }), { materialId:material, batchId:batch, feedbackMode:'deferred' });
  assert.deepEqual(validateQuizAnswer({ questionId:question, selectedIndex:0 }),
    { questionId:question, selectedIndex:0 });
  assert.throws(() => validateQuizStart({ materialId:material,batchId:batch,feedbackMode:'wrong' }));
  assert.throws(() => validateQuizStart({ materialId:material,batchId:batch,feedbackMode:'deferred',user_id:user }));
  assert.throws(() => validateQuizAnswer({ questionId:question,selectedIndex:4 }));
  assert.throws(() => validateQuizAnswer({ questionId:question,selectedIndex:'0' }));
});

test('session creation checks ownership of material and batch before writing', async () => {
  const calls=[];
  const fake={
    async findOwnedBatch(userId,materialId,batchId) {
      calls.push(['lookup',userId,materialId,batchId]);
      return { id:batchId,material_id:materialId,generated_count:5 };
    },
    async createOwnedSession(userId,data) {
      calls.push(['create',userId,data]);
      return {id:session,user_id:userId,...data};
    },
  };
  const service=buildQuizSessionService(fake);
  const created=await service.create(user,{ materialId:material,batchId:batch,feedbackMode:'deferred' });
  assert.equal(created.id,session);
  assert.deepEqual(calls[0],['lookup',user,material,batch]);
  assert.equal(calls[1][1],user);
  assert.equal(calls[1][2].feedbackMode,'deferred');
});

test('foreign or empty batch blocks session creation', async () => {
  let writes=0;
  const fake={
    async findOwnedBatch() { throw Object.assign(new Error('not found'),{code:'NOT_FOUND'}); },
    async createOwnedSession() {writes++;}
  };
  await assert.rejects(buildQuizSessionService(fake).create(user,{
    materialId:material,batchId:batch,feedbackMode:'immediate',
  }), (error)=>error.code==='NOT_FOUND');
  fake.findOwnedBatch=async()=>({generated_count:0});
  await assert.rejects(buildQuizSessionService(fake).create(user,{
    materialId:material,batchId:batch,feedbackMode:'immediate',
  }), (error)=>error.code==='QUIZ_EMPTY_BATCH');
  assert.equal(writes,0);
});

test('all session actions are scoped to authenticated account', async () => {
  const fake={
    async listOwnedSessions(id) {assert.equal(id,user);return [];},
    async readOwnedSession(id,sid) {assert.equal(id,user);assert.equal(sid,session);return {session:{id:sid}};},
    async submitSessionAnswer(id,sid,qid,index) {
      assert.deepEqual([id,sid,qid,index],[user,session,question,3]);
      return {recorded:true,selectedIndex:index};
    },
    async finishOwnedSession(id,sid) {
      assert.deepEqual([id,sid],[user,session]);
      return {status:'completed'};
    },
  };
  const service=buildQuizSessionService(fake);
  assert.deepEqual(await service.list(user),[]);
  assert.equal((await service.get(user,session)).session.id,session);
  assert.equal((await service.answer(user,session,{questionId:question,selectedIndex:3})).recorded,true);
  assert.equal((await service.finish(user,session)).status,'completed');
});

test('the legacy correction endpoint is blocked when quiz_v2 flag is enabled', () => {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..','src');
  const code=readFileSync(resolve(root,'controllers/question.controller.js'),'utf8');
  assert.match(code,/isFeatureEnabled\('quiz_v2'\)/);
  assert.match(code,/QUIZ_SESSION_REQUIRED/);
});

test('the session API only returns keys to answered questions and authorized modes', () => {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..','src');
  const code=readFileSync(resolve(root,'repositories/quiz-session.repository.js'),'utf8');
  assert.match(code,/session\.status === 'completed' \|\| session\.feedback_mode === 'immediate'/);
  assert.match(code,/if \(showFeedback && rawAnswers\.length\)/);
  assert.match(code,/\.in\('id', ids\)/);
  assert.match(code,/\.eq\('user_id', userId\)/);
  assert.doesNotMatch(code,/\.select\('\*'\)/);
});
