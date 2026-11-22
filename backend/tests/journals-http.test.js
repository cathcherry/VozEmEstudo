import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';

// Real SQL (PGlite) behind the HTTP adapter: the Diário de estudo over the API — without the
// migration (scoped 503), then journal → pages → decorations → links, with validation, replays,
// conflicts, isolation between accounts and private caching headers.
const migration = readFileSync(new URL('../../database/migrations/20261124100000_journals.sql', import.meta.url), 'utf8');

test('Diário de estudo over HTTP: schema required, journals, pages, decorations and links; private', async () => {
  const fixture = createSupabaseHttpFixture(),
    nativeFetch = globalThis.fetch;
  Object.assign(process.env, {
    SUPABASE_URL: fixture.origin,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_journal_fixture',
    SUPABASE_SECRET_KEY: 'journal-fixture-server-key',
    FEATURE_JOURNAL: 'true',
    MOCK_EXTERNAL_SERVICES: 'true',
  });
  const { db } = await fixture.getDatabase();
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
  try {
    // Flag on, migration absent: a scoped 503, no raw database text.
    const missing = await request('/api/journals');
    assert.equal(missing.status, 503, JSON.stringify(missing.body));
    assert.equal(missing.body.error.code, 'JOURNAL_SCHEMA_REQUIRED');
    await db.exec(migration);

    assert.equal((await request('/api/journals', 'GET', null, null)).status, 401);
    const empty = await request('/api/journals');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.journals, []);
    assert.equal(empty.headers.get('cache-control'), 'no-store');
    assert.equal(empty.headers.get('x-robots-tag'), 'noindex, nofollow');

    // A journal.
    const id = randomUUID();
    const create = { version: 0, requestId: randomUUID(), body: { title: 'Diário de Biologia', cover: 'cover.botanical-press' } };
    const created = await request(`/api/journals/${id.toUpperCase()}`, 'PUT', create);
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.journal.id, id);
    assert.equal((await request(`/api/journals/${id}`, 'PUT', create)).body.replayed, true);
    for (const [label, body] of [
      ['no cover', { version: 0, requestId: randomUUID(), body: { title: 'x' } }],
      ['unknown field', { version: 0, requestId: randomUUID(), body: { title: 'x', cover: 'cover.kraft', theme: 'x' } }],
      ['html', { version: 0, requestId: randomUUID(), body: { title: '<i>x</i>', cover: 'cover.kraft' } }],
      ['bad cover', { version: 0, requestId: randomUUID(), body: { title: 'x', cover: '../cover' } }],
      ['empty patch', { version: 1, requestId: randomUUID(), body: {} }],
    ])
      assert.equal((await request(`/api/journals/${randomUUID()}`, 'PUT', body)).status, 400, label);
    assert.equal((await request('/api/journals/not-a-uuid')).status, 400);
    const recovered = await request(`/api/journals/${id}`, 'PUT', { version: 1, requestId: randomUUID(), body: { cover: 'cover.constellation' } });
    assert.equal(recovered.body.journal.cover, 'cover.constellation');
    const stale = await request(`/api/journals/${id}`, 'PUT', { version: 1, requestId: randomUUID(), body: { title: 'Velho' } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'JOURNAL_VERSION_CONFLICT');

    // Pages: a ruled page with a quote that keeps its source; decorations by direct manipulation.
    const options = await request('/api/journals/link-options');
    assert.deepEqual(options.body.lessons.map((l) => l.id), [A]);
    const page = randomUUID();
    const first = await request(`/api/journals/${id}/pages/${page}`, 'PUT', {
      version: 0,
      requestId: randomUUID(),
      body: { template: 'ruled', title: 'Energia', content: { body: 'Hoje entendi a conservação.' } },
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.page.version, 1);
    const unsourced = await request(`/api/journals/${id}/pages/${page}`, 'PUT', {
      version: 1,
      requestId: randomUUID(),
      body: { template: 'ruled', content: { body: '', quote: { text: 'Energia é conservada.', source: null } } },
    });
    assert.equal(unsourced.status, 409);
    assert.equal(unsourced.body.error.code, 'JOURNAL_QUOTE_SOURCE_REQUIRED');
    const content = { body: 'Hoje entendi a conservação.', quote: { text: 'Energia é conservada.', source: { kind: 'lesson', id: A } } };
    const decorations = [
      { id: 'tape-1', art: 'tape.lavender-dots', x: 18, y: 4, rotation: -6, scale: 1 },
      { id: 'moon-1', art: 'sticker.moon', x: 82.5, y: 88, rotation: 8, scale: 1.2 },
      { id: 'frame-1', art: 'frame.polaroid', x: 60, y: 40, rotation: 2, scale: 1 },
    ];
    const decorated = await request(`/api/journals/${id}/pages/${page}`, 'PUT', {
      version: 1,
      requestId: randomUUID(),
      body: { template: 'ruled', content, links: [{ kind: 'lesson', id: A }], decorations, paper: 'aged' },
    });
    assert.equal(decorated.status, 200, JSON.stringify(decorated.body));
    assert.deepEqual(decorated.body.page.decorations.map((d) => d.art), decorations.map((d) => d.art));
    for (const [label, body, status] of [
      ['template of another layout', { template: 'timeline', content }, 400],
      ['decoration outside the allowlist', { decorations: [{ ...decorations[0], art: 'object.globe' }] }, 400],
      ['decoration off the page', { decorations: [{ ...decorations[0], x: 140 }] }, 400],
      ['too many decorations', { decorations: Array.from({ length: 25 }, (_, i) => ({ ...decorations[1], id: `s${i}` })) }, 400],
      ['locked stamp', { decorations: [{ ...decorations[1], art: 'stamp.first-evidence' }] }, 409],
      ['foreign lesson', { links: [{ kind: 'lesson', id: resourceIds.materialB }] }, 409],
      ['html in content', { template: 'ruled', content: { body: '<img src=x onerror=alert(1)>' } }, 400],
      ['content without template', { content: { body: 'x' } }, 400],
    ]) {
      const result = await request(`/api/journals/${id}/pages/${page}`, 'PUT', { version: 2, requestId: randomUUID(), body });
      assert.equal(result.status, status, `${label}: ${JSON.stringify(result.body)}`);
    }
    const reread = await request(`/api/journals/${id}`);
    assert.equal(reread.body.pages[0].paper, 'aged');
    assert.equal(reread.body.pages[0].content.quote.source.id, A);
    assert.deepEqual(reread.body.linkTargets.map((t) => t.title), ['Aula sintética a']);

    // Another account sees and changes nothing.
    assert.equal((await request(`/api/journals/${id}`, 'GET', null, 'b')).status, 404);
    assert.deepEqual((await request('/api/journals', 'GET', null, 'b')).body.journals, []);
    const intrusion = await request(`/api/journals/${id}/pages/${page}`, 'PUT', { version: 2, requestId: randomUUID(), body: { title: 'x' } }, 'b');
    assert.equal(intrusion.status, 404);
    assert.equal((await request('/api/journals/link-options', 'GET', null, 'b')).body.lessons[0].id, resourceIds.materialB);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = nativeFetch;
  }
});
