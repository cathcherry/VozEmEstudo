import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { revisionIds } from './fixtures/academic-db.fixture.js';
import {
  migrateClassrooms,
  createSet,
  identities,
  resourceIds,
} from './fixtures/classroom-db.fixture.js';

test('classrooms over HTTP: auth, validation, roles, scoped errors and private headers', async (t) => {
  const fixture = createSupabaseHttpFixture();
  const nativeFetch = globalThis.fetch;
  Object.assign(process.env, {
    SUPABASE_URL: fixture.origin,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_classrooms_fixture',
    SUPABASE_SECRET_KEY: 'classrooms-fixture-server-key',
    FEATURE_CLASSROOMS: 'true',
    FEATURE_FLASHCARDS: 'true',
    FEATURE_FLASHCARD_SETS: 'true',
    MOCK_EXTERNAL_SERVICES: 'true',
  });
  const database = await fixture.getDatabase();
  await migrateClassrooms(database);
  globalThis.fetch = fixture.fetch;
  const { app } = await import('../src/app.js');
  // Imported after the environment is set (the service loads the server configuration).
  const { hashInviteCode, normalizeInviteCode } =
    await import('../src/services/classroom.service.js');
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
  const classId = randomUUID();
  const base = `/api/classrooms/${classId}`;
  const CODE = 'ABCD-EFGH-JKMN';
  try {
    await t.test('authentication is required and the body never names the owner', async () => {
      assert.equal((await request('/api/classrooms', 'GET', null, null)).status, 401);
      const smuggled = await request('/api/classrooms', 'POST', {
        id: classId,
        name: 'Física',
        ownerId: identities.b.id,
      });
      assert.equal(smuggled.status, 400);
      const created = await request('/api/classrooms', 'POST', {
        id: classId,
        name: 'Física 2º ano',
        description: 'Turma da manhã',
        displayName: 'Profa. Ana',
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.role, 'teacher');
      assert.equal(created.headers.get('cache-control'), 'no-store');
      assert.equal(created.headers.get('x-robots-tag'), 'noindex, nofollow');
      assert.equal((await request('/api/classrooms')).body.length, 1);
      assert.deepEqual((await request('/api/classrooms', 'GET', null, 'b')).body, []);
    });

    await t.test(
      'invites: codes are normalized and hashed; only managers create them',
      async () => {
        assert.equal(normalizeInviteCode(' abcd efgh-jkmn '), 'ABCDEFGHJKMN');
        const body = { id: randomUUID(), requestId: randomUUID(), code: CODE, days: 7, maxUses: 3 };
        assert.equal(
          (await request(base + '/invites', 'POST', { ...body, code: 'ABC0-EFGH-JKMN' })).status,
          400,
          'ambiguous characters are not codes',
        );
        assert.equal((await request(base + '/invites', 'POST', { ...body, days: 90 })).status, 400);
        assert.equal((await request(base + '/invites', 'POST', body, 'b')).status, 404);
        const created = await request(base + '/invites', 'POST', body);
        assert.equal(created.status, 201);
        const stored = (await database.db.query('select token_hash from public.classroom_invites'))
          .rows[0];
        assert.equal(stored.token_hash, hashInviteCode(CODE));
        const listed = await request(base + '/invites');
        assert.equal(listed.body[0].state, 'active');
        assert(!JSON.stringify(listed.body).includes(stored.token_hash));
      },
    );

    await t.test('join, members and roles', async () => {
      const wrong = await request(
        '/api/classrooms/join',
        'POST',
        { code: 'ZZZZ-ZZZZ-ZZZZ', displayName: 'Bruno' },
        'b',
      );
      assert.equal(wrong.status, 404);
      assert.equal(wrong.body.error.code, 'CLASSROOM_INVITE_INVALID');
      const joined = await request(
        '/api/classrooms/join',
        'POST',
        { code: 'abcd efgh jkmn', displayName: 'Bruno' },
        'b',
      );
      assert.equal(joined.status, 200);
      assert.equal(joined.body.role, 'student');
      await request('/api/classrooms/join', 'POST', { code: CODE, displayName: 'Davi' }, 'd');
      assert.equal(
        (await request(`${base}/members/${identities.d.id}`, 'PATCH', { role: 'assistant' }, 'b'))
          .status,
        403,
      );
      assert.equal(
        (await request(`${base}/members/${identities.d.id}`, 'PATCH', { role: 'assistant' }))
          .status,
        200,
      );
      const members = await request(base + '/members', 'GET', null, 'b');
      assert.deepEqual(
        members.body.map((m) => m.role),
        ['teacher', 'assistant', 'student'],
      );
      assert.equal((await request(base, 'GET', null, 'e')).status, 404);
      assert.equal((await request(base, 'PATCH', { name: 'X' }, 'd')).status, 403);
    });

    let lessonId;
    await t.test('publish a lesson; members read the pinned revision only', async () => {
      const published = await request(base + '/lessons', 'POST', {
        id: randomUUID(),
        materialId: resourceIds.materialA,
        revisionId: revisionIds.a,
        questionBatchIds: [resourceIds.batchA],
      });
      assert.equal(published.status, 201, JSON.stringify(published.body));
      lessonId = published.body.id;
      assert.equal(
        (
          await request(base + '/lessons', 'POST', {
            id: randomUUID(),
            materialId: resourceIds.materialB,
            revisionId: revisionIds.b,
          })
        ).status,
        404,
        "a teacher cannot publish a student's material",
      );
      const seen = await request(`${base}/lessons/${lessonId}`, 'GET', null, 'b');
      assert.equal(seen.status, 200);
      assert.match(seen.body.transcript.fullText, /Energia é conservada/);
      assert.equal(seen.body.questionLists[0].questions.length, 1);
      const outsider = await request(`${base}/lessons/${lessonId}`, 'GET', null, 'e');
      assert.equal(outsider.status, 404);
      assert.equal(outsider.body.error.code, 'CLASSROOM_NOT_FOUND');
    });

    await t.test('submission workflow over HTTP', async () => {
      const subId = randomUUID();
      const sub = await request(
        base + '/submissions',
        'POST',
        { id: subId, materialId: resourceIds.materialB },
        'b',
      );
      assert.equal(sub.status, 201, JSON.stringify(sub.body));
      const move = (to, user, extra = {}) =>
        request(
          `${base}/submissions/${subId}/transitions`,
          'POST',
          { to, requestId: randomUUID(), ...extra },
          user,
        );
      assert.equal((await move('nonsense', 'a')).status, 400);
      assert.equal((await move('published', 'a')).status, 409);
      assert.equal((await move('approved_for_processing', 'b')).status, 403);
      assert.equal(
        (await move('approved_for_processing', 'd')).body.status,
        'approved_for_processing',
      );
      assert.equal((await move('processing', 'b')).body.status, 'processing');
      const detail = await request(`${base}/submissions/${subId}`, 'GET', null, 'a');
      assert.equal(detail.body.review.revisionId, revisionIds.b);
      assert.equal(detail.body.review.studentConfirmed, true);
      assert.equal(
        (await move('transcription_confirmed', 'a', { revisionId: revisionIds.b })).status,
        200,
      );
      const published = await move('published', 'a');
      assert.equal(published.body.status, 'published');
      assert.equal((await request(base + '/lessons', 'GET', null, 'd')).body.length, 2);
      assert.equal((await request(base + '/submissions', 'GET', null, 'd')).body.length, 1);
    });

    await t.test('shared flashcard sets: list and read, content only; revoke hides', async () => {
      const setId = await createSet(database, identities.b, 'Física — Bruno', [
        'Energia?',
        'Trabalho?',
      ]);
      assert.equal(
        (await request(base + '/flashcard-sets', 'POST', { id: randomUUID(), setId }, 'a')).status,
        404,
      );
      const shared = await request(
        base + '/flashcard-sets',
        'POST',
        { id: randomUUID(), setId },
        'b',
      );
      assert.equal(shared.status, 201);
      const list = await request(base + '/flashcard-sets', 'GET', null, 'd');
      assert.equal(list.body.length, 1);
      assert.equal(list.body[0].author.displayName, 'Bruno');
      const one = await request(`${base}/flashcard-sets/${shared.body.sharedId}`, 'GET', null, 'a');
      assert.equal(one.body.cards.length, 2);
      assert.doesNotMatch(JSON.stringify(one.body), /due_at|ease|interval|repetitions|reviewed/);
      assert.equal(
        (await request(`${base}/flashcard-sets/${shared.body.sharedId}`, 'DELETE', null, 'b'))
          .status,
        200,
      );
      assert.deepEqual((await request(base + '/flashcard-sets', 'GET', null, 'a')).body, []);
    });

    await t.test(
      'without the contributions migration: scoped 503, direct sharing still works',
      async () => {
        for (const path of ['/contributions', '/integrated-materials']) {
          const res = await request(base + path, 'GET', null, 'b');
          assert.equal(res.status, 503, path);
          assert.equal(res.body.error.code, 'CLASSROOM_CONTRIBUTIONS_SCHEMA_REQUIRED');
        }
        assert.equal((await request(base, 'GET', null, 'b')).status, 200, 'the class still works');
      },
    );

    await t.test('resources and leaving', async () => {
      const resource = {
        id: randomUUID(),
        title: 'Lista de exercícios',
        url: 'https://example.org/lista',
      };
      assert.equal(
        (await request(base + '/resources', 'POST', { ...resource, url: 'http://example.org' }))
          .status,
        400,
      );
      assert.equal((await request(base + '/resources', 'POST', resource, 'b')).status, 403);
      assert.equal((await request(base + '/resources', 'POST', resource)).status, 201);
      assert.equal((await request(base + '/resources', 'GET', null, 'b')).body.length, 1);
      assert.equal((await request(base + '/leave', 'POST', null, 'a')).status, 409);
      assert.equal((await request(base + '/leave', 'POST', null, 'b')).status, 200);
      assert.equal((await request(base, 'GET', null, 'b')).status, 404);
      assert.equal((await request(`${base}/lessons/${lessonId}`, 'GET', null, 'b')).status, 404);
    });
  } finally {
    server.close();
    globalThis.fetch = nativeFetch;
    await fixture.close();
  }
});
