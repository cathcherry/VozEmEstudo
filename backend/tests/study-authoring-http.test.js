import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { migrateStudyAuthoring } from './fixtures/authoring-db.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';
import { revisionIds } from './fixtures/academic-db.fixture.js';

test('study authoring over HTTP: named summaries, custom lists, answer keys and ownership', async (t) => {
  const fixture = createSupabaseHttpFixture(),
    nativeFetch = globalThis.fetch;
  Object.assign(process.env, {
    SUPABASE_URL: fixture.origin,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_authoring_fixture',
    SUPABASE_SECRET_KEY: 'authoring-fixture-server-key',
    FEATURE_STUDY_AUTHORING: 'true',
    FEATURE_SHARING: 'true',
    MOCK_EXTERNAL_SERVICES: 'true',
    MAX_QUESTION_LIST_COUNT: '30',
  });
  const { db } = await fixture.getDatabase();
  await migrateStudyAuthoring(db);
  fixture.state.tables.question_list_shares = [];
  globalThis.fetch = fixture.fetch;
  const { app } = await import('../src/app.js');
  const { executeClaimedJob } = await import('../src/jobs/job-runner.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(path, method = 'GET', body, user = 'a') {
    const res = await fetch(origin + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(user ? { Authorization: `Bearer ${identities[user].token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json(), headers: res.headers };
  }
  const materialPath = '/api/materials/' + resourceIds.materialA;
  const runJob = async (jobId) => {
    const job = fixture.state.tables.processing_jobs.find((row) => row.id === jobId);
    await executeClaimedJob({ ...job, attempt_count: 1, max_attempts: 3 });
  };
  try {
    await t.test('config advertises the server-side list ceiling', async () => {
      const config = (await request('/api/config', 'GET', null, null)).body;
      assert.equal(config.maxQuestionListCount, 30);
      assert.deepEqual(config.allowedQuestionCounts, [3, 5, 10, 20]);
    });

    await t.test('a named summary stores options, provider and keeps the older version', async () => {
      const options = { format: 'definitions', length: 'short', focus: ['terminology'], label: 'Glossário da aula' };
      const queued = await request(materialPath + '/summaries', 'POST', {
        sourceRevisionId: revisionIds.a,
        idempotencyKey: randomUUID(),
        options,
      });
      assert.equal(queued.status, 202);
      await runJob(queued.body.jobId);
      const summary = fixture.state.tables.summary_versions.find((row) => row.processing_job_id === queued.body.jobId);
      assert.equal(summary.label, 'Glossário da aula');
      assert.deepEqual(summary.options, { format: 'definitions', length: 'short', focus: ['terminology'] });
      assert(summary.provider);
      assert.equal(summary.source_transcription_version_id, revisionIds.a);
      const renamed = await request(`${materialPath}/summaries/${summary.id}`, 'PATCH', { label: 'Termos' });
      assert.equal(renamed.status, 200);
      assert.equal(renamed.body.label, 'Termos');
      assert.equal((await request(`${materialPath}/summaries/${summary.id}`, 'PATCH', { label: 'X' }, 'b')).status, 404);
      assert.equal((await request(`${materialPath}/summaries/${summary.id}`, 'PATCH', { label: 'X', text: 'Y' })).status, 400);
    });

    let listId;
    await t.test('custom counts are bounded server-side and lists are named', async () => {
      const post = (body, user = 'a') =>
        request(materialPath + '/question-batches', 'POST', { sourceRevisionId: revisionIds.a, idempotencyKey: randomUUID(), ...body }, user);
      assert.equal((await post({ count: 31, config: {} })).status, 400);
      assert.equal((await post({ count: 0, config: {} })).status, 400);
      assert.equal((await post({ count: 7, config: { format: 'true_false' } })).status, 400);
      assert.equal((await post({ count: 7, config: {} }, 'b')).status, 404);
      const queued = await post({
        count: 7,
        config: {
          title: 'Física — Conceitos básicos',
          difficulties: ['basic', 'advanced'],
          skills: ['recall', 'application'],
          previousQuestions: 'avoid',
        },
      });
      assert.equal(queued.status, 202);
      await runJob(queued.body.jobId);
      const list = fixture.state.tables.question_batches.find((row) => row.processing_job_id === queued.body.jobId);
      listId = list.id;
      assert.equal(list.title, 'Física — Conceitos básicos');
      assert.equal(list.requested_count, 7);
      // The two-sentence fixture lesson cannot sustain seven distinct questions.
      assert(list.generated_count >= 1 && list.generated_count < 7, `generated ${list.generated_count}`);
      assert.equal(list.coverage.shortfall, 'insufficient_content');
      assert.deepEqual(list.config.difficulties, ['basic', 'advanced']);
      assert.equal(list.prompt_version, 'questions-v2');
      const material = (await request(materialPath)).body;
      const dto = material.questionBatches.find((batch) => batch.id === listId);
      assert.equal(dto.title, 'Física — Conceitos básicos');
      for (const question of dto.questions) {
        assert.deepEqual(Object.keys(question).sort(), ['created_at', 'id', 'options', 'position', 'statement']);
      }
      const rename = await request(`${materialPath}/question-batches/${listId}`, 'PATCH', { title: 'Física — Revisão' });
      assert.equal(rename.status, 200);
      assert.equal(rename.body.title, 'Física — Revisão');
      assert.equal((await request(`${materialPath}/question-batches/${listId}`, 'PATCH', { title: '' })).status, 400);
      assert.equal((await request(`${materialPath}/question-batches/${listId}`, 'PATCH', { title: 'X' }, 'b')).status, 404);
      // Presets without a config still use the original batch path.
      const legacy = await post({ count: 3 });
      await runJob(legacy.body.jobId);
      const batch = fixture.state.tables.question_batches.find((row) => row.processing_job_id === legacy.body.jobId);
      assert.equal(batch.generated_count, 3);
      assert.equal(batch.prompt_version, 'questions-v1');
    });

    await t.test('answer key is owner-only and not cached', async () => {
      const key = await request(`${materialPath}/question-batches/${listId}/answer-key`);
      assert.equal(key.status, 200);
      assert.equal(key.headers.get('cache-control'), 'no-store');
      assert(key.body.questions.every((q) => Number.isInteger(q.correctIndex) && q.explanation));
      assert(key.body.questions[0].metadata.evidence);
      assert.equal((await request(`${materialPath}/question-batches/${listId}/answer-key`, 'GET', null, 'b')).status, 404);
      assert.equal(
        (await request(`/api/materials/${resourceIds.materialB}/question-batches/${listId}/answer-key`, 'GET', null, 'b')).status,
        404,
      );
      assert.equal((await request(`${materialPath}/question-batches/${listId}/answer-key`, 'GET', null, null)).status, 401);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fixture.close();
    globalThis.fetch = nativeFetch;
  }
});
