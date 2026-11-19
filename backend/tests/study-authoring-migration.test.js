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
  assert.doesNotMatch(
    migration,
    /\b(drop table|truncate|delete from|drop function|create or replace)\b/i,
  );
  // The only dropped object is the legacy count list, replaced by a wider range in the same commit.
  assert.deepEqual(migration.match(/drop constraint[^;]+/gi), [
    'drop constraint if exists question_batches_requested_count_check',
  ]);
  assert.match(migration, /requested_count between 1 and 100/);
  assert.match(migration, /alter table public\.question_list_shares enable row level security/);
  assert.match(
    migration,
    /revoke all on public\.question_list_shares from public, anon, authenticated/,
  );
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
    const legacy = await call('commit_summary_admin', [
      materialId,
      legacyJob.id,
      'Resumo antigo.',
      'fixture',
      'summary-v2',
    ]);
    assert.equal(legacy.label, null);
    assert.deepEqual(legacy.options, {});
    const options = { format: 'structured', length: 'detailed', focus: ['concepts', 'exam'] };
    const job = await enqueue({ summaryOptions: { ...options, label: 'Revisão final' } });
    const saved = await call('commit_named_summary_admin', [
      materialId,
      job.id,
      '## Tema\n\nTexto.',
      'model-x',
      'summary-v3',
      'Revisão final',
      JSON.stringify(options),
      'groq',
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
      materialId,
      job.id,
      'Outro texto.',
      'model-y',
      'summary-v3',
      'Outro nome',
      '{}',
      'other',
    ]);
    assert.equal(retry.id, saved.id);
    assert.equal(retry.label, 'Revisão final');
    assert.equal(retry.text, '## Tema\n\nTexto.');
    const rows = (
      await db.query(
        'select version,is_current,text from public.summary_versions where material_id=$1 order by version',
        [materialId],
      )
    ).rows;
    assert.deepEqual(
      rows.map((r) => [r.version, r.is_current]),
      [
        [1, false],
        [2, true],
      ],
    );
    assert.equal(rows[0].text, 'Resumo antigo.');

    const renamed = await call('rename_summary_admin', [
      a.id,
      materialId,
      legacy.id,
      '  Primeira leitura ',
    ]);
    assert.equal(renamed.label, 'Primeira leitura');
    assert.equal(renamed.text, 'Resumo antigo.');
    const cleared = await call('rename_summary_admin', [a.id, materialId, legacy.id, '']);
    assert.equal(cleared.label, null);
    await assert.rejects(
      call('rename_summary_admin', [identities.b.id, materialId, legacy.id, 'Invasor']),
      /AUTHORING_NOT_FOUND/,
    );
    await assert.rejects(
      call('rename_summary_admin', [identities.b.id, resourceIds.materialB, legacy.id, 'Cruzado']),
      /AUTHORING_NOT_FOUND/,
    );
    await assert.rejects(
      call('rename_summary_admin', [a.id, materialId, legacy.id, 'x'.repeat(121)]),
    );
    await assert.rejects(
      call('commit_named_summary_admin', [
        materialId,
        (await enqueue({})).id,
        'T',
        'm',
        'p',
        null,
        '[]',
        null,
      ]),
      /INVALID_GENERATION/,
    );
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
        await tx.query("select public.rename_summary_admin($1,$2,$3,'x')", [
          identities.a.id,
          resourceIds.materialA,
          randomUUID(),
        ]);
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

const listQuestion = (i, extra = {}) => ({
  statement: `Questão nomeada ${i}?`,
  options: ['A', 'B', 'C', 'D'],
  correctIndex: i % 4,
  explanation: 'Explicação.',
  metadata: {
    difficulty: 'basic',
    skill: 'recall',
    concept: 'Energia',
    evidence: 'Energia é conservada.',
  },
  ...extra,
});

test('custom-count lists: enqueue limits, partial commits, names and untouched legacy batches', async () => {
  const f = await setup();
  try {
    const { call, a, materialId, db } = f;
    const { PERMISSION_DECLARATION } = await import('../src/config/permission-declaration.js');
    const enqueueList = (
      params,
      key = randomUUID(),
      user = a,
      material = materialId,
      source = revisionIds.a,
    ) =>
      call('enqueue_question_list_admin', [
        user.id,
        material,
        JSON.stringify(params),
        source,
        key,
        PERMISSION_DECLARATION.version,
        3,
      ]);
    for (const bad of [{ count: 0 }, { count: 101 }, { count: 2.5 }, { count: '7' }, {}])
      await assert.rejects(enqueueList(bad), /INVALID_GENERATION/);
    // The E02 enqueue still only accepts presets.
    await assert.rejects(
      f.enqueue(a, materialId, 'GERAR_QUESTOES', { count: 7 }, revisionIds.a, randomUUID()),
      /INVALID_GENERATION/,
    );
    await assert.rejects(
      enqueueList({ count: 7 }, randomUUID(), identities.b),
      /MATERIAL_NOT_FOUND/,
    );
    await assert.rejects(
      enqueueList({ count: 7 }, randomUUID(), a, materialId, revisionIds.b),
      /REVISION_CONFLICT/,
    );
    const key = randomUUID();
    const config = { difficulties: ['basic', 'advanced'], skills: ['recall', 'application'] };
    const job = await enqueueList({ count: 37, config }, key);
    assert.equal(job.params.count, 37);
    assert.equal(job.params.sourceRevisionId, revisionIds.a);
    assert.equal((await enqueueList({ count: 37, config }, key)).id, job.id, 'idempotent retry');
    await assert.rejects(enqueueList({ count: 36, config }, key), /IDEMPOTENCY_CONFLICT/);

    const commit = (questions, requested = 37, jobId = job.id) =>
      call('commit_question_list_admin', [
        materialId,
        jobId,
        requested,
        JSON.stringify(questions),
        'model',
        'questions-v2',
        'Física — Conceitos básicos',
        JSON.stringify(config),
        JSON.stringify({
          requested,
          generated: questions.length,
          shortfall: 'insufficient_content',
        }),
        'groq',
      ]);
    await assert.rejects(commit([]), /INVALID_GENERATION/);
    await assert.rejects(
      commit(Array.from({ length: 38 }, (_, i) => listQuestion(i))),
      /INVALID_GENERATION/,
    );
    await assert.rejects(commit([listQuestion(1, { options: ['A', 'B'] })]), /INVALID_GENERATION/);
    await assert.rejects(commit([listQuestion(1, { metadata: [] })]), /INVALID_GENERATION/);
    await assert.rejects(
      commit([listQuestion(1)], 36),
      /INVALID_JOB_TYPE/,
      'requested count must match the job',
    );
    const before = Number((await db.query('select count(*) n from public.questions')).rows[0].n);
    await assert.rejects(commit([listQuestion(1), listQuestion(2, { correctIndex: 9 })]));
    assert.equal(
      Number((await db.query('select count(*) n from public.questions')).rows[0].n),
      before,
      'rollback',
    );
    const list = await commit(Array.from({ length: 12 }, (_, i) => listQuestion(i)));
    assert.equal(list.requested_count, 37);
    assert.equal(list.generated_count, 12);
    assert.equal(list.title, 'Física — Conceitos básicos');
    assert.deepEqual(list.config, config);
    assert.equal(list.coverage.shortfall, 'insufficient_content');
    assert.equal(list.provider, 'groq');
    assert.equal(list.source_transcription_version_id, revisionIds.a);
    assert.equal((await commit([listQuestion(99)])).id, list.id, 'retry returns the stored list');
    const stored = (
      await db.query(
        'select format,metadata from public.questions where batch_id=$1 order by position',
        [list.id],
      )
    ).rows;
    assert.equal(stored.length, 12);
    assert.equal(stored[0].format, 'single_choice');
    assert.equal(stored[0].metadata.concept, 'Energia');
    await assert.rejects(
      db.query("update public.questions set format='true_false' where batch_id=$1", [list.id]),
    );

    const renamed = await call('rename_question_list_admin', [
      a.id,
      materialId,
      list.id,
      ' Física — Avaliação avançada ',
    ]);
    assert.equal(renamed.title, 'Física — Avaliação avançada');
    assert.equal(renamed.generated_count, 12);
    for (const bad of ['', '   ', 'x'.repeat(161)])
      await assert.rejects(
        call('rename_question_list_admin', [a.id, materialId, list.id, bad]),
        /AUTHORING_INVALID_INPUT/,
      );
    await assert.rejects(
      call('rename_question_list_admin', [identities.b.id, materialId, list.id, 'X']),
      /AUTHORING_NOT_FOUND/,
    );
    await assert.rejects(
      call('rename_question_list_admin', [a.id, materialId, resourceIds.batchB, 'X']),
      /AUTHORING_NOT_FOUND/,
    );
    // The fixture's legacy batch (requested 5, generated 1) and its question are unchanged.
    const legacy = (
      await db.query(
        'select title,requested_count,generated_count,config from public.question_batches where id=$1',
        [resourceIds.batchA],
      )
    ).rows[0];
    assert.deepEqual(legacy, { title: null, requested_count: 5, generated_count: 1, config: {} });
    // Legacy preset generation still commits through the E02 function.
    const presetJob = await f.enqueue(
      a,
      materialId,
      'GERAR_QUESTOES',
      { count: 3 },
      revisionIds.a,
      randomUUID(),
    );
    const preset = await call('commit_question_batch_admin', [
      materialId,
      presetJob.id,
      3,
      JSON.stringify([0, 1, 2].map((i) => listQuestion(i, { metadata: undefined }))),
      'fixture',
      'questions-v1',
    ]);
    assert.equal(preset.generated_count, 3);
  } finally {
    await f.db.close();
  }
});

test('list shares: frozen answer-free snapshot, idempotent, isolated, expiring and revocable', async () => {
  const f = await setup();
  try {
    const { call, a, materialId, db } = f;
    const { PERMISSION_DECLARATION } = await import('../src/config/permission-declaration.js');
    const job = await call('enqueue_question_list_admin', [
      a.id,
      materialId,
      JSON.stringify({ count: 2, config: {} }),
      revisionIds.a,
      randomUUID(),
      PERMISSION_DECLARATION.version,
      3,
    ]);
    const list = await call('commit_question_list_admin', [
      materialId,
      job.id,
      2,
      JSON.stringify([listQuestion(1, { explanation: 'SEGREDO-EXPLICACAO' }), listQuestion(2)]),
      'm',
      'questions-v2',
      'Lista pública',
      '{}',
      '{}',
      null,
    ]);
    const hash = 'ab'.repeat(32),
      id = randomUUID(),
      requestId = randomUUID();
    const share = (overrides = {}) => {
      const v = {
        user: a.id,
        id,
        material: materialId,
        batch: list.id,
        request: requestId,
        hash,
        days: 7,
        ...overrides,
      };
      return call('create_question_list_share_admin', [
        v.user,
        v.id,
        v.material,
        v.batch,
        v.request,
        v.hash,
        v.days,
        PERMISSION_DECLARATION.version,
      ]);
    };
    const created = await share();
    assert.equal(created.id, id);
    assert.equal((await share()).id, id, 'retry returns the same link');
    await assert.rejects(share({ days: 30 }), /AUTHORING_REQUEST_CONFLICT/);
    await assert.rejects(
      share({ id: randomUUID(), request: randomUUID(), hash: 'cd'.repeat(32), days: 3 }),
      /AUTHORING_INVALID_INPUT/,
    );
    await assert.rejects(
      share({
        user: identities.b.id,
        id: randomUUID(),
        request: randomUUID(),
        hash: 'ef'.repeat(32),
      }),
      /AUTHORING_NOT_FOUND/,
    );
    await assert.rejects(
      share({
        id: randomUUID(),
        request: randomUUID(),
        hash: 'ef'.repeat(32),
        batch: resourceIds.batchB,
      }),
      /AUTHORING_NOT_FOUND/,
    );

    const snapshot = await call('resolve_question_list_share_admin', [hash]);
    assert.deepEqual(Object.keys(snapshot).sort(), [
      'expiresAt',
      'kind',
      'materialTitle',
      'questions',
      'revision',
      'subject',
      'title',
    ]);
    assert.deepEqual(Object.keys(snapshot.questions[0]).sort(), ['number', 'options', 'statement']);
    const text = JSON.stringify(snapshot);
    for (const leaked of [
      'correct',
      'SEGREDO-EXPLICACAO',
      'explanation',
      'evidence',
      'Energia é conservada',
      'metadata',
      'storage',
      'transcript',
    ])
      assert(!text.includes(leaked), `snapshot leaks ${leaked}`);
    // Frozen: later renames do not change an existing link.
    await call('rename_question_list_admin', [a.id, materialId, list.id, 'Outro nome']);
    assert.equal((await call('resolve_question_list_share_admin', [hash])).title, 'Lista pública');
    // Expiration and revocation are enforced by the database query, not the client.
    await db.query(
      "update public.question_list_shares set expires_at = now() - interval '1 second' where id=$1",
      [id],
    );
    assert.equal(await call('resolve_question_list_share_admin', [hash]), null);
    await db.query(
      "update public.question_list_shares set expires_at = now() + interval '1 day' where id=$1",
      [id],
    );
    assert(await call('resolve_question_list_share_admin', [hash]));
    await db.query('update public.question_list_shares set revoked_at = now() where id=$1', [id]);
    assert.equal(await call('resolve_question_list_share_admin', [hash]), null);
    assert.equal(await call('resolve_question_list_share_admin', ['00'.repeat(32)]), null);
  } finally {
    await f.db.close();
  }
});

test('authoring pre/postflight checks are read-only and run around the migration', async () => {
  const read = (name) =>
    readFileSync(new URL('../../database/checks/' + name, import.meta.url), 'utf8');
  for (const name of ['authoring-preflight.sql', 'authoring-postflight.sql']) {
    const sql = read(name);
    assert.match(sql, /^begin read only;/m);
    assert.match(sql, /^rollback;/m);
    assert.doesNotMatch(sql, /\b(create|drop|alter|insert|update|delete|truncate|grant|revoke)\s/i);
  }
  const f = await createAcademicDatabase();
  try {
    for (const file of ['20261104190000_catalog_units.sql', '20261104203000_study_planning.sql'])
      await f.db.exec(
        readFileSync(new URL('../../database/migrations/' + file, import.meta.url), 'utf8'),
      );
    const before = await f.db.exec(read('authoring-preflight.sql'));
    const counts = before.at(-2).rows[0];
    await f.db.exec(migration);
    const after = await f.db.exec(read('authoring-postflight.sql'));
    const state = after[1].rows[0];
    assert.deepEqual(
      [
        state.has_list_shares,
        state.has_list_commit,
        state.has_list_enqueue,
        state.has_named_summary,
        state.shares_rls_enabled,
        state.shares_hidden_from_browser,
        state.resolve_server_only,
      ],
      [true, true, true, true, true, true, true],
    );
    const afterCounts = after[2].rows[0];
    for (const key of ['materials', 'summaries', 'question_batches', 'questions'])
      assert.equal(Number(afterCounts[key]), Number(counts[key]), `${key} unchanged`);
    assert.equal(Number(afterCounts.unexpected_formats), 0);
    // Re-applying is refused instead of silently changing objects.
    await assert.rejects(f.db.exec(migration), /AUTHORING_ABORT: estruturas de autoria ja existem/);
  } finally {
    await f.db.close();
  }
});
