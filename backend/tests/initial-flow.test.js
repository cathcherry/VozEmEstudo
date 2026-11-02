import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { identities } from './fixtures/ownership.fixture.js';
import { PERMISSION_DECLARATION } from '../src/config/permission-declaration.js';

test('upload -> mock ASR -> durable revision -> retention retry -> human review, with no automatic derivatives', async () => {
  const fixture = createSupabaseHttpFixture();
  const nativeFetch = globalThis.fetch;
  process.env.SUPABASE_URL = fixture.origin;
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_e02_mock_public';
  process.env.SUPABASE_SECRET_KEY = 'e02-fixture-server-key';
  process.env.MOCK_EXTERNAL_SERVICES = 'true';
  globalThis.fetch = fixture.fetch;
  const { app } = await import('../src/app.js');
  const { executeClaimedJob } = await import('../src/jobs/job-runner.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const id = randomUUID(),
    path = 'temp/' + identities.a.id + '/' + id + '/fixture.wav';
  const request = async (route, body) => {
    const response = await fetch(base + route, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: 'Bearer ' + identities.a.token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const created = await request('/api/materials', {
      id,
      title: 'Gravação sintética',
      subject: 'Física',
      originalFilename: 'fixture.wav',
      mimeType: 'audio/wav',
      extension: 'wav',
      sizeBytes: 1024,
      durationMs: 3000,
      questionCount: 3,
      retainAudio: false,
      storagePath: path,
      permissionAccepted: true,
      permissionVersion: PERMISSION_DECLARATION.version,
    });
    assert.equal(created.status, 201);
    fixture.state.objects.set(path, { size: 1024, contentType: 'audio/wav' });
    const queued = await request('/api/materials/' + id + '/process', {});
    assert.equal(queued.status, 202);
    const job = fixture.state.tables.processing_jobs.find((row) => row.id === queued.body.jobId);
    fixture.state.failures.storage_remove = 'Synthetic sensitive failure';
    await executeClaimedJob({ ...job, attempt_count: 1, max_attempts: 3 });
    assert.equal(
      fixture.state.tables.processing_jobs.find((row) => row.id === job.id).status,
      'AGUARDANDO_REPETICAO',
    );
    assert(fixture.state.tables.transcriptions.some((row) => row.material_id === id));
    assert(fixture.state.objects.has(path));
    delete fixture.state.failures.storage_remove;
    await executeClaimedJob({ ...job, attempt_count: 2, max_attempts: 3 });
    assert.equal(
      fixture.state.tables.processing_jobs.find((row) => row.id === job.id).status,
      'CONCLUIDA',
    );
    assert.equal(fixture.state.effects.filter((effect) => effect.method === 'DOWNLOAD').length, 1);
    assert(!fixture.state.objects.has(path));
    assert.equal(
      fixture.state.tables.audio_files.find((row) => row.material_id === id).storage_path,
      null,
    );
    assert.equal(
      fixture.state.tables.summary_versions.filter((row) => row.material_id === id).length,
      0,
    );
    assert.equal(
      fixture.state.tables.question_batches.filter((row) => row.material_id === id).length,
      0,
    );
    const material = await request('/api/materials/' + id);
    assert.equal(material.status, 200);
    assert.equal(material.body.signedAudioUrl, null);
    assert.equal(material.body.review.state, 'awaiting_review');
    assert(material.body.review.sourceRevisionId);
    assert.equal(material.body.warnings.length, 3);
    assert(
      material.body.warnings.every(
        (warning) => warning.state === 'insufficient' && warning.model === 'mock',
      ),
    );
    assert.equal(
      fixture.state.tables.transcription_versions.filter(
        (version) => version.transcription_id === material.body.transcription.id,
      ).length,
      1,
    );
    const refused = await request('/api/materials/' + id + '/question-batches', {
      count: 3,
      sourceRevisionId: material.body.review.sourceRevisionId,
    });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'TRANSCRIPTION_CONFIRMATION_REQUIRED');
    assert(
      !JSON.stringify(fixture.state.tables.processing_jobs).includes('Synthetic sensitive failure'),
    );
  } finally {
    globalThis.fetch = nativeFetch;
    await new Promise((resolve) => server.close(resolve));
    await fixture.close();
  }
});
