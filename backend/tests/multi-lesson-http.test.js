import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { identities } from './fixtures/ownership.fixture.js';
import { addLesson, addSubject, migrateMultiLesson } from './fixtures/multi-lesson-db.fixture.js';

// HTTP API of Milestone C over the real SQL (PGlite behind the Supabase fixture). The worker runs
// with MOCK_EXTERNAL_SERVICES=true: the offline demo builds its output from the real segments, so
// the evidence checks run exactly as with a provider. No external request is made.
test('multi-lesson over HTTP: preview, one job for concurrent requests, privacy, result with citations, budget', async (t) => {
  const f = createSupabaseHttpFixture();
  const nativeFetch = globalThis.fetch;
  Object.assign(process.env, {
    SUPABASE_URL: f.origin,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_multi_fixture',
    SUPABASE_SECRET_KEY: 'multi-fixture-server-key',
    FEATURE_MULTI_LESSON: 'true',
    FEATURE_CATALOG_UNITS: 'true',
    AI_DAILY_GENERATION_LIMIT: '3',
    MOCK_EXTERNAL_SERVICES: 'true',
  });
  const database = await f.getDatabase();
  await migrateMultiLesson(database);
  const subject = await addSubject(database, identities.a, 'Biologia Celular', ['Célula', 'Genética']);
  const [cell, genetics] = subject.unitIds;
  const l1 = await addLesson(database, identities.a, {
    title: 'Membrana',
    subjectId: subject.subjectId,
    unitId: cell,
    segments: ['A membrana plasmática controla a entrada e a saída de substâncias da célula.', 'O transporte ativo gasta energia para mover substâncias contra o gradiente.'],
  });
  const l2 = await addLesson(database, identities.a, {
    title: 'Mitocôndria',
    subjectId: subject.subjectId,
    unitId: cell,
    segments: ['A mitocôndria produz a maior parte da energia usada pela célula em forma de ATP.'],
  });
  const pending = await addLesson(database, identities.a, {
    title: 'Núcleo (rascunho)',
    subjectId: subject.subjectId,
    unitId: cell,
    confirm: false,
    segments: ['O núcleo guarda o material genético da célula eucariótica inteira.'],
  });
  await addLesson(database, identities.a, {
    title: 'DNA',
    subjectId: subject.subjectId,
    unitId: genetics,
    segments: ['O DNA é formado por duas fitas que se enrolam em uma dupla hélice estável.'],
  });
  const foreign = await addLesson(database, identities.b, {
    title: 'Aula de B',
    segments: ['Conteúdo de outra conta que nunca deve aparecer para a conta A em resultado algum.'],
  });
  globalThis.fetch = f.fetch;
  const { app } = await import('../src/app.js');
  const { runNextMultiLessonJob } = await import('../src/jobs/multi-lesson-runner.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, path, body, user = 'a') => {
    const res = await fetch(origin + '/api/multi-lesson' + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identities[user].token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  const body = (extra = {}) => ({
    id: randomUUID(),
    requestId: randomUUID(),
    title: 'Unidade Célula',
    selection: { kind: 'unit', ids: [cell] },
    outputs: ['summary', 'questions'],
    settings: { questionCount: 4 },
    ...extra,
  });
  try {
    let preview;
    await t.test('preview lists confirmed lessons and explains the excluded ones', async () => {
      const res = await api('POST', '/preview', { selection: { kind: 'unit', ids: [cell] } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      preview = res.body;
      assert.deepEqual(preview.included.map((item) => item.title), ['Membrana', 'Mitocôndria']);
      assert.deepEqual(preview.excluded, [{ materialId: pending.id, title: 'Núcleo (rascunho)', reason: 'unconfirmed' }]);
      assert.equal(preview.limit, 12);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const subjectPreview = await api('POST', '/preview', { selection: { kind: 'subject', ids: [subject.subjectId] } });
      assert.equal(subjectPreview.body.included.length, 3);
      const units = await api('POST', '/preview', { selection: { kind: 'units', ids: [cell, genetics] } });
      assert.equal(units.body.included.length, 3);
      const lessons = await api('POST', '/preview', { selection: { kind: 'lessons', ids: [l2.id, foreign.id] } });
      assert.deepEqual(lessons.body.included.map((item) => item.materialId), [l2.id]);
      assert.equal(lessons.body.missing, 1);
      assert.doesNotMatch(JSON.stringify(lessons.body), /Aula de B/);
      assert.equal((await api('POST', '/preview', { selection: { kind: 'unit', ids: [cell, genetics] } })).status, 400);
      assert.equal((await api('POST', '/preview', { selection: { kind: 'unit', ids: [cell] } }, 'b')).status, 404);
    });

    let record;
    await t.test('two simultaneous identical requests: one record, one job', async () => {
      const expectedRevisionIds = preview.included.map((item) => item.revisionId);
      const [x, y] = await Promise.all([api('POST', '', body({ expectedRevisionIds })), api('POST', '', body({ expectedRevisionIds }))]);
      assert.equal(x.status, 202, JSON.stringify(x.body));
      assert.equal(y.status, 202, JSON.stringify(y.body));
      assert.deepEqual([x.body.generation.decision, y.body.generation.decision].sort(), ['join', 'start']);
      assert.equal(x.body.multiLesson.id, y.body.multiLesson.id);
      const jobs = (await database.db.query('select count(*)::int as n from public.multi_lesson_jobs')).rows[0].n;
      assert.equal(jobs, 1);
      record = x.body.multiLesson;
      assert.deepEqual(record.sources.map((s) => [s.materialId, s.revision]), [[l1.id, 1], [l2.id, 1]]);
      // The preview the student saw no longer matches: refused, not silently changed.
      const changed = await api('POST', '', body({ expectedRevisionIds: [l1.revisionId] }));
      assert.equal(changed.status, 409);
      assert.equal(changed.body.error.code, 'MULTI_LESSON_SOURCES_CHANGED');
    });

    await t.test('the worker produces the integrated material; citations point to lesson segments', async () => {
      assert.equal(await runNextMultiLessonJob('http-worker'), true);
      const res = await api('GET', '/' + record.id);
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'ready');
      const { summary, questions, lessons } = res.body.result;
      assert(summary.sections.length >= 1);
      assert(questions.length >= 1);
      assert.deepEqual(lessons.map((lesson) => lesson.title), ['Membrana', 'Mitocôndria']);
      for (const citation of [...summary.sections, ...questions].flatMap((item) => item.citations)) {
        assert([l1.id, l2.id].includes(citation.materialId));
        assert(Number.isInteger(citation.position));
        assert(citation.quote.length > 10);
      }
      const list = await api('GET', '');
      assert.equal(list.body.length, 1);
      assert.equal(list.body[0].source_count, 2);
    });

    await t.test('another account cannot read or delete it; reuse on request; budget is explained', async () => {
      assert.equal((await api('GET', '/' + record.id, null, 'b')).status, 404);
      assert.equal((await api('DELETE', '/' + record.id, null, 'b')).status, 404);
      assert.deepEqual((await api('GET', '', null, 'b')).body, []);
      const reused = await api('POST', '', body({ reuse: true }));
      assert.equal(reused.status, 202);
      assert.equal(reused.body.generation.decision, 'reuse');
      assert.equal(reused.body.multiLesson.id, record.id);
      // Budget 3: the first start counted; two more fresh starts, then 429.
      assert.equal((await api('POST', '', body({ outputs: ['summary'] }))).status, 202);
      assert.equal((await api('POST', '', body({ outputs: ['questions'] }))).status, 202);
      const over = await api('POST', '', body({ outputs: ['flashcards'] }));
      assert.equal(over.status, 429);
      assert.equal(over.body.error.code, 'GENERATION_BUDGET_EXCEEDED');
    });

    await t.test('nothing confirmed or too many lessons: clear refusals; invalid input is 400', async () => {
      const none = await api('POST', '', body({ selection: { kind: 'lessons', ids: [pending.id] } }));
      assert.equal(none.status, 409);
      assert.equal(none.body.error.code, 'MULTI_LESSON_NO_SOURCES');
      assert.equal((await api('POST', '', { ...body(), outputs: ['mindmap'] })).status, 400);
      assert.equal((await api('GET', '/not-a-uuid')).status, 400);
      const removed = await api('DELETE', '/' + record.id);
      assert.equal(removed.status, 200);
      assert.equal((await api('GET', '/' + record.id)).status, 404);
    });
  } finally {
    server.close();
    globalThis.fetch = nativeFetch;
    await f.close();
  }
});
