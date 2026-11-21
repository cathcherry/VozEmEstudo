import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';
import {
  addConfirmedLesson,
  discoveriesMigrationSql,
  migratePrerequisites,
  multiRevisionId,
} from './fixtures/discoveries-db.fixture.js';
import { addMultiSegmentRevision } from './fixtures/notes-db.fixture.js';

// Real SQL (PGlite) behind the HTTP adapter: the whole slice over the API — lesson → question →
// verified evidence → own explanation → discovery → collectible → desk placement — with
// validation, idempotency, isolation and private caching headers.
test('Milestone 6 over HTTP: investigation, discovery, collection and desk; private and verified', async () => {
  const fixture = createSupabaseHttpFixture(),
    nativeFetch = globalThis.fetch;
  Object.assign(process.env, {
    SUPABASE_URL: fixture.origin,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_discoveries_fixture',
    SUPABASE_SECRET_KEY: 'discoveries-fixture-server-key',
    FEATURE_ANNOTATIONS: 'true',
    FEATURE_DISCOVERIES: 'true',
    MOCK_EXTERNAL_SERVICES: 'true',
  });
  const { db } = await fixture.getDatabase();
  await migratePrerequisites(db);
  await db.exec(discoveriesMigrationSql());
  await addMultiSegmentRevision(db, identities.a.id, resourceIds.materialA);
  globalThis.fetch = fixture.fetch;
  const { app } = await import('../src/app.js');
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
  const A = resourceIds.materialA;
  const EXPLANATION = 'A energia muda de forma, mas o total se conserva no sistema.';
  try {
    assert.equal((await request(`/api/investigations/source/${A}`, 'GET', null, null)).status, 401);
    const source = await request(`/api/investigations/source/${A}`);
    assert.equal(source.status, 200, JSON.stringify(source.body));
    assert.equal(source.body.revisionId, multiRevisionId);
    assert.equal(source.body.segments.length, 3);
    assert.equal(source.headers.get('cache-control'), 'no-store');
    assert.equal(source.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal((await request(`/api/investigations/source/${A}`, 'GET', null, 'b')).status, 404);
    assert.equal((await request('/api/investigations/source/not-a-uuid')).status, 400);

    // 1. Question (from a prompt).
    const id = randomUUID();
    const start = {
      version: 0,
      requestId: randomUUID(),
      body: { materialId: A, sourceRevisionId: multiRevisionId.toUpperCase(), question: 'Por que a energia se conserva?', questionOrigin: 'prompt' },
    };
    const created = await request(`/api/investigations/${id}`, 'PUT', start);
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.investigation.questionOrigin, 'prompt');
    const replay = await request(`/api/investigations/${id}`, 'PUT', start);
    assert.equal(replay.body.replayed, true);
    for (const [label, body] of [
      ['unknown field', { ...start, requestId: randomUUID(), body: { ...start.body, score: 10 } }],
      ['too short', { ...start, requestId: randomUUID(), body: { ...start.body, question: 'a' } }],
      ['patch without fields', { version: 1, requestId: randomUUID(), body: {} }],
    ])
      assert.equal((await request(`/api/investigations/${randomUUID()}`, 'PUT', body)).status, 400, label);

    // 2. Evidence: a wrong quote is refused by the database, the right one verified.
    const wrong = await request(`/api/investigations/${id}/evidence`, 'POST', {
      id: randomUUID(), segmentPosition: 0, startOffset: 0, endOffset: 7, quote: 'Energiaa',
    });
    assert.equal(wrong.status, 409);
    assert.equal(wrong.body.error.code, 'DISCOVERY_ANCHOR_CONFLICT');
    const evidence = { id: randomUUID(), segmentPosition: 0, startOffset: 8, endSegmentPosition: 1, endOffset: 13, quote: 'é conservada.\nUma afirmação', note: 'Ideia-chave' };
    const added = await request(`/api/investigations/${id}/evidence`, 'POST', evidence);
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.deepEqual(added.body.newUnlocks.map((u) => u.id), ['stamp.first-evidence']);
    const again = await request(`/api/investigations/${id}/evidence`, 'POST', evidence);
    assert.equal(again.body.replayed, true);
    assert.deepEqual(again.body.newUnlocks, [], 'a retry celebrates nothing twice');
    assert.equal((await request(`/api/investigations/${id}/evidence`, 'POST', { ...evidence, id: randomUUID(), endSegmentPosition: 99 })).status, 400);
    assert.equal((await request(`/api/investigations/${id}/evidence`, 'POST', evidence, 'b')).status, 404);

    // Completion is refused until there is an own explanation.
    const early = await request(`/api/investigations/${id}/complete`, 'POST', { requestId: randomUUID() });
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, 'DISCOVERY_EXPLANATION_REQUIRED');

    // 3. Own explanation, 4. apply (an own highlight), 5. reflection.
    const explained = await request(`/api/investigations/${id}`, 'PUT', {
      version: 1, requestId: randomUUID(), body: { explanation: EXPLANATION, reflection: 'Quero ligar isto ao calor.', explored: true },
    });
    assert.equal(explained.status, 200);
    assert.deepEqual(explained.body.newUnlocks.map((u) => u.id), ['stamp.own-explanation']);
    assert.equal(explained.body.canComplete, true);
    const stale = await request(`/api/investigations/${id}`, 'PUT', { version: 1, requestId: randomUUID(), body: { reflection: 'x' } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'DISCOVERY_VERSION_CONFLICT');
    const highlight = randomUUID();
    await db.query(
      "insert into public.study_annotations(id,user_id,material_id,source_revision_id,source_revision,segment_position,end_segment_position,start_offset,end_offset,quote,note_text,last_request_id,last_body,anchor_version) values($1,$2,$3,$4,2,2,2,0,5,'Calor','',$5,'{}',2)",
      [highlight, identities.a.id, A, multiRevisionId, randomUUID()],
    );
    const options = await request(`/api/investigations/${id}/link-options`);
    assert.deepEqual(options.body.annotations.map((n) => n.id), [highlight]);
    const linked = await request(`/api/investigations/${id}/links`, 'PUT', { kind: 'annotation', refId: highlight });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.links[0].target.label, 'Calor');
    assert.equal((await request(`/api/investigations/${id}/links`, 'PUT', { kind: 'flashcard', refId: randomUUID() })).body.error.code, 'DISCOVERY_LINK_INVALID');
    assert.equal((await request(`/api/investigations/${id}/links`, 'PUT', { kind: 'reward', refId: highlight })).status, 400);

    // Discovery.
    const done = await request(`/api/investigations/${id}/complete`, 'POST', { requestId: randomUUID() });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.discovery.id, id);
    assert.deepEqual(done.body.newUnlocks.map((u) => u.id).sort(), ['stamp.first-investigation', 'stamp.first-reflection']);
    const discovery = await request(`/api/discoveries/${id}`);
    assert.equal(discovery.body.evidence[0].quote, 'é conservada.\nUma afirmação');
    assert.deepEqual(discovery.body.stamps.map((s) => s.id).sort(), ['stamp.first-evidence', 'stamp.first-investigation', 'stamp.first-reflection', 'stamp.own-explanation']);
    assert.equal((await request(`/api/discoveries/${id}`, 'GET', null, 'b')).status, 404);
    const edited = await request(`/api/discoveries/${id}`, 'PUT', { version: 1, requestId: randomUUID(), explanation: `${EXPLANATION} Revisto.` });
    assert.equal(edited.body.discovery.version, 2);
    assert.equal((await request(`/api/discoveries/${id}`, 'PUT', { version: 2, requestId: randomUUID(), explanation: 'curta' })).status, 400);
    const reflected = await request(`/api/discoveries/${id}/reflections`, 'POST', { id: randomUUID(), text: 'Agora penso diferente.' });
    assert.equal(reflected.body.reflections.length, 2);

    // A second discovery in another subject, connected → stamp.connection.
    const history = await addConfirmedLesson(db, identities.a.id, { title: 'Revolução Industrial', subject: 'História', segments: ['O carvão movia as máquinas.'] });
    const other = randomUUID();
    await request(`/api/investigations/${other}`, 'PUT', { version: 0, requestId: randomUUID(), body: { materialId: history.materialId, sourceRevisionId: history.revisionId, question: 'De onde vinha a energia das fábricas?' } });
    await request(`/api/investigations/${other}/evidence`, 'POST', { id: randomUUID(), segmentPosition: 0, startOffset: 2, endOffset: 8, quote: 'carvão' });
    await request(`/api/investigations/${other}`, 'PUT', { version: 1, requestId: randomUUID(), body: { explanation: 'O carvão guardava energia química que virava trabalho.' } });
    assert.equal((await request(`/api/investigations/${other}/complete`, 'POST', { requestId: randomUUID() })).status, 200);
    const connected = await request(`/api/discoveries/${other}/connections`, 'POST', { id: randomUUID(), otherId: id, note: 'Energia nas duas aulas' });
    assert.equal(connected.status, 200, JSON.stringify(connected.body));
    assert.deepEqual(connected.body.newUnlocks.map((u) => u.id), ['stamp.connection']);
    assert.equal(connected.body.connections[0].acrossSubjects, true);
    const list = await request('/api/discoveries');
    assert.deepEqual(list.body.map((d) => d.id).sort(), [id, other].sort());
    assert.deepEqual((await request('/api/discoveries', 'GET', null, 'b')).body, []);

    // Gabinete and desk.
    const collection = await request('/api/collection');
    assert.equal(collection.status, 200);
    assert(collection.body.catalog.some((item) => item.id === 'object.desk-lamp'));
    assert.deepEqual(collection.body.unlocks.map((u) => u.id).sort(), [
      'stamp.connection', 'stamp.first-evidence', 'stamp.first-investigation', 'stamp.first-reflection', 'stamp.own-explanation',
    ]);
    assert(collection.body.unlocks.every((u) => u.lessonTitle && u.occurredAt && u.event));
    const locked = await request('/api/collection/layout', 'PUT', { version: 0, requestId: randomUUID(), items: [{ slot: 'desk-left', objectId: 'object.desk-lamp' }] });
    assert.equal(locked.status, 409);
    assert.equal(locked.body.error.code, 'COLLECTION_NOT_UNLOCKED');
    assert.equal((await request('/api/collection/layout', 'PUT', { version: 0, requestId: randomUUID(), items: [{ slot: 'desk-left', objectId: 'stamp.connection' }] })).status, 400);
    const empty = await request('/api/collection/layout', 'PUT', { version: 0, requestId: randomUUID(), items: [] });
    assert.equal(empty.status, 200);
    assert.equal(empty.body.layout.version, 1);
    assert.deepEqual((await request('/api/collection', 'GET', null, 'b')).body.unlocks, []);
    // No route grants a collectible.
    assert.equal((await request('/api/collection/unlocks', 'POST', { id: 'object.desk-lamp' })).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = nativeFetch;
  }
});
