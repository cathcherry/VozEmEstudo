import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAcademicDatabase } from './fixtures/academic-db.fixture.js';
import { migrateClassrooms } from './fixtures/classroom-db.fixture.js';
import {
  addLesson,
  addSubject,
  createMultiLessonDatabase,
  editLesson,
  identities,
  readKnowledgeMapMigration,
  readMultiLessonMigration,
} from './fixtures/multi-lesson-db.fixture.js';
import { generationKey } from '../src/domain/generation-key.js';

const migration = readMultiLessonMigration();
const cacheMigration = readKnowledgeMapMigration();
const a = identities.a;
const b = identities.b;

const SEG = (topic) => [
  `A ${topic} começa quando observamos o fenômeno com bastante atenção.`,
  `Na ${topic} as variáveis principais mudam de forma previsível ao longo do tempo.`,
];

test('both migrations are guarded, additive, transactional and server-only', () => {
  for (const [sql, tag] of [
    [migration, 'MULTI_LESSON_ABORT'],
    [cacheMigration, 'KNOWLEDGE_MAP_ABORT'],
  ]) {
    assert.match(sql, new RegExp(tag));
    assert.match(sql, /^begin;/m);
    assert.match(sql, /^commit;/m);
    assert.doesNotMatch(
      sql,
      /\b(drop table|drop column|drop function|truncate|create or replace|delete from public\.(materials|transcription|ai_generations))\b/i,
    );
    assert.doesNotMatch(sql, /security definer/i);
    assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/i);
  }
  assert.match(migration, /alter table public\.multi_lesson_materials enable row level security/);
  assert.match(migration, /alter table public\.multi_lesson_jobs enable row level security/);
  assert.match(cacheMigration, /alter table public\.knowledge_maps enable row level security/);
  // The cache is an optional layer: the main migration never mentions it.
  assert.doesNotMatch(migration, /public\.knowledge_map/);
});

test('preflight guards: refuses without generation reuse, refuses to run twice', async () => {
  const f = await createAcademicDatabase();
  try {
    await migrateClassrooms(f);
    await assert.rejects(f.db.exec(migration), /MULTI_LESSON_ABORT: aplicar/);
    await f.db.exec('rollback');
    assert.equal(
      (await f.db.query("select to_regclass('public.multi_lesson_materials') as t")).rows[0].t,
      null,
      'nothing was created by the refused run',
    );
  } finally {
    await f.db.close();
  }
  const g = await createMultiLessonDatabase();
  try {
    await assert.rejects(g.db.exec(migration), /MULTI_LESSON_ABORT: estruturas/);
    await g.db.exec('rollback');
    await assert.rejects(g.db.exec(cacheMigration), /KNOWLEDGE_MAP_ABORT: knowledge_maps/);
    await g.db.exec('rollback');
  } finally {
    await g.db.close();
  }
});

test('read-only preflight and postflight checks report what the docs promise', async () => {
  const check = (name) =>
    readFileSync(new URL(`../../database/checks/multi-lesson-${name}.sql`, import.meta.url), 'utf8');
  const f = await createAcademicDatabase();
  try {
    await migrateClassrooms(f);
    await f.db.exec(readFileSync(new URL('../../database/migrations/20261121160000_generation_reuse.sql', import.meta.url), 'utf8'));
    const pre = (await f.db.query(check('preflight'))).rows[0];
    assert.equal(pre.prerequisites, true);
    assert.equal(pre.already_applied, false);
    assert.equal(pre.cache_already_applied, false);
    await f.db.exec(migration);
    let post = (await f.db.query(check('postflight'))).rows[0];
    assert.equal(Number(post.generations_after), Number(pre.generations_before));
    assert.equal(Number(post.confirmations_after), Number(pre.confirmations_before));
    for (const key of ['rls_enabled', 'no_browser_access', 'functions_server_only', 'snapshot_frozen'])
      assert.equal(post[key], true, key);
    assert.equal(post.cache_applied, false, 'the cache is optional');
    await f.db.exec(cacheMigration);
    post = (await f.db.query(check('postflight'))).rows[0];
    assert.equal(post.cache_applied, true);
    assert.equal(post.cache_rls_enabled, true);
    assert.equal((await f.db.query(check('preflight'))).rows[0].already_applied, true);
  } finally {
    await f.db.close();
  }
});

async function library() {
  const f = await createMultiLessonDatabase();
  const physics = await addSubject(f, a, 'Física Moderna', ['Ondas', 'Óptica']);
  const [waves, optics] = physics.unitIds;
  const l1 = await addLesson(f, a, { title: 'Ondas 1', segments: SEG('onda'), subjectId: physics.subjectId, unitId: waves });
  const l2 = await addLesson(f, a, { title: 'Ondas 2', segments: SEG('frequência'), subjectId: physics.subjectId, unitId: waves });
  const l3 = await addLesson(f, a, { title: 'Ondas 3 (não conferida)', segments: SEG('amplitude'), subjectId: physics.subjectId, unitId: waves, confirm: false });
  const l4 = await addLesson(f, a, { title: 'Luz', segments: SEG('refração'), subjectId: physics.subjectId, unitId: optics });
  const l5 = await addLesson(f, a, { title: 'Sem transcrição', subjectId: physics.subjectId, unitId: optics, transcribe: false });
  const l6 = await addLesson(f, a, { title: 'Avulsa', segments: SEG('energia'), subjectId: physics.subjectId });
  const other = await addSubject(f, b, 'Química Orgânica', ['Ligações']);
  const foreign = await addLesson(f, b, { title: 'Aula de B', segments: SEG('ligação'), subjectId: other.subjectId, unitId: other.unitIds[0] });
  const resolve = (kind, ids, user = a) => f.call('multi_lesson_resolve_admin', [user.id, kind, ids]);
  return { ...f, physics, waves, optics, other, l1, l2, l3, l4, l5, l6, foreign, resolve };
}

test('source resolution: lessons, unit, units and subject; confirmed only; other accounts invisible', async () => {
  const f = await library();
  try {
    const ids = (list) => list.map((item) => item.materialId);
    // Several lessons, in the chosen order; another account's lesson is only counted as missing.
    const lessons = await f.resolve('lessons', [f.l2.id, f.l1.id, f.l3.id, f.foreign.id, f.l2.id]);
    assert.deepEqual(ids(lessons.included), [f.l2.id, f.l1.id]);
    assert.deepEqual(lessons.excluded, [{ materialId: f.l3.id, title: f.l3.title, reason: 'unconfirmed' }]);
    assert.equal(lessons.missing, 1);
    assert.equal(lessons.included[0].revisionId, f.l2.revisionId);
    assert.equal(lessons.included[0].revision, 1);
    assert.equal(lessons.included[0].title, 'Ondas 2');
    assert.doesNotMatch(JSON.stringify(lessons), /Aula de B/);
    // A whole unit.
    const unit = await f.resolve('unit', [f.waves]);
    assert.deepEqual(ids(unit.included), [f.l1.id, f.l2.id]);
    assert.deepEqual(ids(unit.excluded), [f.l3.id]);
    // Several units: ordered by unit, with the reason for each excluded lesson.
    const units = await f.resolve('units', [f.optics, f.waves]);
    assert.deepEqual(ids(units.included), [f.l1.id, f.l2.id, f.l4.id]);
    assert.deepEqual(
      units.excluded.map((item) => [item.materialId, item.reason]),
      [
        [f.l3.id, 'unconfirmed'],
        [f.l5.id, 'not_transcribed'],
      ],
    );
    // The subject includes the lesson without a unit.
    const subject = await f.resolve('subject', [f.physics.subjectId]);
    assert.deepEqual(ids(subject.included).sort(), [f.l1.id, f.l2.id, f.l4.id, f.l6.id].sort());
    // Units and subjects of another account are "not found", in both directions.
    await assert.rejects(f.resolve('unit', [f.other.unitIds[0]]), /MULTI_LESSON_NOT_FOUND/);
    await assert.rejects(f.resolve('subject', [f.other.subjectId]), /MULTI_LESSON_NOT_FOUND/);
    await assert.rejects(f.resolve('subject', [f.physics.subjectId], b), /MULTI_LESSON_NOT_FOUND/);
    await assert.rejects(f.resolve('units', [f.waves, f.other.unitIds[0]]), /MULTI_LESSON_NOT_FOUND/);
    const bView = await f.resolve('lessons', [f.l1.id, f.foreign.id], b);
    assert.deepEqual(ids(bView.included), [f.foreign.id]);
    assert.equal(bView.missing, 1);
    // Malformed selections.
    await assert.rejects(f.resolve('unit', [f.waves, f.optics]), /MULTI_LESSON_INVALID_SELECTION/);
    await assert.rejects(f.resolve('folder', [f.waves]), /MULTI_LESSON_INVALID_SELECTION/);
    // A new, unconfirmed revision moves a lesson out until it is confirmed again.
    await editLesson(f, a, f.l1.id, 'A onda começa quando observamos o fenômeno com muita atenção.');
    const after = await f.resolve('unit', [f.waves]);
    assert.deepEqual(ids(after.included), [f.l2.id]);
    assert.deepEqual(ids(after.excluded), [f.l1.id, f.l3.id]);
  } finally {
    await f.db.close();
  }
});

/** begin_generation_admin + multi_lesson_attach_admin, the way the service does it. */
function requester(f) {
  return async function request(
    { kind = 'unit', ids = [f.waves], outputs = ['summary', 'questions'], user = a, reuse = false, limit = 30, requestId = randomUUID(), id = randomUUID() } = {},
  ) {
    const resolved = await f.call('multi_lesson_resolve_admin', [user.id, kind, ids]);
    const sources = resolved.included.map((item) => item.revisionId);
    const key = generationKey({
      scope: `user:${user.id}`,
      sources,
      kind: 'multi_lesson',
      settings: { outputs },
      promptVersion: 'multi-lesson-v1',
      modelFamily: 'groq:test',
    });
    const begun = await f.call('begin_generation_admin', [user.id, key, 'user', user.id, 'multi_lesson', sources, 'multi-lesson-v1', 'groq:test', null, reuse, limit]);
    const record = await f.call('multi_lesson_attach_admin', [user.id, id, requestId, 'Unidade Ondas', kind, ids, outputs, JSON.stringify({ questionCount: 6 }), begun.generation.id, begun.decision, 2]);
    return { begun, record };
  };
}

test('requests: two simultaneous identical requests make one queued job; snapshot is frozen; reuse and idempotency', async () => {
  const f = await library();
  const request = requester(f);
  try {
    const [first, second] = await Promise.all([request(), request()]);
    assert.deepEqual([first.begun.decision, second.begun.decision].sort(), ['join', 'start']);
    assert.equal(first.record.id, second.record.id, 'both requests answer with the same record');
    const jobs = (await f.db.query('select * from public.multi_lesson_jobs')).rows;
    assert.equal(jobs.length, 1, 'one paid job');
    const gen = (await f.db.query('select status, kind from public.ai_generations')).rows;
    assert.deepEqual(gen, [{ status: 'running', kind: 'multi_lesson' }]);
    const record = first.record;
    assert.equal(record.status, 'queued');
    assert.deepEqual(record.sources.map((s) => s.title), ['Ondas 1', 'Ondas 2']);
    assert.deepEqual(record.excluded.map((s) => s.reason), ['unconfirmed']);
    assert.equal(record.job.status, 'pending');

    // Idempotent retry of the same POST; a different record id for the same request conflicts.
    const again = await f.call('multi_lesson_attach_admin', [a.id, record.id, record.request_id, 'x', 'unit', [f.waves], ['summary'], '{}', first.begun.generation.id, 'join', 2]);
    assert.equal(again.id, record.id);
    await assert.rejects(
      f.call('multi_lesson_attach_admin', [a.id, randomUUID(), record.request_id, 'x', 'unit', [f.waves], ['summary'], '{}', first.begun.generation.id, 'join', 2]),
      /MULTI_LESSON_REQUEST_CONFLICT/,
    );

    // A later edit (new revision) and a rename never change the snapshot; nor can it be rewritten.
    await editLesson(f, a, f.l1.id, 'A onda começa quando observamos o fenômeno com muita atenção.');
    await f.db.query("update public.materials set title='Renomeada' where id=$1", [f.l1.id]);
    const kept = await f.call('multi_lesson_get_admin', [a.id, record.id]);
    assert.deepEqual(kept.sources, record.sources);
    assert.deepEqual(kept.source_revision_ids, [f.l1.revisionId, f.l2.revisionId]);
    await assert.rejects(
      f.db.query("update public.multi_lesson_materials set sources='[]'::jsonb where id=$1", [record.id]),
      /MULTI_LESSON_SOURCES_IMMUTABLE/,
    );

    // Sources that changed between the preview and the request are refused honestly.
    const stale = await f.call('begin_generation_admin', [a.id, 'f'.repeat(64), 'user', a.id, 'multi_lesson', [f.l2.revisionId], 'multi-lesson-v1', 'groq:test', null, false, 30]);
    await assert.rejects(
      f.call('multi_lesson_attach_admin', [a.id, randomUUID(), randomUUID(), 'x', 'lessons', [f.l2.id, f.l4.id], ['summary'], '{}', stale.generation.id, 'start', 2]),
      /MULTI_LESSON_SOURCES_CHANGED/,
    );
    // B cannot attach to A's generation nor read A's record.
    await assert.rejects(
      f.call('multi_lesson_attach_admin', [b.id, randomUUID(), randomUUID(), 'x', 'lessons', [f.foreign.id], ['summary'], '{}', first.begun.generation.id, 'join', 2]),
      /MULTI_LESSON_GENERATION_NOT_FOUND/,
    );
    await assert.rejects(f.call('multi_lesson_get_admin', [b.id, record.id]), /MULTI_LESSON_NOT_FOUND/);
    await assert.rejects(f.call('multi_lesson_delete_admin', [b.id, record.id]), /MULTI_LESSON_NOT_FOUND/);
    assert.deepEqual(await f.call('multi_lesson_list_admin', [b.id, 20]), []);
    assert.equal((await f.call('multi_lesson_list_admin', [a.id, 20])).length, 1);
  } finally {
    await f.db.close();
  }
});

test('queue: claim, lease, retry with backoff, final failure frees the key, success completes it', async () => {
  const f = await library();
  const request = requester(f);
  const claim = (worker = 'w1', stale = 600) => f.call('multi_lesson_claim_job_admin', [worker, stale]);
  try {
    const { record, begun } = await request();
    const job = await claim();
    assert.equal(job.multi_lesson_id, record.id);
    assert.equal(job.attempt_count, 1);
    assert.equal(job.multiLesson.sources.length, 2);
    assert.equal(await claim('w2'), null, 'a leased job is not claimed twice');
    assert.equal(await f.call('multi_lesson_renew_lease_admin', [job.id, 'w2']), false);
    assert.equal(await f.call('multi_lesson_renew_lease_admin', [job.id, 'w1']), true);
    // Another worker cannot finish it.
    await assert.rejects(f.call('multi_lesson_complete_job_admin', [job.id, 'w2', '{}', 'm']), /MULTI_LESSON_LEASE_LOST/);
    // Retryable failure: back to the queue, not due before the retry time.
    const retry = await f.call('multi_lesson_fail_job_admin', [job.id, 'w1', 'LLM_TEMPORARY_ERROR', new Date(Date.now() + 60000).toISOString()]);
    assert.equal(retry.final, false);
    assert.equal(retry.status, 'retry');
    assert.equal(await claim(), null, 'backoff respected');
    await f.db.query("update public.multi_lesson_jobs set next_attempt_at = now() - interval '1 second'");
    const second = await claim();
    assert.equal(second.attempt_count, 2);
    // Attempts exhausted: even a retryable error is final, the record fails, the key is freed.
    const final = await f.call('multi_lesson_fail_job_admin', [second.id, 'w1', 'LLM_TEMPORARY_ERROR', new Date().toISOString()]);
    assert.equal(final.final, true);
    const failed = await f.call('multi_lesson_get_admin', [a.id, record.id]);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error_code, 'LLM_TEMPORARY_ERROR');
    const gen = (await f.db.query('select status, error_code from public.ai_generations where id=$1', [begun.generation.id])).rows[0];
    assert.deepEqual(gen, { status: 'failed', error_code: 'LLM_TEMPORARY_ERROR' });

    // The next equivalent request starts again (honest retry) and can succeed.
    const next = await request();
    assert.equal(next.begun.decision, 'start');
    assert.notEqual(next.record.id, record.id);
    const job3 = await claim();
    const done = await f.call('multi_lesson_complete_job_admin', [job3.id, 'w1', JSON.stringify({ summary: { sections: [] } }), 'model-x']);
    assert.equal(done.status, 'ready');
    assert.equal(done.model, 'model-x');
    const ready = (await f.db.query('select status, result from public.ai_generations where id=$1', [next.begun.generation.id])).rows[0];
    assert.deepEqual(ready, { status: 'ready', result: { multiLessonId: next.record.id } });
    // Reuse (asked for) returns the ready record without a job or budget; fresh supersedes.
    const reused = await request({ reuse: true });
    assert.equal(reused.begun.decision, 'reuse');
    assert.equal(reused.record.id, next.record.id);
    assert.equal((await f.db.query('select count(*)::int as n from public.multi_lesson_jobs')).rows[0].n, 2);
    const fresh = await request({ limit: 3 });
    assert.equal(fresh.begun.decision, 'start');
    // Budget: three starts today (failed, ready→superseded, fresh); the fourth is refused.
    await assert.rejects(request({ limit: 3, outputs: ['summary'] }), /GENERATION_BUDGET_EXCEEDED/);
  } finally {
    await f.db.close();
  }
});

test('a worker that died: lease expires, the job is retaken; with no attempts left it fails honestly', async () => {
  const f = await library();
  const request = requester(f);
  try {
    const { record, begun } = await request();
    const job = await f.call('multi_lesson_claim_job_admin', ['w1', 600]);
    await f.db.query("update public.multi_lesson_jobs set locked_at = now() - interval '20 minutes'");
    const retaken = await f.call('multi_lesson_claim_job_admin', ['w2', 600]);
    assert.equal(retaken.id, job.id);
    assert.equal(retaken.locked_by, 'w2');
    assert.equal(retaken.attempt_count, 2);
    await f.db.query("update public.multi_lesson_jobs set locked_at = now() - interval '20 minutes'");
    assert.equal(await f.call('multi_lesson_claim_job_admin', ['w3', 600]), null);
    const failed = await f.call('multi_lesson_get_admin', [a.id, record.id]);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error_code, 'WORKER_LEASE_EXPIRED');
    const gen = (await f.db.query('select status from public.ai_generations where id=$1', [begun.generation.id])).rows[0];
    assert.equal(gen.status, 'failed');
    // Deleting a queued record also frees its key.
    const other = await request({ outputs: ['questions'] });
    await f.call('multi_lesson_delete_admin', [a.id, other.record.id]);
    const freed = (await f.db.query('select status from public.ai_generations where id=$1', [other.begun.generation.id])).rows[0];
    assert.equal(freed.status, 'failed');
  } finally {
    await f.db.close();
  }
});

test('knowledge map cache: unique key, first writer wins, owner only, reused by later requests', async () => {
  const f = await library();
  try {
    const put = (user, revision, map, family = 'groq:test') =>
      f.call('knowledge_map_put_admin', [user.id, revision, 'knowledge-map-v1', family, JSON.stringify(map), 'm1']);
    const get = (user, revisions, family = 'groq:test') =>
      f.call('knowledge_map_get_admin', [user.id, revisions, 'knowledge-map-v1', family]);
    const first = await put(a, f.l1.revisionId, { concepts: [{ name: 'Onda' }] });
    assert.equal(first.created, true);
    const second = await put(a, f.l1.revisionId, { concepts: [{ name: 'Outra' }] });
    assert.equal(second.created, false);
    assert.deepEqual(second.map, { concepts: [{ name: 'Onda' }] }, 'the first stored map is kept');
    await assert.rejects(
      f.db.query("insert into public.knowledge_maps(source_revision_id,material_id,user_id,prompt_version,model_family,map) values($1,$2,$3,'knowledge-map-v1','groq:test','{}')", [f.l1.revisionId, f.l1.id, a.id]),
      /knowledge_maps_key/,
    );
    // Another model family is another key.
    assert.equal((await put(a, f.l1.revisionId, { concepts: [] }, 'other:model')).created, true);
    const hits = await get(a, [f.l1.revisionId, f.l2.revisionId]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].hitCount, 1);
    // B can neither store a map of A's revision nor read A's maps.
    await assert.rejects(put(b, f.l1.revisionId, {}), /KNOWLEDGE_MAP_SOURCE_FORBIDDEN/);
    assert.deepEqual(await get(b, [f.l1.revisionId]), []);
  } finally {
    await f.db.close();
  }
});

test('browsers have no access to any new table or function', async () => {
  const f = await library();
  try {
    for (const role of ['anon', 'authenticated'])
      for (const sql of [
        'select * from public.multi_lesson_materials',
        'select * from public.multi_lesson_jobs',
        'select * from public.knowledge_maps',
        `select public.multi_lesson_resolve_admin('${a.id}', 'unit', array['${f.waves}']::uuid[])`,
        `select public.multi_lesson_claim_job_admin('w', 600)`,
        `select public.knowledge_map_get_admin('${a.id}', array[]::uuid[], 'v', 'f')`,
      ])
        await assert.rejects(
          f.db.transaction(async (tx) => {
            await tx.exec(`set local role ${role}`);
            await tx.exec(`set local request.jwt.claim.sub = '${a.id}'`);
            await tx.query(sql);
          }),
          /permission denied/,
          `${role}: ${sql}`,
        );
    const rls = (await f.db.query("select relname, relrowsecurity from pg_class where relname in ('multi_lesson_materials','multi_lesson_jobs','knowledge_maps') order by relname")).rows;
    assert.deepEqual(rls.map((row) => row.relrowsecurity), [true, true, true]);
  } finally {
    await f.db.close();
  }
});

test('the integrated record and its queue work without the cache table', async () => {
  const f = await createMultiLessonDatabase({ cache: false });
  try {
    const subject = await addSubject(f, a, 'História', ['Brasil']);
    await addLesson(f, a, { title: 'Colônia', segments: SEG('colônia'), subjectId: subject.subjectId, unitId: subject.unitIds[0] });
    const g = { ...f, waves: subject.unitIds[0] };
    const { record } = await requester(g)();
    assert.equal(record.status, 'queued');
    const job = await f.call('multi_lesson_claim_job_admin', ['w1', 600]);
    assert.equal(job.multi_lesson_id, record.id);
    assert.equal((await f.db.query("select to_regclass('public.knowledge_maps') as t")).rows[0].t, null);
  } finally {
    await f.db.close();
  }
});

test('limits: at most 12 sources per material; the worker reads the frozen sources of its own lease only', async () => {
  const f = await library();
  try {
    for (let i = 0; i < 13; i += 1)
      await addLesson(f, a, { title: `Aula ${i + 1}`, segments: SEG(`parte ${i + 1}`), subjectId: f.physics.subjectId, unitId: f.optics });
    const resolved = await f.call('multi_lesson_resolve_admin', [a.id, 'unit', [f.optics]]);
    assert.equal(resolved.included.length, 14, 'resolution lists everything; the limit is enforced on request');
    const sources = resolved.included.map((item) => item.revisionId);
    const begun = await f.call('begin_generation_admin', [a.id, 'e'.repeat(64), 'user', a.id, 'multi_lesson', sources, 'multi-lesson-v1', 'groq:test', null, false, 30]);
    await assert.rejects(
      f.call('multi_lesson_attach_admin', [a.id, randomUUID(), randomUUID(), 'Óptica', 'unit', [f.optics], ['summary'], '{}', begun.generation.id, 'start', 2]),
      /MULTI_LESSON_TOO_MANY_SOURCES/,
    );
    const { record } = await requester(f)();
    const job = await f.call('multi_lesson_claim_job_admin', ['w1', 600]);
    await assert.rejects(f.call('multi_lesson_job_sources_admin', [job.id, 'w2']), /MULTI_LESSON_LEASE_LOST/);
    const read = await f.call('multi_lesson_job_sources_admin', [job.id, 'w1']);
    assert.deepEqual(read.map((s) => s.materialId), record.sources.map((s) => s.materialId));
    assert.equal(read[0].segments[0].position, 0);
    assert.match(read[0].segments[0].text, /onda/);
    // A later edit does not change what the worker reads: the snapshot revision stays.
    await editLesson(f, a, f.l1.id, 'Texto totalmente novo que não estava na revisão usada pelo pedido.');
    const again = await f.call('multi_lesson_job_sources_admin', [job.id, 'w1']);
    assert.deepEqual(again[0].segments, read[0].segments);
  } finally {
    await f.db.close();
  }
});
