import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createExportsCaller } from '../src/repositories/multi-lesson.repository.js';
import { buildMultiLessonExportService, exportLinks } from '../src/services/multi-lesson-export.service.js';

const fakeDb = (error, status = 404) => () => ({ rpc: async () => ({ data: null, error, status }) });

test('without the exports migration the caller answers a scoped 503, not the multi-lesson one', async () => {
  for (const code of ['PGRST202', 'PGRST205', '42883', '42501']) {
    const call = createExportsCaller(fakeDb({ code, message: 'missing' }));
    await assert.rejects(call('multi_lesson_exports_admin', {}), (error) => {
      assert.equal(error.code, 'MULTI_LESSON_EXPORTS_SCHEMA_REQUIRED');
      assert.equal(error.status, 503);
      return true;
    });
  }
  const notReady = createExportsCaller(fakeDb({ code: 'P0001', message: 'MULTI_LESSON_NOT_READY' }, 400));
  await assert.rejects(notReady('x', {}), (error) => error.code === 'MULTI_LESSON_NOT_READY' && error.status === 409);
  const anchor = createExportsCaller(fakeDb({ code: 'P0001', message: 'MULTI_LESSON_ANCHOR_UNAVAILABLE' }, 400));
  await assert.rejects(anchor('x', {}), (error) => error.status === 409);
});

test('links lead to the usual quiz page and to Revisar; nothing for a deleted target', () => {
  assert.deepEqual(exportLinks({ kind: 'questions', available: true, materialId: 'm1', batchId: 'b1' }), {
    answer: './responder.html?material=m1&batch=b1',
    lesson: './material.html?id=m1#questoes',
  });
  assert.deepEqual(exportLinks({ kind: 'flashcards', available: true, setId: 's1' }), {
    review: './revisar.html?conjunto=s1#flashcards',
  });
  assert.equal(exportLinks({ kind: 'questions', available: false }), null);
});

test('the service validates ids and bodies before reaching the database', async () => {
  const calls = [];
  const service = buildMultiLessonExportService({
    listExports: async (...args) => (calls.push(['list', ...args]), []),
    exportQuestions: async (...args) => (calls.push(['questions', ...args]), { kind: 'questions', available: false }),
    exportFlashcards: async (...args) => (calls.push(['flashcards', ...args]), { kind: 'flashcards', available: false }),
  });
  const user = { id: randomUUID() };
  const id = randomUUID();
  const requestId = randomUUID();
  await assert.rejects(service.questions(user, 'nope', { requestId }));
  await assert.rejects(service.questions(user, id, {}));
  await assert.rejects(service.flashcards(user, id, { requestId, name: '' }));
  await assert.rejects(service.flashcards(user, id, { requestId, other: true }));
  assert.equal(calls.length, 0);
  await service.questions(user, id, { requestId, title: '  Lista  ' });
  await service.flashcards(user, id, { requestId });
  assert.deepEqual(calls, [
    ['questions', user.id, id, requestId, 'Lista'],
    ['flashcards', user.id, id, requestId, undefined],
  ]);
});
