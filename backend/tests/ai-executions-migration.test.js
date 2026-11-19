import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createAcademicDatabase, revisionIds } from './fixtures/academic-db.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';
import { PERMISSION_DECLARATION } from '../src/config/permission-declaration.js';

// New materials and their permission are recorded together (deferred permission trigger).
const createMaterial = (db, id) =>
  db.transaction(async (tx) => {
    await tx.query(
      "insert into public.materials(id,user_id,title,status) values($1,$2,'Aula nova','PROCESSANDO')",
      [id, identities.a.id],
    );
    await tx.query('select public.declare_material_permission_admin($1,$2,$3,$4)', [
      identities.a.id,
      id,
      PERMISSION_DECLARATION.version,
      PERMISSION_DECLARATION.text,
    ]);
  });

const migration = await readFile(
  new URL('../../database/migrations/20261119030000_ai_executions.sql', import.meta.url),
  'utf8',
);

test('AI migration is additive and transactional', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.doesNotMatch(
    migration,
    /\b(drop|truncate|alter table public\.(materials|transcriptions|transcription_segments|transcription_versions|processing_jobs))\b/i,
  );
  assert.doesNotMatch(
    migration,
    /create or replace function public\.claim_next_processing_job\(p_worker_id text\)/,
  );
});

test('alignment persistence is atomic, idempotent, server-only and keeps legacy data readable', async () => {
  const { db, call } = await createAcademicDatabase();
  try {
    const legacy = (await db.query('select * from public.transcription_versions order by id')).rows;
    await db.exec(migration);
    assert.deepEqual(
      (await db.query('select * from public.transcription_versions order by id')).rows,
      legacy,
    );

    const materialId = randomUUID();
    await createMaterial(db, materialId);
    const result = {
      text: 'Olá turma. Hoje vamos estudar.',
      language: 'pt',
      segments: [
        { startMs: 0, endMs: 900, text: 'Olá turma.', speaker: 'A' },
        { startMs: 1200, endMs: 2600, text: 'Hoje vamos estudar.', speaker: 'A' },
      ],
      words: [
        { startMs: 0, endMs: 400, text: 'Olá', speaker: 'A', confidence: 0.98, segment: 0 },
        { startMs: 450, endMs: 900, text: 'turma.', speaker: 'A', confidence: 0.97, segment: 0 },
        { startMs: 1200, endMs: 1500, text: 'Hoje', speaker: 'A', confidence: null, segment: 1 },
        { startMs: 1550, endMs: 1900, text: 'vamos', speaker: 'A', confidence: 0.9, segment: 1 },
        {
          startMs: 1950,
          endMs: 2600,
          text: 'estudar.',
          speaker: 'A',
          confidence: 0.91,
          segment: 1,
        },
      ],
      metadata: {
        provider: 'assemblyai',
        requestedModel: 'assemblyai-stt-3-7',
        actualModel: 'assemblyai-stt-3-7',
      },
    };
    const first = await call('create_initial_transcription_with_alignment_admin', [
      materialId,
      JSON.stringify(result),
    ]);
    // A repeated completion event returns the same transcription and inserts nothing new.
    const again = await call('create_initial_transcription_with_alignment_admin', [
      materialId,
      JSON.stringify(result),
    ]);
    assert.equal(again.id, first.id);
    const count = async (table, where = '') =>
      (await db.query(`select count(*)::int n from public.${table} ${where}`)).rows[0].n;
    assert.equal(await count('transcriptions', `where material_id='${materialId}'`), 1);
    assert.equal(await count('transcription_segments', `where transcription_id='${first.id}'`), 2);
    const alignment = (
      await db.query(
        'select a.* from public.transcription_word_alignments a join public.transcription_versions v on v.id=a.transcription_version_id where v.transcription_id=$1',
        [first.id],
      )
    ).rows;
    assert.equal(alignment.length, 1);
    assert.equal(alignment[0].provider, 'assemblyai');
    assert.equal(alignment[0].words.length, 5);
    assert.equal(alignment[0].words[2].confidence, null);

    // Alignment never attaches to a transcript whose text differs (e.g. created by another path).
    const other = randomUUID();
    await createMaterial(db, other);
    await call('create_initial_transcription_admin', [
      other,
      JSON.stringify({ text: 'Texto anterior.', segments: [] }),
    ]);
    await call('create_initial_transcription_with_alignment_admin', [
      other,
      JSON.stringify(result),
    ]);
    assert.equal(await count('transcription_word_alignments'), 1);

    // Browser roles have no direct access to the new tables or functions.
    for (const table of ['ai_job_executions', 'transcription_word_alignments']) {
      const rights = (
        await db.query(
          `select c.relrowsecurity rls, has_table_privilege('anon',c.oid,'SELECT') anon_read,
        has_table_privilege('authenticated',c.oid,'SELECT') browser_read, has_table_privilege('service_role',c.oid,'SELECT') server_read
        from pg_class c where c.oid=$1::regclass`,
          ['public.' + table],
        )
      ).rows[0];
      assert.deepEqual(
        rights,
        { rls: true, anon_read: false, browser_read: false, server_read: true },
        table,
      );
    }
    const executable = (
      await db.query(
        "select has_function_privilege('authenticated','public.create_initial_transcription_with_alignment_admin(uuid,jsonb)','EXECUTE') ok",
      )
    ).rows[0].ok;
    assert.equal(executable, false);
    // Legacy review still works on pre-existing materials.
    const review = await call('get_transcription_review_admin', [
      identities.b.id,
      resourceIds.materialB,
      (await db.query('select public.current_permission_version() v')).rows[0].v,
    ]);
    assert.equal(review.sourceRevisionId, revisionIds.b);
  } finally {
    await db.close();
  }
});

test('execution snapshots are unique per job and stale leases are recovered or failed', async () => {
  const { db, call, permit } = await createAcademicDatabase();
  try {
    await db.exec(migration);
    await permit(identities.a, resourceIds.materialA);
    const insertJob = async (attempts, lockedMinutesAgo, status = 'EM_EXECUCAO') => {
      const id = randomUUID();
      await db.query(
        `insert into public.processing_jobs(id,material_id,type,status,attempt_count,max_attempts,locked_at,locked_by,created_at)
         values($1,$2,'PROCESSAMENTO_INICIAL',$3,$4,3,now() - make_interval(mins => $5),'dead-worker',now() - interval '1 day')`,
        [id, resourceIds.materialA, status, attempts, lockedMinutesAgo],
      );
      return id;
    };
    const exhausted = await insertJob(3, 120);
    const fresh = await insertJob(1, 1);
    const stale = await insertJob(1, 120);
    await assert.rejects(call('claim_next_processing_job', ['w', 10]), /INVALID_LEASE/);
    const claimed = (
      await db.query("select * from public.claim_next_processing_job('worker-2', 1800)")
    ).rows;
    assert.deepEqual(
      claimed.map((job) => [job.id, job.locked_by, job.attempt_count]),
      [[stale, 'worker-2', 2]],
    );
    const byId = async (id) =>
      (await db.query('select * from public.processing_jobs where id=$1', [id])).rows[0];
    assert.equal((await byId(exhausted)).status, 'FALHOU');
    assert.equal((await byId(exhausted)).error_code, 'LEASE_EXPIRED');
    assert.equal((await byId(fresh)).locked_by, 'dead-worker', 'live leases are never stolen');
    // The original one-argument claim keeps its behaviour.
    assert.equal(
      (await db.query("select * from public.claim_next_processing_job('legacy')")).rows.length,
      0,
    );

    await db.query(
      "insert into public.ai_job_executions(job_id,material_id,task,provider,requested_model) values($1,$2,'transcription','assemblyai','assemblyai-stt-3-7')",
      [stale, resourceIds.materialA],
    );
    await assert.rejects(
      db.query(
        "insert into public.ai_job_executions(job_id,material_id,task,provider) values($1,$2,'transcription','huggingface')",
        [stale, resourceIds.materialA],
      ),
      /duplicate key/,
    );
    await assert.rejects(
      db.query("update public.ai_job_executions set state='bogus' where job_id=$1", [stale]),
      /check constraint/,
    );
  } finally {
    await db.close();
  }
});
