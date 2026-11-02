import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPresentationServer } from '../presentation/server.mjs';

async function withServer(callback) {
  const server = createPresentationServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(route, method = 'GET', body, extra = {}) {
    return fetch(base + route, {
      method,
      headers: {
        Authorization: 'Bearer presentation-local',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  try {
    await callback(request, base);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
test('presentation serves current UI, separate adapter and no remote configuration', () =>
  withServer(async (request) => {
    const config = await (await request('/api/config')).json();
    assert.equal(config.presentationMode, true);
    assert.equal(config.supabaseUrl, undefined);
    const page = await request('/painel.html');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /presentation\/banner.js/);
    assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.match(
      await (await request('/js/api/supabase-browser.js')).text(),
      /presentation-local-user/,
    );
    assert.equal(
      (await request('/api/materials', 'GET', undefined, { Authorization: '' })).status,
      401,
    );
    assert.equal(
      (await request('/api/materials', 'GET', undefined, { Origin: 'https://example.test' }))
        .status,
      403,
    );
    assert.equal((await request('/package.json')).status, 404);
    assert.equal((await request('/backend/.env')).status, 404);
  }));
test('edit, confirmation, snapshot, retry, quiz and restore work in the demo', () =>
  withServer(async (request) => {
    const material = (await (await request('/api/materials')).json())[0],
      prefix = '/api/materials/' + material.id;
    const oldSource = material.review.sourceRevisionId;
    const saved = await request(prefix + '/transcription', 'PATCH', {
      expectedRevision: 1,
      segments: [
        {
          id: material.transcription.transcription_segments[0].id,
          text: 'Texto editado na apresentação.',
        },
      ],
    });
    assert.equal(saved.status, 200);
    assert.equal(
      (
        await request(prefix + '/summaries', 'POST', {
          sourceRevisionId: oldSource,
          idempotencyKey: 'first',
        })
      ).status,
      409,
    );
    const edited = await (await request(prefix)).json();
    assert.equal(edited.review.state, 'awaiting_review');
    assert.equal(edited.summaries[0].stale, true);
    const sourceRevisionId = edited.review.sourceRevisionId;
    assert.equal(
      (await request(prefix + '/transcription/confirm', 'POST', { sourceRevisionId })).status,
      200,
    );
    const payload = { sourceRevisionId, idempotencyKey: 'questions', count: 5 };
    const first = await (await request(prefix + '/question-batches', 'POST', payload)).json();
    const second = await (await request(prefix + '/question-batches', 'POST', payload)).json();
    assert.deepEqual(first, second);
    const generated = await (await request(prefix)).json();
    assert.equal(generated.questionBatches.length, 2);
    assert.equal(generated.questionBatches[0].questions.length, 5);
    assert.equal(generated.questionBatches[0].source_transcription_version_id, sourceRevisionId);
    const questionId = generated.questionBatches[0].questions[0].id;
    assert.equal(
      (
        await (
          await request('/api/questions/' + questionId + '/answer', 'POST', { selectedIndex: 0 })
        ).json()
      ).correct,
      true,
    );
    assert.equal((await request(prefix + '/transcription/versions/1/restore', 'POST')).status, 200);
    const restored = await (await request(prefix)).json();
    assert.equal(restored.review.revision, 3);
    assert.equal(restored.review.state, 'awaiting_review');
    assert.equal((await (await request(prefix + '/transcription/versions')).json()).length, 3);
  }));
test('demo media range and upload permission guard', () =>
  withServer(async (request) => {
    assert.equal((await request('/api/materials', 'POST', {})).status, 422);
    const audio = await request('/presentation/tone.wav', 'GET', undefined, {
      Range: 'bytes=0-43',
    });
    assert.equal(audio.status, 206);
    assert.equal((await audio.arrayBuffer()).byteLength, 44);
  }));
