import { PERMISSION_DECLARATION } from '../src/config/permission-declaration.js';
import { revisionIds } from './fixtures/academic-db.fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';

import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';

const fixture = createSupabaseHttpFixture();
const supabaseOrigin = fixture.origin;
const nativeFetch = globalThis.fetch;
let tables, effects, signedRequests;
function resetFixture() {
  fixture.reset();
  ({ tables, effects, signedRequests } = fixture.state);
}
const fixtureFetch = fixture.fetch;

test('real HTTP API enforces ownership with two synthetic accounts', async (t) => {
  process.env.SUPABASE_URL = supabaseOrigin;
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_e00_fixture_public';
  process.env.SUPABASE_SECRET_KEY = 'e00-fixture-server-key';
  process.env.SERVE_FRONTEND = 'true';
  process.env.MOCK_EXTERNAL_SERVICES = 'true';
  resetFixture();
  globalThis.fetch = fixtureFetch;
  const { app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { user = 'a', method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (user)
      headers.Authorization = `Bearer ${identities[user]?.token || 'invalid-fixture-token'}`;
    const result = await fetch(base + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: result.status, body: await result.json() };
  }
  try {
    await t.test('requires an authenticated and verified token', async () => {
      for (const user of [null, 'invalid'])
        assert.equal((await request('/api/materials', { user })).status, 401);
    });
    await t.test('lists only the current account materials', async () => {
      for (const user of ['a', 'b']) {
        const result = await request('/api/materials', { user });
        assert.equal(result.status, 200);
        assert.deepEqual(
          result.body.map((material) => material.id),
          [user === 'a' ? resourceIds.materialA : resourceIds.materialB],
        );
      }
    });
    const foreignRoutes = [
      ['', 'GET'],
      ['', 'PATCH', { title: 'Tentativa de alteração' }],
      ['', 'DELETE'],
      ['/process', 'POST'],
      ['/transcription', 'GET'],
      [
        '/transcription',
        'PATCH',
        { expectedRevision: 1, segments: [{ id: resourceIds.missing, text: 'Edição sintética' }] },
      ],
      ['/transcription/versions', 'GET'],
      ['/transcription/versions/1/restore', 'POST'],
      ['/summaries', 'GET'],
      ['/summaries', 'POST', { sourceRevisionId: revisionIds.a }],
      ['/question-batches', 'GET'],
      ['/question-batches', 'POST', { count: 5, sourceRevisionId: revisionIds.a }],
    ];
    for (const [suffix, method, body] of foreignRoutes) {
      await t.test(
        `${method} foreign material${suffix || ' root'} returns 404 without effects`,
        async () => {
          resetFixture();
          for (const [user, materialId] of [
            ['a', resourceIds.materialB],
            ['b', resourceIds.materialA],
            ['a', resourceIds.missing],
          ]) {
            const result = await request(`/api/materials/${materialId}${suffix}`, {
              user,
              method,
              body,
            });
            assert.equal(result.status, 404);
            assert.equal(result.body.error.code, 'NOT_FOUND');
            assert.equal(typeof result.body.requestId, 'string');
          }
          assert.deepEqual(effects, []);
          assert.deepEqual(signedRequests, []);
        },
      );
    }
    await t.test('foreign and missing question IDs return the same 404 contract', async () => {
      for (const id of [resourceIds.questionB, resourceIds.missing]) {
        const result = await request(`/api/questions/${id}/answer`, {
          method: 'POST',
          body: { selectedIndex: 1 },
        });
        assert.equal(result.status, 404);
        assert.equal(result.body.error.code, 'NOT_FOUND');
      }
      assert.equal(
        (
          await request(`/api/questions/${resourceIds.questionA}/answer`, {
            method: 'POST',
            body: { selectedIndex: 1 },
          })
        ).body.correct,
        true,
      );
    });
    await t.test('job and event endpoints reject foreign and missing UUIDs', async () => {
      for (const id of [resourceIds.jobB, resourceIds.missing]) {
        for (const suffix of ['', '/events'])
          assert.equal((await request(`/api/jobs/${id}${suffix}`)).status, 404);
      }
      assert.equal((await request(`/api/jobs/${resourceIds.jobA}`)).status, 200);
      assert.equal((await request(`/api/jobs/${resourceIds.jobA}/events`)).body.length, 1);
    });
    await t.test('signs the owned storage path with a 600 second lifetime', async () => {
      resetFixture();
      const owned = await request(`/api/materials/${resourceIds.materialA}`);
      assert.equal(owned.status, 200);
      assert.equal(typeof owned.body.signedAudioUrl, 'string');
      assert.deepEqual(signedRequests, [
        {
          path: `/storage/v1/object/sign/audios/retained/${identities.a.id}/${resourceIds.materialA}/fixture.wav`,
          expiresIn: 600,
        },
      ]);
      assert.equal(
        (await request(`/api/materials/${resourceIds.materialA}`, { user: 'b' })).status,
        404,
      );
      assert.equal(signedRequests.length, 1);
    });
    await t.test('question list projection excludes the answer key and explanation', async () => {
      const result = await request(`/api/materials/${resourceIds.materialA}/question-batches`);
      assert.equal(result.status, 200);
      const question = result.body[0].questions[0];
      assert.equal(Object.hasOwn(question, 'correct_index'), false);
      assert.equal(Object.hasOwn(question, 'explanation'), false);
      assert.equal(question.id, resourceIds.questionA);
    });
    await t.test(
      'rejects foreign and noncanonical storage paths before creating any material',
      async () => {
        resetFixture();
        const body = {
          id: resourceIds.newMaterial,
          title: 'Material sintético',
          originalFilename: 'fixture.wav',
          mimeType: 'audio/wav',
          extension: 'wav',
          sizeBytes: 1024,
          durationMs: 3000,
          questionCount: 5,
          retainAudio: true,
          permissionAccepted: true,
          permissionVersion: PERMISSION_DECLARATION.version,
          storagePath: `temp/${identities.b.id}/${resourceIds.newMaterial}/fixture.wav`,
          user_id: identities.b.id,
        };
        const forbidden = await request('/api/materials', { method: 'POST', body });
        assert.equal(forbidden.status, 403);
        assert.equal(forbidden.body.error.code, 'FORBIDDEN');
        assert.deepEqual(effects, []);
        const prefix = `temp/${identities.a.id}/${resourceIds.newMaterial}/`;
        const invalidPaths = [
          '../../../retained/other-account/fixture.wav',
          '%2e%2e/%2e%2e/%2e%2e/retained/other-account/fixture.wav',
          '..\\..\\..\\retained\\other-account\\fixture.wav',
          'nested/../fixture.wav',
          'nested//fixture.wav',
          'fixture.wav?download=true',
          'fixture.wav#fragment',
          'percent%252e%252e.wav',
          '.',
          '..',
        ];
        for (const suffix of invalidPaths) {
          body.storagePath = prefix + suffix;
          assert.equal((await request('/api/materials', { method: 'POST', body })).status, 403);
          assert.deepEqual(effects, []);
        }
        body.storagePath = `temp/${identities.a.id}/${resourceIds.newMaterial}/fixture.wav`;
        const created = await request('/api/materials', { method: 'POST', body });
        assert.equal(created.status, 201);
        assert.equal(
          tables.materials.find((material) => material.id === resourceIds.newMaterial).user_id,
          identities.a.id,
        );
      },
    );
    await t.test('blocks unsafe stored media before signing or deleting it', async () => {
      resetFixture();
      const audio = tables.audio_files.find((item) => item.material_id === resourceIds.materialA);
      audio.storage_path = `temp/${identities.a.id}/${resourceIds.materialA}/../../../retained/${identities.b.id}/${resourceIds.materialB}/fixture.wav`;
      const result = await request(`/api/materials/${resourceIds.materialA}`);
      const attemptedForeignSigning = signedRequests.some((item) =>
        item.path.includes(`/retained/${identities.b.id}/`),
      );
      assert.equal(
        result.status,
        403,
        `Unsafe media response status; foreign signing attempted: ${attemptedForeignSigning}`,
      );
      assert.equal(
        (await request(`/api/materials/${resourceIds.materialA}`, { method: 'DELETE' })).status,
        403,
      );
      assert.deepEqual(signedRequests, []);
      assert.deepEqual(effects, []);
    });
    await t.test('does not serve environment files or server credentials', async () => {
      for (const path of ['/.env', '/backend/.env', '/assets/../backend/.env'])
        assert.equal((await request(path)).status, 404);
      const config = await request('/api/config');
      assert.equal(config.status, 200);
      for (const name of ['supabaseSecretKey', 'groqApiKey', 'hfToken'])
        assert.equal(Object.hasOwn(config.body, name), false);
      assert.equal(JSON.stringify(config.body).includes(process.env.SUPABASE_SECRET_KEY), false);
    });
  } finally {
    await fixture.close();
    globalThis.fetch = nativeFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});
