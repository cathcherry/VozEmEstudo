import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { createSet } from './fixtures/classroom-db.fixture.js';
import {
  addIntegratedMaterial,
  createClassWithMembers,
  identities,
  migrateContributions,
} from './fixtures/classroom-contributions-db.fixture.js';

test('class contributions over HTTP: roles, review queue, privacy and private headers', async (t) => {
  const fixture = createSupabaseHttpFixture();
  const nativeFetch = globalThis.fetch;
  Object.assign(process.env, {
    SUPABASE_URL: fixture.origin,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_contributions_fixture',
    SUPABASE_SECRET_KEY: 'contributions-fixture-server-key',
    FEATURE_CLASSROOMS: 'true',
    FEATURE_FLASHCARDS: 'true',
    FEATURE_FLASHCARD_SETS: 'true',
    MOCK_EXTERNAL_SERVICES: 'true',
  });
  const database = await fixture.getDatabase();
  await migrateContributions(database);
  globalThis.fetch = fixture.fetch;
  const { app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(path, method = 'GET', body, user = 'a') {
    const res = await nativeFetch(origin + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(user ? { Authorization: `Bearer ${identities[user].token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json(), headers: res.headers };
  }
  try {
    const { classId } = await createClassWithMembers(database);
    const base = `/api/classrooms/${classId}`;
    const material = await addIntegratedMaterial(database.db, identities.b, {
      title: 'Revisão do Bruno',
    });
    const setB = await createSet(database, identities.b, 'Cartões do Bruno', ['Onda?']);

    await t.test('validation: kinds, ids and the account from the token only', async () => {
      assert.equal((await request(base + '/contributions', 'GET', null, null)).status, 401);
      const bad = await request(
        base + '/contributions',
        'POST',
        { id: randomUUID(), kind: 'lesson', itemId: material.id },
        'b',
      );
      assert.equal(bad.status, 400);
      const smuggled = await request(
        base + '/contributions',
        'POST',
        {
          id: randomUUID(),
          kind: 'integrated_material',
          itemId: material.id,
          ownerId: identities.a.id,
        },
        'b',
      );
      assert.equal(smuggled.status, 400);
      const foreign = await request(
        base + '/contributions',
        'POST',
        { id: randomUUID(), kind: 'integrated_material', itemId: material.id },
        'c',
      );
      assert.equal(foreign.status, 404);
      assert.equal(foreign.body.error.code, 'MULTI_LESSON_NOT_FOUND');
    });

    let contributionId;
    await t.test(
      'a student shares an integrated material: pending, reviewed, then read',
      async () => {
        const created = await request(
          base + '/contributions',
          'POST',
          {
            id: randomUUID(),
            kind: 'integrated_material',
            itemId: material.id,
            note: 'Para a prova',
          },
          'b',
        );
        assert.equal(created.status, 201);
        assert.equal(created.body.status, 'pending');
        assert.equal(created.headers.get('cache-control'), 'no-store');
        assert.equal(created.headers.get('x-robots-tag'), 'noindex, nofollow');
        contributionId = created.body.id;
        assert.deepEqual(
          (await request(base + '/integrated-materials', 'GET', null, 'c')).body,
          [],
        );
        assert.deepEqual(
          (await request(base + '/contributions', 'GET', null, 'c')).body,
          [],
          'other students do not see it',
        );
        const queue = await request(base + '/contributions', 'GET', null, 'a');
        assert.deepEqual(
          queue.body.map((x) => [x.status, x.note]),
          [['pending', 'Para a prova']],
        );
        const review = { decision: 'approved', requestId: randomUUID(), feedback: 'Muito bom.' };
        assert.equal(
          (await request(`${base}/contributions/${contributionId}/review`, 'POST', review, 'c'))
            .status,
          403,
        );
        assert.equal(
          (
            await request(`${base}/contributions/${contributionId}/review`, 'POST', {
              ...review,
              decision: 'published',
            })
          ).status,
          400,
        );
        const approved = await request(
          `${base}/contributions/${contributionId}/review`,
          'POST',
          review,
        );
        assert.equal(approved.status, 200);
        assert.equal(approved.body.feedback, 'Muito bom.');
        const mine = await request(base + '/contributions', 'GET', null, 'b');
        assert.equal(mine.body[0].status, 'approved');
        assert.equal(mine.body[0].feedback, 'Muito bom.');
        const list = await request(base + '/integrated-materials', 'GET', null, 'c');
        assert.deepEqual(
          list.body.map((x) => x.title),
          ['Revisão do Bruno'],
        );
        const read = await request(
          `${base}/integrated-materials/${contributionId}`,
          'GET',
          null,
          'c',
        );
        assert.equal(read.status, 200);
        assert.equal(read.body.content.flashcards[0].front, 'Onda');
        assert.doesNotMatch(
          JSON.stringify(read.body),
          /PRIVATE-REPORT|PRIVATE-FOCUS|private-model|materialId|revisionId/,
        );
        const outsider = await request(
          `${base}/integrated-materials/${contributionId}`,
          'GET',
          null,
          'e',
        );
        assert.equal(outsider.status, 404);
        assert.equal(outsider.body.error.code, 'CLASSROOM_NOT_FOUND');
      },
    );

    await t.test('revocation removes access at once', async () => {
      assert.equal(
        (await request(`${base}/contributions/${contributionId}`, 'DELETE', null, 'c')).status,
        404,
      );
      const ended = await request(`${base}/contributions/${contributionId}`, 'DELETE', null, 'b');
      assert.equal(ended.status, 200);
      assert.equal(ended.body.status, 'revoked');
      assert.equal(
        (await request(`${base}/integrated-materials/${contributionId}`, 'GET', null, 'c')).status,
        404,
      );
    });

    await t.test('the flashcard-set route sends a student set to review', async () => {
      const shared = await request(
        base + '/flashcard-sets',
        'POST',
        { id: randomUUID(), setId: setB },
        'b',
      );
      assert.equal(shared.status, 201);
      assert.equal(shared.body.status, 'pending');
      assert.deepEqual((await request(base + '/flashcard-sets', 'GET', null, 'c')).body, []);
      const rejected = await request(`${base}/contributions/${shared.body.id}/review`, 'POST', {
        decision: 'rejected',
        requestId: randomUUID(),
        feedback: 'Revise o verso.',
      });
      assert.equal(rejected.body.status, 'rejected');
      const mine = await request(base + '/contributions', 'GET', null, 'b');
      assert.equal(mine.body.find((x) => x.id === shared.body.id).feedback, 'Revise o verso.');
    });
  } finally {
    server.close();
    globalThis.fetch = nativeFetch;
    await fixture.close();
  }
});
