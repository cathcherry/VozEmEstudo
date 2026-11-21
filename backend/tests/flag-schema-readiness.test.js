import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

// Flags on, schema absent: modern PostgREST answers PGRST205 for a missing table and PGRST202 for
// a missing function. Every flagged module must answer a scoped 503, never a generic 500, and
// unrelated routes keep working.
const origin = 'http://flags.fixture.invalid';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
Object.assign(process.env, {
  SUPABASE_URL: origin,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_flags_fixture',
  SUPABASE_SECRET_KEY: 'flags-fixture-server-key',
  FEATURE_CATALOG_UNITS: 'true',
  FEATURE_PLANNING: 'true',
  FEATURE_QUIZ_V2: 'true',
  FEATURE_FLASHCARDS: 'true',
  FEATURE_FLASHCARD_SETS: 'true',
  FEATURE_STUDY_TRACKING: 'true',
  FEATURE_ANNOTATIONS: 'true',
  FEATURE_CALENDAR: 'true',
  FEATURE_SHARING: 'true',
  FEATURE_CLASSROOMS: 'true',
  FEATURE_NOTEBOOKS: 'true',
  FEATURE_MULTI_LESSON: 'true',
});

test('flag enabled without its migration: scoped 503 per module, unrelated routes unaffected', async () => {
  const native = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.origin !== origin) return native(input, init);
    if (url.pathname === '/auth/v1/user')
      return Response.json({ id: USER, aud: 'authenticated', email: 'a@example.test' });
    if (url.pathname.startsWith('/rest/v1/rpc/'))
      return Response.json(
        { code: 'PGRST202', message: 'Could not find the function' },
        { status: 404 },
      );
    return Response.json(
      { code: 'PGRST205', message: 'Could not find the table in the schema cache' },
      { status: 404 },
    );
  };
  const { app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path) => {
    const res = await native(base + path, { headers: { Authorization: 'Bearer token-a' } });
    return { status: res.status, body: await res.json() };
  };
  try {
    for (const path of [
      '/api/catalog',
      '/api/planning',
      '/api/quiz-sessions',
      '/api/flashcards',
      '/api/flashcards/sets',
      '/api/study/overview',
      '/api/annotations',
      '/api/classrooms',
      '/api/notebooks/' + USER,
      '/api/multi-lesson',
      '/api/calendar?from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z&fromDay=2026-11-01&toDay=2026-11-30',
    ]) {
      const { status, body } = await get(path);
      assert.equal(status, 503, `${path} → ${status} ${body.error?.code}`);
      assert.match(body.error.code, /SCHEMA|REQUIRED/, path);
      assert.doesNotMatch(body.error.message, /PGRST|schema cache/i, 'no raw database text');
    }
    const health = await native(base + '/api/health');
    assert.equal(health.status, 200);
    const config = await (await native(base + '/api/config')).json();
    assert.equal(config.featureFlags.planning, true);
  } finally {
    server.close();
    globalThis.fetch = native;
  }
});
