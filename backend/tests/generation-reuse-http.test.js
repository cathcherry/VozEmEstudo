import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';
import { revisionIds } from './fixtures/academic-db.fixture.js';

const migration = readFileSync(new URL('../../database/migrations/20261121160000_generation_reuse.sql', import.meta.url), 'utf8');

test('generation reuse over HTTP: concurrent requests share one job, reuse on request, budget, honest retry', async (t) => {
  const f = createSupabaseHttpFixture();
  const nativeFetch = globalThis.fetch;
  Object.assign(process.env, {
    SUPABASE_URL: f.origin,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_reuse_fixture',
    SUPABASE_SECRET_KEY: 'reuse-fixture-server-key',
    FEATURE_GENERATION_REUSE: 'true',
    AI_DAILY_GENERATION_LIMIT: '3',
    MOCK_EXTERNAL_SERVICES: 'true',
  });
  const { db } = await f.getDatabase();
  await db.exec(migration);
  f.state.tables.ai_generations = [];
  for (const name of Object.keys(f.state.tables)) f.state.tables[name] = (await db.query('select * from public.' + name)).rows;
  globalThis.fetch = f.fetch;
  const { app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = async (body, user = 'a', path = '/summaries') => {
    const res = await fetch(`${origin}/api/materials/${resourceIds.materialA}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identities[user].token}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const summary = (extra = {}) => ({ sourceRevisionId: revisionIds.a, idempotencyKey: randomUUID(), options: { length: 'detailed' }, ...extra });
  try {
    let first;
    await t.test('two simultaneous equivalent requests: one job, the second joins it', async () => {
      const [a, b] = await Promise.all([post(summary()), post(summary())]);
      assert.equal(a.status, 202, JSON.stringify(a.body));
      assert.equal(b.status, 202, JSON.stringify(b.body));
      assert.deepEqual([a.body.generation.decision, b.body.generation.decision].sort(), ['join', 'start']);
      first = a.body.generation.decision === 'start' ? a.body : b.body;
      const jobs = (await db.query("select id, params from public.processing_jobs where type='REGERAR_RESUMO'")).rows;
      assert.equal(jobs.length, 1, 'only one paid job queued');
      assert.equal(jobs[0].params.generationId, first.generation.id);
      const joined = a.body.generation.decision === 'join' ? a.body : b.body;
      assert.equal(joined.jobId, first.jobId);
    });
    await t.test('after the job finishes, reuse returns it without a new job; a fresh request starts one', async () => {
      await db.query("update public.processing_jobs set status='CONCLUIDA', completed_at=now() where id=$1", [first.jobId]);
      for (const name of ['processing_jobs']) f.state.tables[name] = (await db.query('select * from public.' + name)).rows;
      const reused = await post(summary({ reuse: true }));
      assert.equal(reused.status, 202, JSON.stringify(reused.body));
      assert.equal(reused.body.generation.decision, 'reuse');
      assert.equal(reused.body.jobId, first.jobId);
      const fresh = await post(summary());
      assert.equal(fresh.body.generation.decision, 'start');
      assert.notEqual(fresh.body.jobId, first.jobId);
    });
    await t.test('another account cannot reach A\'s generations; the daily budget is explained', async () => {
      const other = await post(summary(), 'b');
      assert.equal(other.status, 404);
      const third = await post(summary({ options: { length: 'short' } }));
      assert.equal(third.body.generation.decision, 'start');
      const over = await post(summary({ options: { length: 'standard' } }));
      assert.equal(over.status, 429);
      assert.match(over.body.error.message, /limite de 3 gerações/);
      assert.equal(over.body.error.code, 'GENERATION_BUDGET_EXCEEDED');
    });
  } finally {
    server.close();
    globalThis.fetch = nativeFetch;
  }
});
