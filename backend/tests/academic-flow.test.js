import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';
import { revisionIds } from './fixtures/academic-db.fixture.js';
import { PERMISSION_DECLARATION } from '../src/config/permission-declaration.js';

test('E02 HTTP and worker gates use real services, immutable PostgreSQL RPCs and fake provider transport', async (t) => {
  const f = createSupabaseHttpFixture(),
    nativeFetch = globalThis.fetch,
    providerRequests = [];
  process.env.SUPABASE_URL = f.origin;
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_e02_fixture_public';
  process.env.SUPABASE_SECRET_KEY = 'e02-fixture-server-key';
  process.env.GROQ_API_KEY = 'e02-fixture-llm-key';
  process.env.MOCK_EXTERNAL_SERVICES = 'false';
  let generationFailure = false,
    warningFailure = false,
    loseCommittedSummaryResponse = false;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === 'api.groq.com') {
      const payload = JSON.parse(options.body);
      providerRequests.push(payload);
      const system = payload.messages[0].content;
      if (generationFailure && !system.includes('avisos preliminares')) {
        return new Response(
          JSON.stringify({
            error: {
              message: 'Conteúdo sensível sintético que não deve ser persistido.',
              type: 'invalid_request_error',
            },
          }),
          { status: 503, headers: { 'Content-Type': 'application/json', 'retry-after': '0' } },
        );
      }
      if (warningFailure && system.includes('Identifique somente suspeitas'))
        return new Response(
          JSON.stringify({ error: { message: 'Synthetic sensitive warning failure' } }),
          { status: 503, headers: { 'Content-Type': 'application/json', 'retry-after': '0' } },
        );
      let content;
      if (warningFailure && system.includes('Compare a transcrição'))
        content = JSON.stringify({
          state: 'warning',
          reason: 'Referência impossível.',
          guidance: 'Confira.',
          segments: [{ position: 99, quote: 'Trecho inventado.' }],
        });
      else if (warningFailure && system.includes('avisos preliminares'))
        content = JSON.stringify({
          state: 'no_warning',
          reason: 'Nenhum indício nesta análise limitada.',
          guidance: 'Confira o contexto humano.',
          segments: [],
        });
      else if (system.includes('avisos preliminares'))
        content = JSON.stringify({
          state: 'insufficient',
          reason: 'Análise simulada com contexto limitado.',
          guidance: 'Confira a aula.',
          segments: [],
        });
      else if (payload.response_format) {
        const match = JSON.stringify(payload.messages).match(/(?:exatamente|Exatamente)\s+(\d+)/);
        const count = match ? Number(match[1]) : 3;
        content = JSON.stringify({
          questions: Array.from({ length: count }, (_, i) => ({
            statement: 'Questão sintética ' + i,
            options: ['A', 'B', 'C', 'D'],
            correctIndex: 0,
            explanation: 'Simulada.',
          })),
        });
      } else content = 'Resumo sintético de fonte fixa.';
      return new Response(
        JSON.stringify({
          id: 'fixture-completion',
          choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (loseCommittedSummaryResponse && url.pathname === '/rest/v1/rpc/commit_summary_admin') {
      const committed = await f.fetch(input, options);
      assert.equal(committed.status, 200);
      loseCommittedSummaryResponse = false;
      return new Response(
        JSON.stringify({ message: 'Sensitive synthetic lost database response' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return f.fetch(input, options);
  };
  const { app } = await import('../src/app.js');
  const { executeClaimedJob } = await import('../src/jobs/job-runner.js');
  const { finalizeAudioStorage } = await import('../src/services/audio.service.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(route, { method = 'GET', body, user = 'a' } = {}) {
    const result = await fetch(base + route, {
      method,
      headers: {
        Authorization: 'Bearer ' + identities[user].token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await result.json();
    assert(!JSON.stringify(payload).includes(process.env.SUPABASE_SECRET_KEY));
    return { status: result.status, body: payload };
  }
  const createBody = () => {
    const id = randomUUID();
    return {
      id,
      title: 'Aula sintética',
      subject: 'Física',
      originalFilename: 'fixture.wav',
      mimeType: 'audio/wav',
      extension: 'wav',
      sizeBytes: 1024,
      durationMs: 3000,
      questionCount: 3,
      retainAudio: false,
      storagePath: 'temp/' + identities.a.id + '/' + id + '/fixture.wav',
      permissionAccepted: true,
      permissionVersion: PERMISSION_DECLARATION.version,
    };
  };
  try {
    await t.test(
      'HTTP direct bypass and stale declaration receive 4xx with no upload/job/provider effects',
      async () => {
        const body = createBody();
        delete body.permissionAccepted;
        let result = await request('/api/materials', { method: 'POST', body });
        assert.equal(result.status, 422);
        assert.equal(result.body.error.code, 'PERMISSION_REQUIRED');
        result = await request('/api/materials', {
          method: 'POST',
          body: { ...body, permissionAccepted: true, permissionVersion: 'outdated' },
        });
        assert.equal(result.status, 409);
        assert.equal(result.body.error.code, 'PERMISSION_RECONFIRMATION_REQUIRED');
        assert.equal(providerRequests.length, 0);
        assert.deepEqual(f.state.effects, []);
      },
    );
    await t.test(
      'create records own versioned permission with retention OFF; duplicate process returns one initial job',
      async () => {
        const body = createBody();
        const result = await request('/api/materials', { method: 'POST', body });
        assert.equal(result.status, 201);
        assert.equal(
          f.state.tables.audio_files.find((row) => row.material_id === body.id).retain_original,
          false,
        );
        const permission = f.state.tables.material_permissions.find(
          (row) => row.material_id === body.id,
        );
        assert.equal(permission.user_id, identities.a.id);
        assert.equal(permission.declaration_version, PERMISSION_DECLARATION.version);
        const jobs = await Promise.all(
          [1, 2].map(() => request('/api/materials/' + body.id + '/process', { method: 'POST' })),
        );
        assert.equal(jobs[0].status, 202);
        assert.equal(jobs[0].body.jobId, jobs[1].body.jobId);
        const { db } = await f.getDatabase();
        await db.query("update public.materials set status='PROCESSANDO' where id=$1", [body.id]);
        f.state.tables.materials.find((row) => row.id === body.id).status = 'PROCESSANDO';
        const running = await request('/api/materials/' + body.id + '/process', { method: 'POST' });
        assert.equal(running.status, 202);
        assert.equal(running.body.jobId, jobs[0].body.jobId);
      },
    );
    await t.test(
      'cross-account permission, review, confirmation, warnings and generation always return 404',
      async () => {
        for (const [suffix, method, body] of [
          [
            '/permission',
            'POST',
            { permissionAccepted: true, permissionVersion: PERMISSION_DECLARATION.version },
          ],
          ['/transcription/review', 'GET'],
          ['/transcription/confirm', 'POST', { sourceRevisionId: revisionIds.a }],
          ['/transcription/warnings', 'POST', { sourceRevisionId: revisionIds.a }],
          ['/summaries', 'POST', { sourceRevisionId: revisionIds.a }],
          ['/question-batches', 'POST', { count: 3, sourceRevisionId: revisionIds.a }],
        ])
          assert.equal(
            (
              await request('/api/materials/' + resourceIds.materialA + suffix, {
                method,
                body,
                user: 'b',
              })
            ).status,
            404,
          );
      },
    );
    await t.test(
      'worker rejects historical generation without source before calling LLM',
      async () => {
        const before = providerRequests.length;
        await executeClaimedJob({
          id: resourceIds.jobA,
          material_id: resourceIds.materialA,
          type: 'REGERAR_RESUMO',
          params: {},
          attempt_count: 1,
          max_attempts: 3,
        });
        assert.equal(providerRequests.length, before);
        assert.equal(
          f.state.tables.processing_jobs.find((row) => row.id === resourceIds.jobA).status,
          'FALHOU',
        );
      },
    );
    await t.test(
      'confirmation is idempotent; source is fixed even when the text is edited in the queue',
      async () => {
        const confirmation = await request(
          '/api/materials/' + resourceIds.materialA + '/transcription/confirm',
          { method: 'POST', body: { sourceRevisionId: revisionIds.a } },
        );
        const repeated = await request(
          '/api/materials/' + resourceIds.materialA + '/transcription/confirm',
          { method: 'POST', body: { sourceRevisionId: revisionIds.a } },
        );
        assert.equal(confirmation.status, 200);
        assert.equal(confirmation.body.confirmation.id, repeated.body.confirmation.id);
        const job = await request('/api/materials/' + resourceIds.materialA + '/summaries', {
          method: 'POST',
          body: { sourceRevisionId: revisionIds.a, idempotencyKey: randomUUID() },
        });
        assert.equal(job.status, 202);
        const material = await request('/api/materials/' + resourceIds.materialA);
        const segment = material.body.transcription.transcription_segments[0];
        const edit = await request('/api/materials/' + resourceIds.materialA + '/transcription', {
          method: 'PATCH',
          body: {
            expectedRevision: 1,
            segments: [{ id: segment.id, text: 'Texto alterado enquanto a tarefa aguarda.' }],
          },
        });
        assert.equal(edit.status, 200);
        const queued = f.state.tables.processing_jobs.find((row) => row.id === job.body.jobId);
        await executeClaimedJob({ ...queued, attempt_count: 1, max_attempts: 3 });
        const generated = f.state.tables.summary_versions.find(
          (row) => row.processing_job_id === queued.id,
        );
        assert.equal(generated.source_transcription_version_id, revisionIds.a);
        assert.equal(generated.source_transcription_revision, 1);
        const summaryRequest = providerRequests.find((payload) => !payload.response_format);
        assert(
          summaryRequest.messages.some((message) =>
            message.content.includes('Energia é conservada.'),
          ),
        );
        assert(!JSON.stringify(summaryRequest).includes('Texto alterado enquanto'));
        const state = await request(
          '/api/materials/' + resourceIds.materialA + '/transcription/review',
        );
        assert.equal(state.body.state, 'awaiting_review');
        const blocked = await request('/api/materials/' + resourceIds.materialA + '/summaries', {
          method: 'POST',
          body: { sourceRevisionId: state.body.sourceRevisionId },
        });
        assert.equal(blocked.status, 409);
        assert.equal(blocked.body.error.code, 'TRANSCRIPTION_CONFIRMATION_REQUIRED');
      },
    );
    await t.test(
      'LLM failure preserves transcription and summary history; safe retry uses the same frozen source',
      async () => {
        const state = await request(
          '/api/materials/' + resourceIds.materialA + '/transcription/review',
        );
        await request('/api/materials/' + resourceIds.materialA + '/transcription/confirm', {
          method: 'POST',
          body: { sourceRevisionId: state.body.sourceRevisionId },
        });
        const response = await request('/api/materials/' + resourceIds.materialA + '/summaries', {
          method: 'POST',
          body: { sourceRevisionId: state.body.sourceRevisionId },
        });
        const job = f.state.tables.processing_jobs.find((row) => row.id === response.body.jobId);
        generationFailure = true;
        const transcripts = f.state.tables.transcriptions.length,
          summaries = f.state.tables.summary_versions.length;
        await executeClaimedJob({ ...job, attempt_count: 1, max_attempts: 3 });
        assert.equal(
          f.state.tables.processing_jobs.find((row) => row.id === job.id).status,
          'AGUARDANDO_REPETICAO',
        );
        assert.equal(f.state.tables.transcriptions.length, transcripts);
        assert.equal(f.state.tables.summary_versions.length, summaries);
        assert(
          !JSON.stringify(f.state.tables.processing_jobs).includes('Conteúdo sensível sintético'),
        );
        generationFailure = false;
        await executeClaimedJob({ ...job, attempt_count: 2, max_attempts: 3 });
        await executeClaimedJob({ ...job, attempt_count: 3, max_attempts: 3 });
        assert.equal(
          f.state.tables.summary_versions.filter((row) => row.processing_job_id === job.id).length,
          1,
        );
        assert.equal(
          f.state.tables.summary_versions.find((row) => row.processing_job_id === job.id)
            .source_transcription_version_id,
          state.body.sourceRevisionId,
        );
      },
    );
    await t.test(
      'lost database response after commit retries safely without a second summary or LLM call',
      async () => {
        const state = await request(
          '/api/materials/' + resourceIds.materialA + '/transcription/review',
        );
        const response = await request('/api/materials/' + resourceIds.materialA + '/summaries', {
          method: 'POST',
          body: { sourceRevisionId: state.body.sourceRevisionId, idempotencyKey: randomUUID() },
        });
        assert.equal(response.status, 202);
        const job = f.state.tables.processing_jobs.find((row) => row.id === response.body.jobId);
        loseCommittedSummaryResponse = true;
        await executeClaimedJob({ ...job, attempt_count: 1, max_attempts: 3 });
        const failedResponse = f.state.tables.processing_jobs.find((row) => row.id === job.id);
        assert.equal(failedResponse.status, 'AGUARDANDO_REPETICAO');
        assert.equal(failedResponse.error_code, 'DATABASE_TEMPORARY_ERROR');
        assert(!failedResponse.error_message.includes('Sensitive synthetic'));
        assert.equal(
          f.state.tables.summary_versions.filter((row) => row.processing_job_id === job.id).length,
          1,
        );
        const calls = providerRequests.length;
        await executeClaimedJob({ ...job, attempt_count: 2, max_attempts: 3 });
        assert.equal(providerRequests.length, calls);
        assert.equal(
          f.state.tables.processing_jobs.find((row) => row.id === job.id).status,
          'CONCLUIDA',
        );
        assert.equal(
          f.state.tables.summary_versions.filter((row) => row.processing_job_id === job.id).length,
          1,
        );
      },
    );
    await t.test(
      'question worker commits exact 3/5/10/20 batches from the confirmed source and deduplicates completion',
      async () => {
        const state = await request(
          '/api/materials/' + resourceIds.materialA + '/transcription/review',
        );
        for (const count of [3, 5, 10, 20]) {
          const key = randomUUID();
          const queued = await request(
            '/api/materials/' + resourceIds.materialA + '/question-batches',
            {
              method: 'POST',
              body: { count, sourceRevisionId: state.body.sourceRevisionId, idempotencyKey: key },
            },
          );
          assert.equal(queued.status, 202);
          const replay = await request(
            '/api/materials/' + resourceIds.materialA + '/question-batches',
            {
              method: 'POST',
              body: { count, sourceRevisionId: state.body.sourceRevisionId, idempotencyKey: key },
            },
          );
          assert.equal(replay.body.jobId, queued.body.jobId);
          const job = f.state.tables.processing_jobs.find((row) => row.id === queued.body.jobId);
          await executeClaimedJob({ ...job, attempt_count: 1, max_attempts: 3 });
          const batch = f.state.tables.question_batches.find(
            (row) => row.processing_job_id === job.id,
          );
          assert(batch);
          assert.equal(batch.generated_count, count);
          assert.equal(batch.source_transcription_version_id, state.body.sourceRevisionId);
          assert.equal(
            f.state.tables.questions.filter((row) => row.batch_id === batch.id).length,
            count,
          );
          const before = providerRequests.length;
          await executeClaimedJob({ ...job, attempt_count: 2, max_attempts: 3 });
          assert.equal(providerRequests.length, before);
          assert.equal(
            f.state.tables.question_batches.filter((row) => row.processing_job_id === job.id)
              .length,
            1,
          );
        }
      },
    );
    await t.test(
      'warning analyses fail independently, reject forged references and reuse a recorded operation',
      async () => {
        const state = await request(
          '/api/materials/' + resourceIds.materialA + '/transcription/review',
        );
        const key = randomUUID();
        warningFailure = true;
        const result = await request(
          '/api/materials/' + resourceIds.materialA + '/transcription/warnings',
          {
            method: 'POST',
            body: { sourceRevisionId: state.body.sourceRevisionId, idempotencyKey: key },
          },
        );
        assert.equal(result.status, 200);
        assert.equal(result.body.length, 3);
        assert.equal(result.body.find((row) => row.type === 'educational').state, 'no_warning');
        assert.equal(result.body.find((row) => row.type === 'topic_alignment').state, 'error');
        assert.equal(result.body.find((row) => row.type === 'factual_suspicion').state, 'error');
        assert(
          result.body.every(
            (row) =>
              row.sourceRevisionId === state.body.sourceRevisionId && row.segmentRefs.length === 0,
          ),
        );
        assert(!JSON.stringify(result.body).includes('Synthetic sensitive warning failure'));
        const calls = providerRequests.length;
        const replay = await request(
          '/api/materials/' + resourceIds.materialA + '/transcription/warnings',
          {
            method: 'POST',
            body: { sourceRevisionId: state.body.sourceRevisionId, idempotencyKey: key },
          },
        );
        assert.equal(replay.status, 200);
        assert.deepEqual(replay.body, result.body);
        assert.equal(providerRequests.length, calls);
        warningFailure = false;
      },
    );
    await t.test(
      'retention reconciles a successful Storage move after a database failure, without deleting media',
      async () => {
        const audio = {
          ...f.state.tables.audio_files.find((row) => row.material_id === resourceIds.materialB),
        };
        audio.storage_path = 'temp/' + identities.b.id + '/' + audio.material_id + '/fixture.wav';
        f.state.objects.set(audio.storage_path, {
          size: audio.size_bytes,
          contentType: 'audio/wav',
        });
        f.state.failures.audio_files = 'Sensitive synthetic database failure';
        await assert.rejects(
          finalizeAudioStorage(audio),
          (error) => error.code === 'STORAGE_FINALIZATION_PENDING' && error.retryable,
        );
        assert(!f.state.objects.has(audio.storage_path));
        const retained = 'retained/' + identities.b.id + '/' + audio.material_id + '/fixture.wav';
        assert(f.state.objects.has(retained));
        delete f.state.failures.audio_files;
        assert.equal(await finalizeAudioStorage(audio), retained);
        assert(f.state.objects.has(retained));
        assert.equal(
          f.state.tables.audio_files.find((row) => row.id === audio.id).storage_path,
          retained,
        );
      },
    );
    await t.test(
      'initial job ends after existing ASR snapshot with three independent warnings and no new summaries/questions',
      async () => {
        const { db } = await f.getDatabase();
        await db.query("update public.materials set status='PARCIAL' where id=$1", [
          resourceIds.materialB,
        ]);
        f.state.tables.materials.find((row) => row.id === resourceIds.materialB).status = 'PARCIAL';
        const job = (
          await db.query(
            "select public.enqueue_processing_job_admin($1,$2,'PROCESSAMENTO_INICIAL',$3,null,$4,$5,3) as data",
            [
              identities.b.id,
              resourceIds.materialB,
              JSON.stringify({ questionCount: 5 }),
              randomUUID(),
              PERMISSION_DECLARATION.version,
            ],
          )
        ).rows[0].data;
        f.state.tables.processing_jobs.push(job);
        const summaries = f.state.tables.summary_versions.length,
          batches = f.state.tables.question_batches.length,
          before = providerRequests.length;
        await executeClaimedJob({ ...job, attempt_count: 1, max_attempts: 3 });
        assert.equal(f.state.tables.summary_versions.length, summaries);
        assert.equal(f.state.tables.question_batches.length, batches);
        assert.equal(providerRequests.length - before, 3);
        assert.equal(
          f.state.tables.processing_jobs.find((row) => row.id === job.id).status,
          'CONCLUIDA',
        );
        assert.equal(
          f.state.tables.content_warnings.filter((row) => row.material_id === resourceIds.materialB)
            .length,
          3,
        );
        const warningCalls = providerRequests.length;
        await executeClaimedJob({ ...job, attempt_count: 2, max_attempts: 3 });
        assert.equal(providerRequests.length, warningCalls);
        assert.equal(
          f.state.tables.content_warnings.filter((row) => row.material_id === resourceIds.materialB)
            .length,
          3,
        );
      },
    );
  } finally {
    globalThis.fetch = nativeFetch;
    await new Promise((resolve) => server.close(resolve));
    await f.close();
  }
});
