import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAcademicDatabase } from './fixtures/academic-db.fixture.js';
import { migrateStudyAuthoring } from './fixtures/authoring-db.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';

const migration = readFileSync(
  new URL('../../database/migrations/20261119140000_rls_performance.sql', import.meta.url),
  'utf8',
);

const TABLES = ['materials', 'audio_files', 'transcriptions', 'transcription_segments', 'transcription_versions',
  'summary_versions', 'question_batches', 'questions', 'processing_jobs', 'processing_job_events'];

/** Rows each account can read through RLS, per table. */
async function visible(db) {
  const result = {};
  for (const [key, identity] of Object.entries(identities)) {
    result[key] = {};
    await db.transaction(async (tx) => {
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [identity.id]);
      for (const table of TABLES)
        result[key][table] = Number((await tx.query(`select count(*) n from public.${table}`)).rows[0].n);
    });
  }
  return result;
}

test('RLS performance migration: same access per account, initplan form, covering indexes, re-runnable', async () => {
  assert.doesNotMatch(migration, /\b(drop policy|drop table|truncate|delete from|create policy)\b/i);
  const f = await createAcademicDatabase();
  try {
    await migrateStudyAuthoring(f.db);
    await f.db.exec(`grant select on ${TABLES.map((t) => 'public.' + t).join(', ')} to authenticated`);
    const before = await visible(f.db);
    // Sanity: each account sees its own lesson and never the other one.
    assert.equal(before.a.materials, 1);
    assert.equal(before.b.materials, 1);
    await f.db.exec(migration);
    await f.db.exec(migration);
    assert.deepEqual(await visible(f.db), before);
    const policies = (await f.db.query(
      "select policyname, qual, with_check from pg_policies where schemaname = 'public' and policyname = any($1)",
      [['materials_select_own', 'materials_update_own', 'questions_select_own', 'processing_job_events_select_own']],
    )).rows;
    assert.equal(policies.length, 4);
    for (const policy of policies) {
      const text = `${policy.qual || ''} ${policy.with_check || ''}`;
      assert.match(text, /SELECT auth\.uid\(\)/i);
      assert.doesNotMatch(text.replace(/SELECT auth\.uid\(\)/gi, ''), /auth\.uid\(\)/);
    }
    const indexes = (await f.db.query("select indexname from pg_indexes where schemaname = 'public'")).rows.map((r) => r.indexname);
    for (const name of ['processing_jobs_confirmation_idx', 'question_batches_source_version_idx',
      'summary_versions_source_version_idx', 'question_list_shares_batch_idx', 'transcription_confirmations_user_idx'])
      assert(indexes.includes(name), name);
    // Writes go through the rewritten UPDATE policy: the owner can, another account cannot.
    await f.db.exec('grant update (title) on public.materials to authenticated');
    const rename = (identity) =>
      f.db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [identity.id]);
        return (await tx.query("update public.materials set title = 'Novo título' where id = $1", [resourceIds.materialA])).affectedRows;
      });
    assert.equal(await rename(identities.b), 0);
    assert.equal(await rename(identities.a), 1);
  } finally {
    await f.db.close();
  }
});
