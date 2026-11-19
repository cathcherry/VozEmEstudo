import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';

const fixture = createSupabaseHttpFixture();
// Configuration is read when modules load, so it is set before importing the service and app.
Object.assign(process.env, {
  SUPABASE_URL: fixture.origin,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_search_fixture',
  SUPABASE_SECRET_KEY: 'search-fixture-server-key',
});
const { likePattern, snippet, validateSearch, fold, inChunks } =
  await import('../src/services/search.service.js');

test('search helpers: accent-insensitive pattern, escaped wildcards, bounded snippets', () => {
  assert.equal(likePattern('Ação'), '%____%');
  assert.equal(likePattern('acao'), '%____%');
  assert.equal(likePattern('50%_x\\'), '%50\\%\\_x\\\\%');
  assert.equal(likePattern('Brasil'), '%br_s_l%');
  assert.equal(fold('ÇÃO'), 'cao');
  const text = 'a'.repeat(200) + ' fotossíntese ' + 'b'.repeat(200);
  const cut = snippet(text, 'FOTOSSINTESE');
  assert(cut.startsWith('…') && cut.endsWith('…') && cut.includes('fotossíntese'));
  assert(cut.length < 170);
  assert.throws(() => validateSearch({ q: 'a' }));
  assert.throws(() => validateSearch({ q: 'x'.repeat(101) }));
  assert.throws(() => validateSearch({ q: 'ok', scope: 'everything' }));
  assert.deepEqual(validateSearch({ q: ' energia ' }), { q: 'energia', scope: 'all' });
});

test('GET /api/search finds own lessons, questions and transcripts only', async () => {
  const nativeFetch = globalThis.fetch;
  const { db } = await fixture.getDatabase();
  // Mirror the database once: both accounts have the same transcript text.
  for (const name of Object.keys(fixture.state.tables))
    fixture.state.tables[name] = (await db.query('select * from public.' + name)).rows;
  globalThis.fetch = fixture.fetch;
  const { app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const search = async (query, user = 'a') => {
    const res = await fetch(`${origin}/api/search?${new URLSearchParams(query)}`, {
      headers: user ? { Authorization: `Bearer ${identities[user].token}` } : {},
    });
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  try {
    assert.equal((await search({ q: 'energia' }, null)).status, 401);
    assert.equal((await search({ q: 'e' })).status, 400);
    const all = await search({ q: 'ENERGIA' });
    assert.equal(all.status, 200);
    assert.equal(all.headers.get('cache-control'), 'no-store');
    assert.equal(
      all.body.transcripts.length,
      1,
      'only the own lesson, although B has the same text',
    );
    assert.equal(all.body.transcripts[0].materialId, resourceIds.materialA);
    assert.deepEqual(all.body.transcripts[0].hits[0], {
      position: 0,
      startMs: 0,
      endMs: 3000,
      snippet: 'Energia é conservada. Uma afirmação citada pode ser refutada.',
    });
    // Accent-insensitive: "afirmacao" finds "afirmação".
    assert.equal(
      (await search({ q: 'afirmacao', scope: 'transcripts' })).body.transcripts.length,
      1,
    );
    const questions = await search({ q: 'sintetica', scope: 'questions' });
    assert.equal(questions.body.questions.length, 1);
    assert.equal(questions.body.questions[0].batchId, resourceIds.batchA);
    assert.deepEqual(Object.keys(questions.body.questions[0]).sort(), [
      'batchId',
      'lessonTitle',
      'materialId',
      'number',
      'questionId',
      'statement',
    ]);
    assert.deepEqual(questions.body.lessons, []);
    assert.deepEqual(questions.body.transcripts, []);
    const lessons = await search({ q: 'aula sintetica' });
    assert.deepEqual(
      lessons.body.lessons.map((l) => l.materialId),
      [resourceIds.materialA],
    );
    const other = await search({ q: 'aula sintetica' }, 'b');
    assert.deepEqual(
      other.body.lessons.map((l) => l.materialId),
      [resourceIds.materialB],
    );
    const none = await search({ q: 'inexistente' });
    assert.deepEqual([none.body.lessons, none.body.questions, none.body.transcripts], [[], [], []]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fixture.close();
    globalThis.fetch = nativeFetch;
  }
});

test('large libraries query ids in chunks of 100 and stop on errors', async () => {
  const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
  const seen = [];
  const rows = await inChunks(ids, async (chunk) => {
    seen.push(chunk.length);
    return { data: chunk.map((id) => ({ id })) };
  });
  assert.deepEqual(seen, [100, 100, 50]);
  assert.equal(rows.length, 250);
  assert.deepEqual(await inChunks([], async () => assert.fail('no request for an empty list')), []);
  await assert.rejects(
    inChunks(ids, async () => ({ error: new Error('boom') })),
    /boom/,
  );
});
