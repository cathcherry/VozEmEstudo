import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { identities } from './fixtures/ownership.fixture.js';
import { addLesson, addSubject, migrateMultiLessonExports } from './fixtures/multi-lesson-db.fixture.js';

// 3.4 over HTTP (PGlite behind the Supabase fixture; worker in offline demo mode, no external
// request): a ready integrated material becomes a question list answered through the usual
// question API and a personal flashcard set; both idempotent, private to the account. (The quiz
// session flow — quiz_sessions + quiz_submit_answer_admin — is exercised on the same list in
// multi-lesson-exports-migration.test.js: this HTTP fixture only mirrors the legacy tables.)
test('multi-lesson exports over HTTP: question list answered with the question API, personal deck, idempotent, private', async (t) => {
  const f = createSupabaseHttpFixture();
  const nativeFetch = globalThis.fetch;
  Object.assign(process.env, {
    SUPABASE_URL: f.origin,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_exports_fixture',
    SUPABASE_SECRET_KEY: 'exports-fixture-server-key',
    FEATURE_MULTI_LESSON: 'true',
    FEATURE_CATALOG_UNITS: 'true',
    FEATURE_FLASHCARDS: 'true',
    FEATURE_FLASHCARD_SETS: 'true',
    AI_DAILY_GENERATION_LIMIT: '5',
    MOCK_EXTERNAL_SERVICES: 'true',
  });
  const database = await f.getDatabase();
  await migrateMultiLessonExports(database);
  const subject = await addSubject(database, identities.a, 'Citologia', ['Célula', 'Energia']);
  const [cell, energy] = subject.unitIds;
  const l1 = await addLesson(database, identities.a, {
    title: 'Membrana',
    subjectId: subject.subjectId,
    unitId: cell,
    segments: ['A membrana plasmática controla a entrada e a saída de substâncias da célula.', 'O transporte ativo gasta energia para mover substâncias contra o gradiente.'],
  });
  await addLesson(database, identities.a, {
    title: 'Mitocôndria',
    subjectId: subject.subjectId,
    unitId: energy,
    segments: ['A mitocôndria produz a maior parte da energia usada pela célula em forma de ATP.'],
  });
  globalThis.fetch = f.fetch;
  const { app } = await import('../src/app.js');
  const { runNextMultiLessonJob } = await import('../src/jobs/multi-lesson-runner.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, path, body, user = 'a') => {
    const res = await fetch(origin + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identities[user].token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  try {
    let record;
    await t.test('several units: the preview and the request agree; the worker makes it ready', async () => {
      const preview = await api('POST', '/multi-lesson/preview', { selection: { kind: 'units', ids: [cell, energy] } });
      assert.equal(preview.status, 200);
      assert.deepEqual(preview.body.included.map((item) => item.title), ['Membrana', 'Mitocôndria']);
      const created = await api('POST', '/multi-lesson', {
        id: randomUUID(),
        requestId: randomUUID(),
        title: 'Célula e energia',
        selection: { kind: 'units', ids: [cell, energy] },
        outputs: ['questions', 'flashcards'],
        settings: { questionCount: 3, flashcardCount: 3 },
        expectedRevisionIds: preview.body.included.map((item) => item.revisionId),
      });
      assert.equal(created.status, 202, JSON.stringify(created.body));
      record = created.body.multiLesson;
      // Not ready yet: nothing can be exported.
      const early = await api('POST', `/multi-lesson/${record.id}/question-list`, { requestId: randomUUID() });
      assert.equal(early.status, 409);
      assert.equal(early.body.error.code, 'MULTI_LESSON_NOT_READY');
      assert.equal(await runNextMultiLessonJob('exports-worker'), true);
      const ready = await api('GET', `/multi-lesson/${record.id}`);
      assert.equal(ready.body.status, 'ready');
      assert(ready.body.result.questions.length >= 1);
      assert(ready.body.result.flashcards.length >= 1);
      assert.deepEqual((await api('GET', `/multi-lesson/${record.id}/exports`)).body, []);
    });

    let list;
    await t.test('questions → a list of the first lesson, answered with the usual question API', async () => {
      const requestId = randomUUID();
      const res = await api('POST', `/multi-lesson/${record.id}/question-list`, { requestId });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.headers.get('cache-control'), 'no-store');
      list = res.body;
      assert.equal(list.kind, 'questions');
      assert.equal(list.materialId, l1.id);
      assert.equal(list.replayed, false);
      assert.equal(list.links.answer, `./responder.html?material=${l1.id}&batch=${list.batchId}`);
      // Same request again, and a second click: the same list.
      const replay = await api('POST', `/multi-lesson/${record.id}/question-list`, { requestId });
      assert.equal(replay.body.batchId, list.batchId);
      const again = await api('POST', `/multi-lesson/${record.id}/question-list`, { requestId: randomUUID() });
      assert.equal(again.body.batchId, list.batchId);
      assert.equal(again.body.replayed, true);

      // The list is one of the lesson's lists (without the answer key in the listing).
      const batches = await api('GET', `/materials/${l1.id}/question-batches`);
      assert.equal(batches.status, 200);
      const batch = batches.body.find((item) => item.id === list.batchId);
      assert(batch, 'the list appears in the lesson');
      assert.equal(batch.title, 'Questões integradas: Célula e energia');
      assert.equal(batch.config.origin.kind, 'multi_lesson');
      assert.equal(batch.questions[0].correct_index, undefined, 'no answer key in the listing');

      const key = (await database.db.query('select id, correct_index, explanation from public.questions where batch_id=$1 order by position', [list.batchId])).rows;
      const answer = await api('POST', `/questions/${key[0].id}/answer`, { selectedIndex: key[0].correct_index });
      assert.equal(answer.status, 200, JSON.stringify(answer.body));
      assert.equal(answer.body.correct, true);
      assert.match(answer.body.explanation, /Fontes: (Membrana|Mitocôndria), trecho \d+/);
    });

    await t.test('flashcards → a personal set; a second click does not duplicate', async () => {
      const res = await api('POST', `/multi-lesson/${record.id}/flashcard-set`, { requestId: randomUUID(), name: 'Revisão integrada' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.kind, 'flashcards');
      assert.equal(res.body.links.review, `./flashcards.html?conjunto=${res.body.setId}#revisar`);
      const again = await api('POST', `/multi-lesson/${record.id}/flashcard-set`, { requestId: randomUUID() });
      assert.equal(again.body.setId, res.body.setId);
      assert.equal(again.body.replayed, true);
      const sets = (await database.db.query("select name, config from public.study_flashcard_sets where config->'origin'->>'kind' = 'multi_lesson'")).rows;
      assert.equal(sets.length, 1);
      assert.equal(sets[0].name, 'Revisão integrada');
      const listed = await api('GET', `/multi-lesson/${record.id}/exports`);
      assert.deepEqual(listed.body.map((item) => [item.kind, item.available]), [['flashcards', true], ['questions', true]]);
    });

    await t.test('another account cannot see or export it; invalid input is 400', async () => {
      assert.equal((await api('GET', `/multi-lesson/${record.id}/exports`, null, 'b')).status, 404);
      assert.equal((await api('POST', `/multi-lesson/${record.id}/question-list`, { requestId: randomUUID() }, 'b')).status, 404);
      assert.equal((await api('POST', `/multi-lesson/${record.id}/flashcard-set`, { requestId: randomUUID() }, 'b')).status, 404);
      assert.equal((await api('POST', `/multi-lesson/${record.id}/question-list`, {})).status, 400);
      assert.equal((await api('POST', `/multi-lesson/${record.id}/question-list`, { requestId: randomUUID(), extra: 1 })).status, 400);
      assert.equal((await api('POST', '/multi-lesson/not-a-uuid/question-list', { requestId: randomUUID() })).status, 400);
      // The other account cannot answer the list either (it is A's lesson).
      const question = (await database.db.query('select id from public.questions where batch_id=$1 limit 1', [list.batchId])).rows[0];
      assert.equal((await api('POST', `/questions/${question.id}/answer`, { selectedIndex: 0 }, 'b')).status, 404);
    });
  } finally {
    server.close();
    globalThis.fetch = nativeFetch;
    await f.close();
  }
});
