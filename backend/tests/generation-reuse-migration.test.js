import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAcademicDatabase, revisionIds } from './fixtures/academic-db.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';
import { generationKey } from '../src/domain/generation-key.js';
import { createHash, randomUUID } from 'node:crypto';
import { migrateClassrooms } from './fixtures/classroom-db.fixture.js';

const migration = readFileSync(
  new URL('../../database/migrations/20261121160000_generation_reuse.sql', import.meta.url),
  'utf8',
);

test('generation reuse migration is guarded, additive and server-only', () => {
  assert.match(migration, /GENERATION_REUSE_ABORT/);
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.doesNotMatch(migration, /\b(drop table|drop column|drop function|truncate|create or replace|delete from)\b/i);
  assert.match(migration, /alter table public\.ai_generations enable row level security/);
});

async function prepared() {
  const f = await createAcademicDatabase();
  // Deployment order: classrooms (14:00) before generation reuse (16:00).
  await migrateClassrooms(f);
  await f.db.exec(migration);
  const a = identities.a.id;
  await f.permit(identities.a, resourceIds.materialA);
  await f.confirm(identities.a, resourceIds.materialA, revisionIds.a);
  const key = (settings = {}, promptVersion = 'questions-v2.2') =>
    generationKey({ scope: `user:${a}`, sources: [revisionIds.a], kind: 'questions', settings, promptVersion, modelFamily: 'groq' });
  const begin = (k, { user = a, allowReuse = false, limit = 30, sources = [revisionIds.a], scope = ['user', user] } = {}) =>
    f.call('begin_generation_admin', [user, k, scope[0], scope[1], 'questions', sources, 'questions-v2.2', 'groq', resourceIds.materialA, allowReuse, limit]);
  const job = async (status = 'EM_EXECUCAO') =>
    (await f.db.query("insert into public.processing_jobs(material_id,type,status) values($1,'PROCESSAMENTO_INICIAL',$2) returning id", [resourceIds.materialA, status])).rows[0].id;
  return { ...f, a, b: identities.b.id, key, begin, job };
}

test('single flight: an equivalent request joins the running job instead of paying twice', async () => {
  const f = await prepared();
  try {
    const k = f.key({ count: 5 });
    const [first, second] = await Promise.all([f.begin(k), f.begin(k)]);
    const decisions = [first.decision, second.decision].sort();
    assert.deepEqual(decisions, ['join', 'start']);
    const started = first.decision === 'start' ? first : second;
    const jobId = await f.job();
    await f.call('attach_generation_job_admin', [started.generation.id, jobId]);
    const joined = await f.begin(k);
    assert.equal(joined.decision, 'join');
    assert.equal(joined.generation.job_id, jobId);
    // Different content settings or prompt version = a different key (version-aware).
    assert.equal((await f.begin(f.key({ count: 10 }))).decision, 'start');
    assert.equal((await f.begin(f.key({ count: 5 }, 'questions-v2.3'))).decision, 'start');
  } finally {
    await f.db.close();
  }
});

test('reuse only when allowed; a fresh request supersedes; failures free the key; budget counts starts only', async () => {
  const f = await prepared();
  try {
    const k = f.key({ count: 3 });
    const started = await f.begin(k, { limit: 2 });
    await f.call('attach_generation_job_admin', [started.generation.id, await f.job()]);
    await f.call('complete_generation_admin', [started.generation.id, JSON.stringify({ batchId: 'b-1' })]);
    const reused = await f.begin(k, { allowReuse: true, limit: 2 });
    assert.equal(reused.decision, 'reuse');
    assert.deepEqual(reused.generation.result, { batchId: 'b-1' });
    assert.equal(reused.generation.reuse_count, 1);
    // "Gerar outra" (no reuse): the old result is kept as superseded, a new one starts.
    const fresh = await f.begin(k, { limit: 2 });
    assert.equal(fresh.decision, 'start');
    const old = (await f.db.query('select status from public.ai_generations where id=$1', [started.generation.id])).rows[0];
    assert.equal(old.status, 'superseded');
    // Budget: two starts today (the superseded one counts: it was paid; reuse never counts).
    await assert.rejects(f.begin(f.key({ count: 20 }), { limit: 1 }), /GENERATION_BUDGET_EXCEEDED/);
    // A failure frees the key: the next request starts again honestly.
    await f.call('fail_generation_admin', [fresh.generation.id, 'PROVIDER_TIMEOUT']);
    assert.equal((await f.begin(k, { limit: 5 })).decision, 'start');
  } finally {
    await f.db.close();
  }
});

test('a job that ended without bookkeeping is reconciled; sources and scopes are authorised', async () => {
  const f = await prepared();
  try {
    const k = f.key({ count: 5 });
    const started = await f.begin(k);
    const jobId = await f.job();
    await f.call('attach_generation_job_admin', [started.generation.id, jobId]);
    await f.db.query("update public.processing_jobs set status='FALHOU', error_code='PROVIDER_DOWN' where id=$1", [jobId]);
    const retried = await f.begin(k);
    assert.equal(retried.decision, 'start', 'the failed job no longer blocks the key');
    const failed = (await f.db.query('select status, error_code from public.ai_generations where id=$1', [started.generation.id])).rows[0];
    assert.deepEqual(failed, { status: 'failed', error_code: 'PROVIDER_DOWN' });
    const done = await f.job('CONCLUIDA');
    await f.call('attach_generation_job_admin', [retried.generation.id, done]);
    const reconciled = await f.begin(k, { allowReuse: true });
    assert.equal(reconciled.decision, 'reuse');
    assert.deepEqual(reconciled.generation.result, { jobId: done });
    // Another account cannot use A's revision as a source, nor act in A's scope.
    await assert.rejects(f.begin(f.key({ count: 7 }), { user: f.b }), /GENERATION_SOURCE_FORBIDDEN/);
    await assert.rejects(f.begin(f.key({ count: 7 }), { scope: ['user', f.b] }), /GENERATION_SCOPE_FORBIDDEN/);
    await assert.rejects(f.begin(f.key({ count: 7 }), { scope: ['classroom', randomUUID()] }), /GENERATION_SCOPE_FORBIDDEN/);
    // An unconfirmed revision cannot be a source.
    await f.db.query('delete from public.transcription_confirmations where user_id=$1', [f.a]);
    await assert.rejects(f.begin(f.key({ count: 8 })), /GENERATION_SOURCE_FORBIDDEN/);
    // Browsers have no access.
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query('select * from public.ai_generations');
      }),
      /permission denied/,
    );
  } finally {
    await f.db.close();
  }
});

test('class scope: members reuse a generation of a published lesson; only staff start one; outsiders and unpublished sources refused', async () => {
  const f = await prepared();
  try {
    const sha = (text) => createHash('sha256').update(text).digest('hex');
    const classId = randomUUID();
    await f.call('classroom_create_admin', [f.a, classId, 'Física 2B', '', 'Prof. A']);
    await f.call('classroom_create_invite_admin', [f.a, classId, randomUUID(), randomUUID(), sha('CONVITE-2B'), 7, 10]);
    await f.call('classroom_join_admin', [f.b, sha('CONVITE-2B'), 'Aluna B']);
    const key = generationKey({ scope: `classroom:${classId}`, sources: [revisionIds.a], kind: 'summary', settings: { length: 'short' }, promptVersion: 'summary-v3', modelFamily: 'groq' });
    const begin = (user) =>
      f.call('begin_generation_admin', [user, key, 'classroom', classId, 'summary', [revisionIds.a], 'summary-v3', 'groq', resourceIds.materialA, false, 30]);
    // The revision is not published in this class yet.
    await assert.rejects(begin(f.a), /GENERATION_SOURCE_FORBIDDEN/);
    await f.call('classroom_publish_lesson_admin', [f.a, classId, randomUUID(), JSON.stringify({ materialId: resourceIds.materialA, revisionId: revisionIds.a })]);
    // A student cannot spend the class budget on a new generation.
    await assert.rejects(begin(f.b), /GENERATION_CLASSROOM_STAFF_ONLY/);
    const started = await begin(f.a);
    assert.equal(started.decision, 'start');
    assert.equal((await begin(f.b)).decision, 'join', 'a member follows the running generation');
    await f.call('complete_generation_admin', [started.generation.id, JSON.stringify({ summaryId: 's-1' })]);
    const reused = await begin(f.b);
    assert.equal(reused.decision, 'reuse', 'members always reuse the class result');
    assert.deepEqual(reused.generation.result, { summaryId: 's-1' });
    // Someone outside the class cannot use it.
    await assert.rejects(begin(identities.e.id), /GENERATION_SCOPE_FORBIDDEN/);
    // A member who left loses access.
    await f.call('classroom_leave_admin', [f.b, classId]);
    await assert.rejects(begin(f.b), /GENERATION_SCOPE_FORBIDDEN/);
  } finally {
    await f.db.close();
  }
});
