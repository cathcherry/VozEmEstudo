import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { migrateLearningTools } from './fixtures/learning-db.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';
import {
  notesMigrationSql,
  addMultiSegmentRevision,
  multiRevisionId,
} from './fixtures/notes-db.fixture.js';

// Real SQL (PGlite) behind the HTTP adapter: routes, validation, ownership, versions and limits.
test('Notes 3.0 over HTTP: ranged highlights, private lesson notebook, versions, limits and isolation', async () => {
  const fixture = createSupabaseHttpFixture(),
    nativeFetch = globalThis.fetch;
  Object.assign(process.env, {
    SUPABASE_URL: fixture.origin,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_notes_fixture',
    SUPABASE_SECRET_KEY: 'notes-fixture-server-key',
    FEATURE_ANNOTATIONS: 'true',
    FEATURE_NOTEBOOKS: 'true',
    MOCK_EXTERNAL_SERVICES: 'true',
  });
  const { db } = await fixture.getDatabase();
  await migrateLearningTools(db);
  await db.exec(notesMigrationSql());
  await addMultiSegmentRevision(db, identities.a.id, resourceIds.materialA);
  for (const name of ['study_annotations', 'study_notebooks']) fixture.state.tables[name] = [];
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
  const notebookPath = `/api/notebooks/${A}`;
  const doc = (blocks) => ({ type: 'doc', schemaVersion: 1, blocks });
  try {
    assert.equal((await request(notebookPath, 'GET', null, null)).status, 401);
    const empty = await request(notebookPath);
    assert.equal(empty.status, 200);
    assert.equal(empty.body.notebook, null);
    assert.equal(empty.body.currentRevision, 2);
    assert.equal(empty.headers.get('cache-control'), 'no-store');

    // A comment across two segments.
    const highlight = {
      id: randomUUID(),
      requestId: randomUUID(),
      materialId: A,
      version: 0,
      body: {
        sourceRevisionId: multiRevisionId.toUpperCase(),
        segmentPosition: 0,
        startOffset: 8,
        endSegmentPosition: 1,
        endOffset: 13,
        quote: 'é conservada.\nUma afirmação',
        noteText: 'Liga as duas ideias',
      },
    };
    const saved = await request('/api/annotations', 'PUT', highlight);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.end_segment_position, 1);
    assert.equal(saved.body.anchor_version, 2);
    const wrong = await request('/api/annotations', 'PUT', {
      ...highlight,
      id: randomUUID(),
      requestId: randomUUID(),
      body: { ...highlight.body, quote: 'é conservada. Uma afirmação' },
    });
    assert.equal(wrong.status, 409);
    assert.equal(wrong.body.error.code, 'LEARNING_ANCHOR_CONFLICT');
    const backwards = await request('/api/annotations', 'PUT', {
      ...highlight,
      id: randomUUID(),
      requestId: randomUUID(),
      body: { ...highlight.body, segmentPosition: 1, endSegmentPosition: 0 },
    });
    assert.equal(backwards.status, 400, 'end before start is refused before the database');
    // The previous single-segment payload still works through the range function.
    const single = await request('/api/annotations', 'PUT', {
      id: randomUUID(),
      requestId: randomUUID(),
      materialId: A,
      version: 0,
      body: { sourceRevisionId: multiRevisionId, segmentPosition: 2, startOffset: 0, endOffset: 5, quote: 'Calor' },
    });
    assert.equal(single.status, 200);
    assert.equal(single.body.end_segment_position, 2);
    const listed = await request(`/api/annotations?materialId=${A}`);
    assert.equal(listed.body.notes.length, 2);
    assert.equal((await request(`/api/annotations?materialId=${A}`, 'GET', null, 'b')).body.notes.length, 0);

    const ref = {
      id: 'ref1',
      type: 'annotation_ref',
      annotationId: highlight.id,
      sourceRevisionId: multiRevisionId,
      sourceRevision: 2,
    };
    const first = {
      version: 0,
      requestId: randomUUID(),
      title: 'Caderno de Física',
      doc: doc([
        { id: 'h1', type: 'heading', level: 2, text: 'Conservação' },
        { id: 'p1', type: 'paragraph', text: 'Se a < b, então…' },
        { id: 'c1', type: 'checklist', items: [{ text: 'Rever o exemplo', checked: false }] },
        ref,
      ]),
    };
    const created = await request(notebookPath, 'PUT', first);
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.notebook.version, 1);
    assert.equal(created.body.notebook.visibility, 'private');
    assert.equal(created.body.references[0].quote, 'é conservada.\nUma afirmação');
    assert.equal(created.body.references[0].source_revision, 2);
    const replay = await request(notebookPath, 'PUT', first);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.notebook.version, 1);
    const stale = await request(notebookPath, 'PUT', { ...first, requestId: randomUUID() });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'LEARNING_VERSION_CONFLICT');
    assert.match(stale.body.error.message, /outro aparelho/);

    // Another account: neither read nor write, and no hint the notebook exists.
    assert.equal((await request(notebookPath, 'GET', null, 'b')).status, 404);
    assert.equal(
      (await request(notebookPath, 'PUT', { ...first, version: 1, requestId: randomUUID() }, 'b')).status,
      404,
    );
    const ownB = await request(`/api/notebooks/${resourceIds.materialB}`, 'PUT', {
      version: 0,
      requestId: randomUUID(),
      doc: doc([ref]),
    }, 'b');
    assert.equal(ownB.status, 409);
    assert.equal(ownB.body.error.code, 'LEARNING_REFERENCE_INVALID');

    for (const [label, blocks, status, code] of [
      ['script', [{ id: 'x', type: 'paragraph', text: '<script>alert(1)</script>' }], 400, 'NOTEBOOK_INVALID'],
      ['unknown type', [{ id: 'x', type: 'html', text: 'oi' }], 400, 'NOTEBOOK_INVALID'],
      ['extra field', [{ id: 'x', type: 'paragraph', text: 'oi', style: 'color:red' }], 400, 'NOTEBOOK_INVALID'],
      ['duplicate ids', [{ id: 'x', type: 'paragraph', text: '' }, { id: 'x', type: 'quote', text: '' }], 400, 'NOTEBOOK_INVALID'],
      ['too large', [{ id: 'x', type: 'paragraph', text: 'a'.repeat(5000) }].concat(Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, type: 'paragraph', text: 'b'.repeat(4900) }))), 413, 'NOTEBOOK_TOO_LARGE'],
    ]) {
      const res = await request(notebookPath, 'PUT', { version: 1, requestId: randomUUID(), doc: doc(blocks) });
      assert.equal(res.status, status, label);
      assert.equal(res.body.error.code, code, label);
    }
    assert.equal((await request('/api/notebooks/not-a-uuid')).status, 400);
    const updated = await request(notebookPath, 'PUT', {
      version: 1,
      requestId: randomUUID(),
      title: 'Caderno de Física',
      doc: doc([ref, { id: 'q1', type: 'quote', text: 'Citação livre' }]),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.notebook.version, 2);
    const again = await request(notebookPath);
    assert.deepEqual(again.body.notebook.doc.blocks.map((block) => block.type), ['annotation_ref', 'quote']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fixture.close();
    globalThis.fetch = nativeFetch;
  }
});
