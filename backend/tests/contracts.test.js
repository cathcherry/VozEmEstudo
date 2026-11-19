import { PERMISSION_DECLARATION } from '../src/config/permission-declaration.js';
import { revisionIds } from './fixtures/academic-db.fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';

test('the current app HTTP contract uses fake providers and stable responses', async (t) => {
  const fixture = createSupabaseHttpFixture();
  const nativeFetch = globalThis.fetch;
  process.env.SUPABASE_URL = fixture.origin;
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_contract_fixture_public';
  process.env.SUPABASE_SECRET_KEY = 'contract-fixture-server-key';
  process.env.GROQ_API_KEY = 'contract-fixture-llm-key';
  process.env.HF_TOKEN = 'contract-fixture-asr-key';
  process.env.MOCK_EXTERNAL_SERVICES = 'true';
  for (const name of [
    'CATALOG_UNITS',
    'PLANNING',
    'MP4_RETENTION',
    'STUDY_TRACKING',
    'QUIZ_V2',
    'QUIZ_REVIEW',
    'FLASHCARDS',
    'SOCIAL_BASIC',
    'SHARING',
  ])
    delete process.env[`FEATURE_${name}`];
  globalThis.fetch = fixture.fetch;
  const { app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(
    route,
    { method = 'GET', body, token = identities.a.token, rawBody } = {},
  ) {
    const headers = { 'Content-Type': 'application/json', 'X-Request-Id': 'e01-fixture-request' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const result = await fetch(base + route, {
      method,
      headers,
      body: rawBody ?? (body ? JSON.stringify(body) : undefined),
    });
    const payload = await result.json();
    const serialized = JSON.stringify(payload);
    for (const name of ['SUPABASE_SECRET_KEY', 'GROQ_API_KEY', 'HF_TOKEN'])
      assert.equal(serialized.includes(process.env[name]), false, `${name} must not be returned`);
    assert.equal(Object.hasOwn(payload, 'stack'), false);
    return { status: result.status, body: payload, requestId: result.headers.get('x-request-id') };
  }
  const material = (count) => ({
    id: resourceIds.newMaterial,
    title: 'Aula sintética',
    subject: 'Física',
    originalFilename: 'fixture.wav',
    mimeType: 'audio/wav',
    extension: 'wav',
    sizeBytes: 1024,
    durationMs: 3000,
    questionCount: count,
    retainAudio: true,
    permissionAccepted: true,
    permissionVersion: PERMISSION_DECLARATION.version,
    storagePath: `temp/${identities.a.id}/${resourceIds.newMaterial}/fixture.wav`,
  });
  function assertError(result, status, code) {
    assert.equal(result.status, status);
    assert.equal(result.body.error.code, code);
    assert.equal(result.body.requestId, 'e01-fixture-request');
    assert.equal(result.requestId, result.body.requestId);
    assert.equal(typeof result.body.error.message, 'string');
  }
  try {
    await t.test('health and config remain public with all flags OFF', async () => {
      assert.deepEqual((await request('/api/health', { token: null })).body, {
        ok: true,
        service: 'audioestudo-api',
      });
      const config = (await request('/api/config', { token: null })).body;
      assert.deepEqual(config.allowedQuestionCounts, [3, 5, 10, 20]);
      assert.equal(Object.keys(config.featureFlags).length, 13);
      assert.equal(config.featureFlags.study_authoring, false);
      assert.equal(config.featureFlags.flashcard_sets, false);
      assert(Object.values(config.featureFlags).every((flag) => flag === false));
    });
    await t.test('every protected route group requires a verified session', async () => {
      for (const [route, method] of [
        ['/api/materials', 'GET'],
        [`/api/jobs/${resourceIds.jobA}`, 'GET'],
        [`/api/questions/${resourceIds.questionA}/answer`, 'POST'],
        ['/api/media/inspect?extension=wav', 'POST'],
      ]) {
        for (const token of [null, 'expired-fixture-token'])
          assertError(await request(route, { method, token }), 401, 'AUTH_REQUIRED');
      }
    });
    await t.test(
      'new material creation and retrieval preserve UUID, owner and metadata',
      async () => {
        for (const count of [3, 5, 10, 20]) {
          fixture.reset();
          const created = await request('/api/materials', {
            method: 'POST',
            body: { ...material(count), user_id: identities.b.id },
          });
          assert.equal(created.status, 201);
          assert.equal(created.body.id, resourceIds.newMaterial);
          assert.equal(created.body.user_id, identities.a.id);
          assert.equal(created.body.initial_question_count, count);
          const retrieved = await request(`/api/materials/${resourceIds.newMaterial}`);
          assert.equal(retrieved.status, 200);
          assert.equal(retrieved.body.id, created.body.id);
          assert.equal(retrieved.body.audio.duration_ms, 3000);
          assert.equal(retrieved.body.questionBatches.length, 0);
        }
      },
    );
    await t.test(
      'question batch endpoints enqueue 3, 5, 10 and 20 without a model call',
      async () => {
        fixture.reset();
        for (const count of [3, 5, 10, 20]) {
          const result = await request(`/api/materials/${resourceIds.materialA}/question-batches`, {
            method: 'POST',
            body: { count, sourceRevisionId: revisionIds.a },
          });
          assert.equal(result.status, 202);
          assert.equal(result.body.materialId, resourceIds.materialA);
          assert.match(result.body.jobId, /^[\da-f-]{36}$/i);
          const job = fixture.state.tables.processing_jobs.find(
            (row) => row.id === result.body.jobId,
          );
          assert.deepEqual(job.params, {
            count,
            sourceRevisionId: revisionIds.a,
            permissionVersion: PERMISSION_DECLARATION.version,
          });
          assert.equal(job.type, 'GERAR_QUESTOES');
        }
      },
    );
    await t.test('invalid counts, invalid DTOs and missing routes use stable errors', async () => {
      fixture.reset();
      for (const count of [0, 4, 21])
        assertError(
          await request(`/api/materials/${resourceIds.materialA}/question-batches`, {
            method: 'POST',
            body: { count, sourceRevisionId: revisionIds.a },
          }),
          400,
          'INVALID_QUESTION_COUNT',
        );
      assertError(
        await request('/api/materials', {
          method: 'POST',
          body: { ...material(5), id: 'invalid-id' },
        }),
        400,
        'VALIDATION_ERROR',
      );
      assertError(await request('/api/not-a-route'), 404, 'NOT_FOUND');
      assert.deepEqual(fixture.state.effects, []);
    });
    await t.test('malformed JSON has a safe 400 response and requestId', async () => {
      fixture.reset();
      assertError(
        await request('/api/materials', { method: 'POST', rawBody: '{"title":' }),
        400,
        'INVALID_JSON',
      );
      assert.deepEqual(fixture.state.effects, []);
    });
    await t.test(
      'unknown provider errors expose neither raw messages nor credentials in responses or logs',
      async () => {
        fixture.reset();
        fixture.state.failures.materials = `Synthetic failure ${process.env.GROQ_API_KEY}`;
        const logs = [];
        const originalError = console.error;
        console.error = (message) => logs.push(message);
        try {
          assertError(await request('/api/materials'), 500, 'INTERNAL_ERROR');
          assert.equal(JSON.stringify(logs).includes(process.env.GROQ_API_KEY), false);
          assert(logs.length > 0);
        } finally {
          console.error = originalError;
        }
      },
    );
    await t.test(
      'oversized JSON also returns a correlated error before any database effect',
      async () => {
        fixture.reset();
        const result = await request('/api/materials', {
          method: 'POST',
          body: { title: 'a'.repeat(2 * 1024 * 1024) },
        });
        assertError(result, 413, 'MEDIA_TOO_LARGE');
        assert.deepEqual(fixture.state.effects, []);
      },
    );
  } finally {
    await fixture.close();
    globalThis.fetch = nativeFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});
