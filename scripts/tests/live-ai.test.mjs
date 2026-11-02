import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createPresentationServer } from '../presentation/server.mjs';

const mocks = {
  transcribe: async (_bytes, { durationMs }) => ({ text: 'A célula tem membrana e citoplasma.', language: 'pt', segments: [
    { position: 0, startMs: 0, endMs: durationMs, text: 'A célula tem membrana e citoplasma.' },
  ] }),
  summarize: async (text) => 'RESUMO DA FALA REAL: ' + text,
  questions: async (_text, count) => Array.from({ length: count }, (_, index) => ({
    statement: 'Qual é a estrutura ' + index + '?', options: ['A', 'B', 'C', 'D'], correctIndex: 2, explanation: 'Alternativa C.',
  })),
};

async function withServer(cb, providers = mocks) {
  const server = createPresentationServer({ liveAI: true, providers });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (route, method = 'GET', body, headers = {}) => fetch(base + route, {
    method,
    headers: { Authorization: 'Bearer presentation-local', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try { await cb({ request, base }); }
  finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
}

async function doneJob(request, jobId) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = await (await request('/api/jobs/' + jobId)).json();
    if (['CONCLUIDA', 'FALHOU'].includes(job.status)) return job;
    await new Promise((done) => setTimeout(done, 5));
  }
  throw Error('Job did not finish');
}

test('modo real: arquivo -> ASR -> revisão -> confirmação -> Groq resumo e questões, sem credenciais externas', () => withServer(async ({ request, base }) => {
  const config = await (await request('/api/config')).json();
  assert.equal(config.liveAi, true);
  assert.match(config.processingDisclosure.recognitionProvider, /Whisper/);
  assert.deepEqual(await (await request('/api/materials')).json(), []);
  const id = randomUUID(), path = `temp/presentation-local-user/${id}/fala.wav`;
  const upload = await fetch(`${base}/presentation/upload?path=${path}`, {
    method: 'POST', headers: { Authorization: 'Bearer presentation-local', 'Content-Type': 'audio/wav' }, body: Buffer.from('wav real bytes'),
  });
  assert.equal(upload.status, 200);
  const body = {
    id, title: 'Aula de biologia', questionCount: 3,
    permissionAccepted: true, permissionVersion: config.permissionDeclaration.version,
    storagePath: path, durationMs: 4000, extension: 'wav', retainAudio: true,
  };
  const create = await request('/api/materials', 'POST', body);
  assert.equal(create.status, 201);
  const process = await (await request('/api/materials/' + id + '/process', 'POST')).json();
  const asrJob = await doneJob(request, process.jobId);
  assert.equal(asrJob.status, 'CONCLUIDA', asrJob.error_message);
  let material = await (await request('/api/materials/' + id)).json();
  assert.equal(material.transcription.transcription_segments[0].current_text, 'A célula tem membrana e citoplasma.');
  assert.equal(material.review.state, 'awaiting_review');
  const sourceRevisionId = material.review.sourceRevisionId;
  const premature = await request('/api/materials/' + id + '/summaries', 'POST', { sourceRevisionId, idempotencyKey: 'early' });
  assert.equal(premature.status, 409);
  await request('/api/materials/' + id + '/transcription/confirm', 'POST', { sourceRevisionId });
  const summary = await (await request('/api/materials/' + id + '/summaries', 'POST', { sourceRevisionId, idempotencyKey: 'summary' })).json();
  assert.equal((await doneJob(request, summary.jobId)).status, 'CONCLUIDA');
  material = await (await request('/api/materials/' + id)).json();
  assert.equal(material.summaries[0].text, 'RESUMO DA FALA REAL: A célula tem membrana e citoplasma.');
  assert.equal(material.summaries[0].source_transcription_version_id, sourceRevisionId);
  const summaryRetry = await (await request('/api/materials/' + id + '/summaries', 'POST', { sourceRevisionId, idempotencyKey: 'summary' })).json();
  assert.equal(summaryRetry.jobId, summary.jobId);
  const qjob = await (await request('/api/materials/' + id + '/question-batches', 'POST', { sourceRevisionId, idempotencyKey: 'q3', count: 3 })).json();
  assert.equal((await doneJob(request, qjob.jobId)).status, 'CONCLUIDA');
  material = await (await request('/api/materials/' + id)).json();
  const answer = await (await request('/api/questions/' + material.questionBatches[0].questions[0].id + '/answer', 'POST', { selectedIndex: 2 })).json();
  assert.equal(answer.correct, true);
  assert.equal(answer.correctIndex, 2);
  assert.equal(answer.explanation, 'Alternativa C.');
  const page = await request('/nova-transcricao.html');
  assert.equal(page.status, 200);
  assert.equal((await request('/backend/.env.ia-local')).status, 404);
}));

test('modo real: falha do ASR não se converte em transcrição fictícia', () => withServer(async ({ request, base }) => {
  const config = await (await request('/api/config')).json();
  const id = randomUUID(), path = `temp/presentation-local-user/${id}/audio.wav`;
  await fetch(`${base}/presentation/upload?path=${path}`, { method: 'POST', headers: { Authorization: 'Bearer presentation-local' }, body: Buffer.from('audio') });
  await request('/api/materials', 'POST', { id, title: 'Audio', storagePath: path, questionCount: 3, durationMs: 1000, extension: 'wav', retainAudio: false, permissionAccepted: true, permissionVersion: config.permissionDeclaration.version });
  const queued = await (await request('/api/materials/' + id + '/process', 'POST')).json();
  const completed = await doneJob(request, queued.jobId);
  assert.equal(completed.status, 'FALHOU');
  assert.match(completed.error_message, /Indisponível para este teste/);
  const material = await (await request('/api/materials/' + id)).json();
  assert.equal(material.transcription, null);
}, { ...mocks, transcribe: async () => { throw new Error('Indisponível para este teste'); } }));
