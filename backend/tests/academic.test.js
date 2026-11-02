import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAcademicDatabase, revisionIds } from './fixtures/academic-db.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';
import {
  PERMISSION_DECLARATION,
  declarationVersion,
} from '../src/config/permission-declaration.js';
import { buildWarningMessages, WARNING_TYPES } from '../src/prompts/warnings.v1.js';
import { validateWarningPayload } from '../src/validators/llm-output.validator.js';

test('E02 SQL transactions, immutable sources and RLS use isolated PostgreSQL with synthetic data', async (t) => {
  const f = await createAcademicDatabase();
  const { db, call } = f;
  const a = identities.a,
    b = identities.b,
    materialId = resourceIds.materialA;
  const count = async (table) =>
    Number((await db.query('select count(*) as count from public.' + table)).rows[0].count);
  let summaryJob, questionJob;
  const warnings = WARNING_TYPES.map((type) => ({
    type,
    state: 'insufficient',
    explanation: 'Contexto sintético insuficiente.',
    guidance: 'Confira a aula.',
    segmentRefs: [],
    model: 'fixture',
    promptVersion: 'warnings-test',
    subject: 'Física',
  }));
  try {
    await t.test(
      'read-only pre/postflight preserve historical counts and expose no user content',
      async () => {
        const before = f.preflight.find((result) => result.rows?.[0]?.materials !== undefined)
          .rows[0];
        const after = f.postflight.find((result) => result.rows?.[0]?.materials !== undefined)
          .rows[0];
        for (const table of [
          'materials',
          'audio_files',
          'transcriptions',
          'transcription_segments',
          'transcription_versions',
          'summary_versions',
          'question_batches',
          'questions',
          'processing_jobs',
          'processing_job_events',
        ])
          assert.equal(after[table], before[table], table);
        assert.equal(after.permissions, 0);
        assert.equal(after.confirmations, 0);
        assert.equal(after.warnings, 0);
        const denied = f.postflight.find(
          (result) => result.rows?.[0]?.server_rpcs_executable_by_authenticated !== undefined,
        ).rows[0];
        assert.equal(denied.server_rpcs_executable_by_authenticated, 0);
        assert(!JSON.stringify(f.preflight).includes('Energia é conservada.'));
      },
    );
    await t.test(
      'additive schema preserves historical rows without inventing consent or confirmation',
      async () => {
        assert.equal(await count('materials'), 2);
        assert.equal(await count('question_batches'), 2);
        assert.equal(await count('questions'), 2);
        assert.equal(await count('material_permissions'), 0);
        assert.equal(await count('transcription_confirmations'), 0);
        const state = await call('get_transcription_review_admin', [
          a.id,
          materialId,
          PERMISSION_DECLARATION.version,
        ]);
        assert.equal(state.permissionRequired, true);
        assert.equal(state.state, 'awaiting_review');
        await assert.rejects(
          f.enqueue(a, materialId, 'REGERAR_RESUMO', {}, revisionIds.a, randomUUID()),
          /PERMISSION_REQUIRED/,
        );
      },
    );
    await t.test(
      'direct insert without declaration rolls back and permission is independent of retention',
      async () => {
        const id = randomUUID();
        await assert.rejects(
          db.transaction(async (tx) => {
            await tx.query('insert into public.materials(id,user_id,title) values($1,$2,$3)', [
              id,
              a.id,
              'Bypass',
            ]);
          }),
          /PERMISSION_REQUIRED/,
        );
        assert.equal(await count('materials'), 2);
        const data = {
          id,
          title: 'Aula nova',
          subject: 'Física',
          originalFilename: 'fixture.wav',
          mimeType: 'audio/wav',
          extension: 'wav',
          sizeBytes: 1024,
          durationMs: 3000,
          questionCount: 3,
          retainAudio: false,
          storagePath: 'temp/' + a.id + '/' + id + '/fixture.wav',
        };
        const results = await Promise.all(
          [1, 2].map(() =>
            call('create_material_with_permission_admin', [
              a.id,
              JSON.stringify(data),
              PERMISSION_DECLARATION.version,
              PERMISSION_DECLARATION.text,
            ]),
          ),
        );
        assert.equal(results[0].id, results[1].id);
        assert.equal(await count('materials'), 3);
        const audio = (
          await db.query('select retain_original from public.audio_files where material_id=$1', [
            id,
          ])
        ).rows[0];
        assert.equal(audio.retain_original, false);
        const permission = (
          await db.query('select * from public.material_permissions where material_id=$1', [id])
        ).rows[0];
        assert.equal(permission.user_id, a.id);
        assert.equal(permission.declaration_version, PERMISSION_DECLARATION.version);
        assert.equal(permission.declaration_text, PERMISSION_DECLARATION.text);
        assert(permission.declared_at);
        const result = {
          text: 'Transcrição sintética.',
          segments: [{ text: 'Transcrição sintética.', startMs: 0, endMs: 3000 }],
        };
        await call('create_initial_transcription_admin', [id, JSON.stringify(result)]);
        assert.equal(
          (await db.query('select review_state from public.materials where id=$1', [id])).rows[0]
            .review_state,
          'awaiting_review',
        );
        assert.equal(await count('transcription_confirmations'), 0);
      },
    );
    await t.test('transcription persistence is atomic when a segment fails', async () => {
      const id = randomUUID();
      const data = {
        id,
        title: 'Transcrição com falha',
        originalFilename: 'fixture.wav',
        mimeType: 'audio/wav',
        extension: 'wav',
        sizeBytes: 1024,
        durationMs: 3000,
        questionCount: 5,
        retainAudio: true,
        storagePath: 'temp/' + a.id + '/' + id + '/fixture.wav',
      };
      await call('create_material_with_permission_admin', [
        a.id,
        JSON.stringify(data),
        PERMISSION_DECLARATION.version,
        PERMISSION_DECLARATION.text,
      ]);
      const initial = await count('transcriptions');
      await assert.rejects(
        call('create_initial_transcription_admin', [
          id,
          JSON.stringify({
            text: 'Texto sintético.',
            segments: [{ text: 'Texto sintético.', startMs: 500, endMs: 1 }],
          }),
        ]),
      );
      assert.equal(await count('transcriptions'), initial);
      await call('create_initial_transcription_admin', [
        id,
        JSON.stringify({ text: 'Texto sintético.', segments: [] }),
      ]);
      assert.equal(await count('transcriptions'), initial + 1);
    });
    await t.test(
      'confirmation requires owner and current revision and is idempotent with stable timestamp',
      async () => {
        await f.permit(a, materialId);
        await f.permit(b, resourceIds.materialB);
        await assert.rejects(f.confirm(b, materialId, revisionIds.a), /MATERIAL_NOT_FOUND/);
        await assert.rejects(f.confirm(a, materialId, revisionIds.b), /REVISION_CONFLICT/);
        const [first, second] = await Promise.all([
          f.confirm(a, materialId, revisionIds.a),
          f.confirm(a, materialId, revisionIds.a),
        ]);
        assert.equal(first.id, second.id);
        assert.equal(first.confirmed_at, second.confirmed_at);
        assert.equal(first.transcription_version_id, revisionIds.a);
      },
    );
    await t.test(
      'generation without confirmation and historical jobs without source fail closed',
      async () => {
        await assert.rejects(
          f.enqueue(
            b,
            resourceIds.materialB,
            'GERAR_QUESTOES',
            { count: 5 },
            revisionIds.b,
            randomUUID(),
          ),
          /TRANSCRIPTION_CONFIRMATION_REQUIRED/,
        );
        await assert.rejects(
          call('get_generation_source_admin', [materialId, resourceIds.jobA]),
          /SOURCE_REVISION_MISMATCH/,
        );
        await assert.rejects(
          f.enqueue(a, materialId, 'REGERAR_RESUMO', {}, null, randomUUID()),
          /SOURCE_REVISION_REQUIRED/,
        );
      },
    );
    await t.test('enqueue pins the confirmed UUID and retries return the same job', async () => {
      const key = randomUUID();
      const [first, second] = await Promise.all([
        f.enqueue(a, materialId, 'REGERAR_RESUMO', {}, revisionIds.a, key),
        f.enqueue(a, materialId, 'REGERAR_RESUMO', {}, revisionIds.a, key),
      ]);
      summaryJob = first;
      assert.equal(first.id, second.id);
      assert.equal(first.source_transcription_version_id, revisionIds.a);
      assert.equal(first.params.sourceRevisionId, revisionIds.a);
      assert(first.confirmation_id);
      questionJob = await f.enqueue(
        a,
        materialId,
        'GERAR_QUESTOES',
        { count: 3 },
        revisionIds.a,
        randomUUID(),
      );
      for (const value of [5, 10, 20]) {
        const job = await f.enqueue(
          a,
          materialId,
          'GERAR_QUESTOES',
          { count: value },
          revisionIds.a,
          randomUUID(),
        );
        assert.equal(job.params.count, value);
      }
    });
    await t.test(
      'editing while queued keeps the old source and the new revision unconfirmed',
      async () => {
        const segment = (
          await db.query(
            'select s.id from public.transcription_segments s join public.transcriptions t on t.id=s.transcription_id where t.material_id=$1',
            [materialId],
          )
        ).rows[0];
        const revision = await call('apply_transcription_edits_owned_admin', [
          a.id,
          materialId,
          1,
          JSON.stringify([{ id: segment.id, text: 'Texto alterado depois do enfileiramento.' }]),
        ]);
        assert.equal(revision, 2);
        const source = await call('get_generation_source_admin', [materialId, summaryJob.id]);
        assert.equal(source.id, revisionIds.a);
        assert(source.full_text.includes('Energia é conservada.'));
        assert(!source.full_text.includes('Texto alterado'));
        const latest = (
          await db.query(
            'select tv.id from public.transcription_versions tv join public.transcriptions t on t.id=tv.transcription_id where t.material_id=$1 and tv.revision=2',
            [materialId],
          )
        ).rows[0];
        await assert.rejects(
          f.enqueue(a, materialId, 'REGERAR_RESUMO', {}, latest.id, randomUUID()),
          /TRANSCRIPTION_CONFIRMATION_REQUIRED/,
        );
        const retry = await f.enqueue(
          a,
          materialId,
          'REGERAR_RESUMO',
          {},
          revisionIds.a,
          summaryJob.idempotency_key,
        );
        assert.equal(retry.id, summaryJob.id);
      },
    );
    await t.test(
      'restore creates a new unconfirmed revision and preserves old confirmations',
      async () => {
        assert.equal(
          await call('restore_transcription_revision_owned_admin', [a.id, materialId, 1]),
          3,
        );
        const state = await call('get_transcription_review_admin', [
          a.id,
          materialId,
          PERMISSION_DECLARATION.version,
        ]);
        assert.equal(state.revision, 3);
        assert.equal(state.state, 'awaiting_review');
        assert.notEqual(state.sourceRevisionId, revisionIds.a);
        assert.equal(await count('transcription_confirmations'), 1);
      },
    );
    await t.test(
      'parallel submitted summary commits have unique versions and one current row; retries deduplicate',
      async () => {
        const state = await call('get_transcription_review_admin', [
          a.id,
          materialId,
          PERMISSION_DECLARATION.version,
        ]);
        await f.confirm(a, materialId, state.sourceRevisionId);
        const secondJob = await f.enqueue(
          a,
          materialId,
          'REGERAR_RESUMO',
          {},
          state.sourceRevisionId,
          randomUUID(),
        );
        const results = await Promise.all([
          call('commit_summary_admin', [
            materialId,
            summaryJob.id,
            'Resumo da revisão 1.',
            'fixture',
            'summary-test',
          ]),
          call('commit_summary_admin', [
            materialId,
            secondJob.id,
            'Resumo da revisão 3.',
            'fixture',
            'summary-test',
          ]),
        ]);
        assert.notEqual(results[0].version, results[1].version);
        assert.equal(
          (await db.query('select count(*) as n from public.summary_versions where is_current'))
            .rows[0].n,
          1,
        );
        assert.equal(results[0].source_transcription_version_id, revisionIds.a);
        const retry = await call('commit_summary_admin', [
          materialId,
          summaryJob.id,
          'Resposta repetida diferente.',
          'fixture',
          'summary-test',
        ]);
        assert.equal(retry.id, results[0].id);
        assert.equal(await count('summary_versions'), 2);
      },
    );
    await t.test(
      'failed summary transaction preserves current summary and transcription; retry commits once',
      async () => {
        const state = await call('get_transcription_review_admin', [
          a.id,
          materialId,
          PERMISSION_DECLARATION.version,
        ]);
        const job = await f.enqueue(
          a,
          materialId,
          'REGERAR_RESUMO',
          {},
          state.sourceRevisionId,
          randomUUID(),
        );
        const before = (await db.query('select id from public.summary_versions where is_current'))
          .rows[0].id;
        const transcripts = await count('transcriptions');
        await assert.rejects(
          call('commit_summary_admin', [materialId, job.id, 'Resumo.', null, 'summary-test']),
        );
        assert.equal(
          (await db.query('select id from public.summary_versions where is_current')).rows[0].id,
          before,
        );
        assert.equal(await count('summary_versions'), 2);
        assert.equal(await count('transcriptions'), transcripts);
        await call('commit_summary_admin', [
          materialId,
          job.id,
          'Resumo recuperado.',
          'fixture',
          'summary-test',
        ]);
        assert.equal(await count('summary_versions'), 3);
      },
    );
    await t.test(
      'batch and questions roll back together; retry returns a complete single batch',
      async () => {
        const questions = Array.from({ length: 3 }, (_, i) => ({
          statement: 'Questão ' + i,
          options: ['A', 'B', 'C', 'D'],
          correctIndex: 0,
          explanation: 'Sintética.',
        }));
        const invalid = structuredClone(questions);
        invalid[1].correctIndex = 5;
        const batches = await count('question_batches'),
          rows = await count('questions');
        await assert.rejects(
          call('commit_question_batch_admin', [
            materialId,
            questionJob.id,
            3,
            JSON.stringify(invalid),
            'fixture',
            'questions-test',
          ]),
        );
        assert.equal(await count('question_batches'), batches);
        assert.equal(await count('questions'), rows);
        const result = await call('commit_question_batch_admin', [
          materialId,
          questionJob.id,
          3,
          JSON.stringify(questions),
          'fixture',
          'questions-test',
        ]);
        const retry = await call('commit_question_batch_admin', [
          materialId,
          questionJob.id,
          3,
          JSON.stringify(questions),
          'fixture',
          'questions-test',
        ]);
        assert.equal(result.id, retry.id);
        assert.equal(result.generated_count, 3);
        assert.equal(result.source_transcription_version_id, revisionIds.a);
        assert.equal(await count('question_batches'), batches + 1);
        assert.equal(await count('questions'), rows + 3);
      },
    );
    await t.test('historical versions and queued job sources cannot be changed', async () => {
      await assert.rejects(
        db.query('update public.transcription_versions set full_text=$1 where id=$2', [
          'Troca silenciosa.',
          revisionIds.a,
        ]),
        /IMMUTABLE_REVISION/,
      );
      await assert.rejects(
        db.query('update public.processing_jobs set params=$1 where id=$2', [
          JSON.stringify({ sourceRevisionId: revisionIds.b }),
          summaryJob.id,
        ]),
        /SOURCE_REVISION_MISMATCH/,
      );
      await assert.rejects(
        db.query(
          'insert into public.summary_versions(material_id,version,text,source_transcription_revision,model,prompt_version) values($1,99,$2,3,$3,$4)',
          [materialId, 'Bypass', 'fixture', 'test'],
        ),
        /SOURCE_REVISION_REQUIRED/,
      );
    });
    await t.test(
      'warnings preserve analyses and replay one operation without confirming truth',
      async () => {
        const analysisId = randomUUID();
        await call('save_content_warnings_admin', [
          a.id,
          materialId,
          revisionIds.a,
          analysisId,
          JSON.stringify(warnings),
        ]);
        assert.equal(await count('content_warnings'), 3);
        const row = (await db.query('select * from public.content_warnings limit 1')).rows[0];
        assert.equal(row.revision_id, revisionIds.a);
        assert.equal(row.context_subject, 'Física');
        assert.equal(row.prompt_version, 'warnings-test');
        await assert.rejects(
          call('save_content_warnings_admin', [
            b.id,
            materialId,
            revisionIds.a,
            analysisId,
            JSON.stringify(warnings),
          ]),
          /MATERIAL_NOT_FOUND/,
        );
        await call('save_content_warnings_admin', [
          a.id,
          materialId,
          revisionIds.a,
          analysisId,
          JSON.stringify(warnings),
        ]);
        assert.equal(await count('content_warnings'), 3);
        await call('save_content_warnings_admin', [
          a.id,
          materialId,
          revisionIds.a,
          randomUUID(),
          JSON.stringify(warnings.map((w) => ({ ...w, explanation: 'Nova análise.' }))),
        ]);
        assert.equal(await count('content_warnings'), 6);
        assert.equal(
          (
            await db.query('select explanation from public.content_warnings where analysis_id=$1', [
              analysisId,
            ])
          ).rows[0].explanation,
          warnings[0].explanation,
        );
        await assert.rejects(
          call('save_content_warnings_admin', [
            b.id,
            resourceIds.materialB,
            revisionIds.b,
            analysisId,
            JSON.stringify(warnings),
          ]),
          /IDEMPOTENCY_CONFLICT/,
        );
      },
    );
    await t.test(
      'RLS separates A/B and authenticated callers cannot execute server RPCs or forge confirmation',
      async () => {
        for (const identity of [a, b])
          await db.transaction(async (tx) => {
            await tx.exec('set local role authenticated');
            await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [identity.id]);
            for (const table of ['material_permissions', 'transcription_confirmations']) {
              const rows = (await tx.query('select user_id from public.' + table)).rows;
              assert(rows.every((row) => row.user_id === identity.id));
            }
            const rows = (await tx.query('select material_id from public.content_warnings')).rows;
            assert(
              rows.every(
                (row) =>
                  row.material_id === (identity.id === a.id ? materialId : resourceIds.materialB),
              ),
            );
          });
        await assert.rejects(
          db.transaction(async (tx) => {
            await tx.exec('set local role authenticated');
            await tx.query('select public.confirm_transcription_admin($1,$2,$3,$4)', [
              a.id,
              materialId,
              revisionIds.a,
              PERMISSION_DECLARATION.version,
            ]);
          }),
          /permission denied/,
        );
        await assert.rejects(
          db.transaction(async (tx) => {
            await tx.exec('set local role authenticated');
            await tx.query(
              'insert into public.transcription_confirmations(user_id,material_id,transcription_version_id,consent_version) values($1,$2,$3,$4)',
              [a.id, materialId, revisionIds.a, PERMISSION_DECLARATION.version],
            );
          }),
          /permission denied/,
        );
        await assert.rejects(
          db.transaction(async (tx) => {
            await tx.exec('set local role anon');
            await tx.query('select * from public.content_warnings');
          }),
          /permission denied/,
        );
      },
    );
    await t.test(
      'changed declaration text has a different version and outdated policy fails closed',
      async () => {
        assert.notEqual(
          declarationVersion(PERMISSION_DECLARATION.text + ' Texto revisado.'),
          PERMISSION_DECLARATION.version,
        );
        await db.exec(
          "create or replace function public.current_permission_version() returns text language sql immutable set search_path='' as $$ select 'permission-v2-test'::text $$",
        );
        await assert.rejects(
          call('require_material_permission_admin', [
            a.id,
            materialId,
            PERMISSION_DECLARATION.version,
          ]),
          /POLICY_VERSION_MISMATCH/,
        );
      },
    );
  } finally {
    await db.close();
  }
});

test('warning prompts preserve refutation, irony, fiction and hypothesis; references must belong to the snapshot', () => {
  const source = {
    id: revisionIds.a,
    full_text: 'Ele citou: a Terra é plana, para refutar a frase.',
    segments_snapshot: [
      {
        id: randomUUID(),
        position: 0,
        startMs: 0,
        endMs: 3000,
        text: 'Ele citou: a Terra é plana, para refutar a frase.',
      },
    ],
  };
  for (const type of WARNING_TYPES) {
    const messages = buildWarningMessages(type, source, 'Ciências');
    assert(messages[0].content.includes('ironia'));
    assert(messages[0].content.includes('ficção'));
    assert(messages[0].content.includes('hipóteses'));
    assert(messages[1].content.includes(source.id));
    assert(messages[1].content.includes('refutar'));
  }
  const payload = {
    state: 'insufficient',
    reason: 'Citação com contexto de refutação.',
    guidance: 'Confira o contexto.',
    segments: [{ position: 0, quote: 'para refutar a frase' }],
  };
  assert.equal(validateWarningPayload(payload, source).segmentRefs[0].startMs, 0);
  assert.throws(() =>
    validateWarningPayload(
      { ...payload, segments: [{ position: 0, quote: 'trecho inventado' }] },
      source,
    ),
  );
  assert.throws(() => validateWarningPayload({ ...payload, verified: true }, source));
  assert.equal(
    validateWarningPayload({ ...payload, state: 'no_warning', segments: [] }, source).state,
    'no_warning',
  );
});
