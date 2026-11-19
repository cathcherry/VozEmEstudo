import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAcademicDatabase, revisionIds } from './fixtures/academic-db.fixture.js';
import { migrateStudyAuthoring } from './fixtures/authoring-db.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';

const migration = readFileSync(
  new URL('../../database/migrations/20261119120000_study_authoring.sql', import.meta.url),
  'utf8',
);

test('authoring migration is guarded, transactional and additive', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.match(migration, /AUTHORING_ABORT: aplicar e verificar E02 e E05/);
  assert.match(migration, /AUTHORING_ABORT: estruturas de autoria ja existem/);
  assert.doesNotMatch(migration, /\b(drop table|truncate|delete from|drop function|create or replace)\b/i);
  // The only dropped object is the legacy count list, replaced by a wider range in the same commit.
  assert.deepEqual(migration.match(/drop constraint[^;]+/gi), [
    'drop constraint if exists question_batches_requested_count_check',
  ]);
  assert.match(migration, /requested_count between 1 and 100/);
  assert.match(migration, /alter table public\.question_list_shares enable row level security/);
  assert.match(migration, /revoke all on public\.question_list_shares from public, anon, authenticated/);
  assert.match(migration, /from public, anon, authenticated;\ngrant execute on function/);
});

async function setup() {
  const f = await createAcademicDatabase();
  await migrateStudyAuthoring(f.db);
  const a = identities.a,
    materialId = resourceIds.materialA;
  await f.permit(a, materialId);
  await f.confirm(a, materialId, revisionIds.a);
  await f.permit(identities.b, resourceIds.materialB);
  await f.confirm(identities.b, resourceIds.materialB, revisionIds.b);
  return { ...f, a, materialId };
}

test('named summary versions keep options, provider and older versions', async () => {
  const f = await setup();
  try {
    const { call, a, materialId, db } = f;
    const enqueue = (params) =>
      f.enqueue(a, materialId, 'REGERAR_RESUMO', params, revisionIds.a, randomUUID());
    const legacyJob = await enqueue({});
    const legacy = await call('commit_summary_admin', [materialId, legacyJob.id, 'Resumo antigo.', 'fixture', 'summary-v2']);
    assert.equal(legacy.label, null);
    assert.deepEqual(legacy.options, {});
    const options = { format: 'structured', length: 'detailed', focus: ['concepts', 'exam'] };
    const job = await enqueue({ summaryOptions: { ...options, label: 'Revisão final' } });
    const saved = await call('commit_named_summary_admin', [
      materialId, job.id, '## Tema\n\nTexto.', 'model-x', 'summary-v3', 'Revisão final', JSON.stringify(options), 'groq',
    ]);
    assert.equal(saved.label, 'Revisão final');
    assert.deepEqual(saved.options, options);
    assert.equal(saved.provider, 'groq');
    assert.equal(saved.model, 'model-x');
    assert.equal(saved.source_transcription_version_id, revisionIds.a);
    assert.equal(saved.source_transcription_revision, 1);
    assert(saved.created_at);
    assert.equal(saved.version, 2);
    // A retry after a lost response returns the stored row and does not overwrite it.
    const retry = await call('commit_named_summary_admin', [
      materialId, job.id, 'Outro texto.', 'model-y', 'summary-v3', 'Outro nome', '{}', 'other',
    ]);
    assert.equal(retry.id, saved.id);
    assert.equal(retry.label, 'Revisão final');
    assert.equal(retry.text, '## Tema\n\nTexto.');
    const rows = (await db.query('select version,is_current,text from public.summary_versions where material_id=$1 order by version', [materialId])).rows;
    assert.deepEqual(rows.map((r) => [r.version, r.is_current]), [[1, false], [2, true]]);
    assert.equal(rows[0].text, 'Resumo antigo.');

    const renamed = await call('rename_summary_admin', [a.id, materialId, legacy.id, '  Primeira leitura ']);
    assert.equal(renamed.label, 'Primeira leitura');
    assert.equal(renamed.text, 'Resumo antigo.');
    const cleared = await call('rename_summary_admin', [a.id, materialId, legacy.id, '']);
    assert.equal(cleared.label, null);
    await assert.rejects(call('rename_summary_admin', [identities.b.id, materialId, legacy.id, 'Invasor']), /AUTHORING_NOT_FOUND/);
    await assert.rejects(call('rename_summary_admin', [identities.b.id, resourceIds.materialB, legacy.id, 'Cruzado']), /AUTHORING_NOT_FOUND/);
    await assert.rejects(call('rename_summary_admin', [a.id, materialId, legacy.id, 'x'.repeat(121)]));
    await assert.rejects(call('commit_named_summary_admin', [materialId, (await enqueue({})).id, 'T', 'm', 'p', null, '[]', null]), /INVALID_GENERATION/);
  } finally {
    await f.db.close();
  }
});

test('the browser role cannot call authoring functions or read list shares', async () => {
  const f = await setup();
  try {
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query("select public.rename_summary_admin($1,$2,$3,'x')", [identities.a.id, resourceIds.materialA, randomUUID()]);
      }),
      /permission denied/,
    );
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query('select * from public.question_list_shares');
      }),
      /permission denied/,
    );
  } finally {
    await f.db.close();
  }
});
