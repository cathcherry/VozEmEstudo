import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';
import { revisionIds } from './fixtures/academic-db.fixture.js';
import { migrateStudyAuthoring } from './fixtures/authoring-db.fixture.js';

// The public testing program over HTTP, with the real SQL rules (PGlite) behind the RPCs: fail
// closed without the schema, roles from the server only, cumulative generation quotas that a
// replayed request cannot inflate, the transcription pre-check, admin-only overview and the shared
// demo lessons with one private copy per account.
const migration = readFileSync(new URL('../../database/migrations/20261125100000_public_testing.sql', import.meta.url), 'utf8');

test('public testing over HTTP: quotas, roles, admin overview and demo lessons', async () => {
  const fixture = createSupabaseHttpFixture(),
    nativeFetch = globalThis.fetch;
  Object.assign(process.env, {
    SUPABASE_URL: fixture.origin,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testing_fixture',
    SUPABASE_SECRET_KEY: 'testing-fixture-server-key',
    FEATURE_PUBLIC_TESTING: 'true',
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
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  const a = identities.a.id;
  const b = identities.b.id;
  try {
    // Flag on, schema missing: fail closed (nothing expensive can start unaccounted).
    const missing = await request('/api/testing/me');
    assert.equal(missing.status, 503, JSON.stringify(missing.body));
    assert.equal(missing.body.error.code, 'PUBLIC_TESTING_SCHEMA_REQUIRED');
    const blockedSummary = await request(`/api/materials/${resourceIds.materialA}/summaries`, 'POST', {
      sourceRevisionId: revisionIds.a,
      idempotencyKey: randomUUID(),
    });
    assert.equal(blockedSummary.status, 503, 'no generation without the quota schema');

    await migrateStudyAuthoring(db);
    await db.exec('alter table auth.users add column created_at timestamptz not null default now()');
    await db.exec(migration);
    await db.exec("update public.public_testing_config set enabled = true, registration_starts_at = null, apply_to_existing_accounts = true where id = 1");
    await db.query("insert into public.app_admins(user_id, granted_by) values ($1, 'test setup')", [b]);

    assert.equal((await request('/api/testing/me', 'GET', null, null)).status, 401);
    const me = await request('/api/testing/me');
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(me.body.policy, 'tester');
    assert.equal(me.body.admin, false);
    assert.equal(Number(me.body.limits.transcription_seconds), 300);
    const admin = await request('/api/testing/me', 'GET', null, 'b');
    assert.equal(admin.body.policy, 'admin');
    assert.equal(Number(admin.body.limits.transcription_seconds), 7200);

    // Admin overview: 404 for a participant, figures (no identities) for the admin.
    assert.equal((await request('/api/testing/overview')).status, 404);
    const overview = await request('/api/testing/overview', 'GET', null, 'b');
    assert.equal(overview.status, 200);
    assert.equal(overview.body.config.enabled, true);
    assert.equal(JSON.stringify(overview.body).includes(a), false, 'no user ids in the overview');

    // Summaries: two new generations; a replay of the same request never counts again.
    const key1 = randomUUID();
    const first = await request(`/api/materials/${resourceIds.materialA}/summaries`, 'POST', { sourceRevisionId: revisionIds.a, idempotencyKey: key1 });
    assert.equal(first.status, 202, JSON.stringify(first.body));
    const replay = await request(`/api/materials/${resourceIds.materialA}/summaries`, 'POST', { sourceRevisionId: revisionIds.a, idempotencyKey: key1 });
    assert.equal(replay.status, 202);
    assert.equal(replay.body.jobId, first.body.jobId, 'same job');
    const second = await request(`/api/materials/${resourceIds.materialA}/summaries`, 'POST', { sourceRevisionId: revisionIds.a, idempotencyKey: randomUUID() });
    assert.equal(second.status, 202);
    const third = await request(`/api/materials/${resourceIds.materialA}/summaries`, 'POST', { sourceRevisionId: revisionIds.a, idempotencyKey: randomUUID() });
    assert.equal(third.status, 403, JSON.stringify(third.body));
    assert.equal(third.body.error.code, 'GENERATION_QUOTA_EXCEEDED');
    assert.match(third.body.error.message, /continua disponível/);
    const used = await request('/api/testing/me');
    assert.equal(Number(used.body.used.summary), 2);
    // Another account is unaffected; changing parameters does not reset the count.
    assert.equal((await request(`/api/materials/${resourceIds.materialB}/summaries`, 'POST', { sourceRevisionId: revisionIds.b, idempotencyKey: randomUUID() }, 'b')).status, 202);
    const changed = await request(`/api/materials/${resourceIds.materialA}/summaries`, 'POST', {
      sourceRevisionId: revisionIds.a, idempotencyKey: randomUUID(), options: { format: 'topics' },
    });
    assert.notEqual(changed.status, 202, 'different options are still a new generation');

    // Transcription pre-check: an exhausted allowance is refused before anything is queued.
    await db.transaction(async (tx) => {
      await tx.exec('set local role service_role');
      await tx.query("select public.testing_reserve_admin($1, 'transcription_seconds', 'initial:other', 300, null)", [a]);
    });
    const process = await request(`/api/materials/${resourceIds.materialA}/process`, 'POST', {});
    assert.equal(process.status, 403, JSON.stringify(process.body));
    assert.equal(process.body.error.code, 'TRANSCRIPTION_QUOTA_EXCEEDED');
    assert.match(process.body.error.message, /aulas de demonstração/);

    // Demo lessons: listed for both, one private copy each, idempotent; unknown id → 404.
    const demoId = randomUUID();
    await db.query(
      `insert into public.demo_lessons(id, slug, title, subject, duration_ms, audio_storage_path, audio_mime, audio_size_bytes, content, published)
       values ($1, 'crase', 'Crase', 'Português', 9000, 'demo/crase/audio.mp3', 'audio/mpeg', 1000, $2, true)`,
      [demoId, JSON.stringify({
        segments: [{ position: 0, startMs: 0, endMs: 4000, text: 'A crase é a fusão da preposição a com o artigo a.' }],
        summary: { label: 'Resumo da aula', text: '## Crase' },
        questions: { title: 'Questões', items: [{ statement: 'O que é crase?', options: ['a + a', 'b', 'c', 'd'], correctIndex: 0, explanation: 'Fusão.' }] },
        flashcards: { name: 'Cartões', cards: [{ front: 'Crase', back: 'a + a' }] },
      })],
    );
    const list = await request('/api/demo-lessons');
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].questionCount, 1);
    const opened = await request(`/api/demo-lessons/${demoId}/open`, 'POST');
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.body.created, true);
    const reopened = await request(`/api/demo-lessons/${demoId}/open`, 'POST');
    assert.equal(reopened.body.materialId, opened.body.materialId);
    const other = await request(`/api/demo-lessons/${demoId}/open`, 'POST', null, 'b');
    assert.notEqual(other.body.materialId, opened.body.materialId);
    assert.equal((await request(`/api/demo-lessons/${randomUUID()}/open`, 'POST')).status, 404);
    assert.equal((await request('/api/demo-lessons/not-a-uuid/open', 'POST')).status, 400);
    // Opening demos costs nothing: no new usage was recorded.
    const after = await request('/api/testing/me');
    assert.equal(Number(after.body.used.summary), 2);
    assert.equal(Number(after.body.used.transcription_seconds), 300);
    // Canonical demo media: only audio.mp3 / video.mp4 of a lesson folder, with Range for seeking.
    const audio = await nativeFetch(`${origin}/demo-media/crase/audio.mp3`, { headers: { Range: 'bytes=0-99' } });
    assert.equal(audio.status, 206);
    assert.equal(audio.headers.get('content-type'), 'audio/mpeg');
    assert.equal((await audio.arrayBuffer()).byteLength, 100);
    for (const path of ['/demo-media/crase/lesson.json', '/demo-media/crase/script.json', '/demo-media/../backend/.env', '/demo-media/%2e%2e/%2e%2e/backend/package.json', '/demo-media/crase%2f..%2f..%2fpackage.json', '/demo-media/nao-existe/audio.mp3'])
      assert.equal((await nativeFetch(origin + path)).status, 404, path);
    const ledgerKinds = (await db.query('select distinct kind from public.usage_ledger where user_id = $1', [a])).rows.map((r) => r.kind).sort();
    assert.deepEqual(ledgerKinds, ['summary', 'transcription_seconds']);
  } finally {
    server.close();
    globalThis.fetch = nativeFetch;
  }
});
