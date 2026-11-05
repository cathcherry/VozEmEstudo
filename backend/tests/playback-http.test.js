import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';

test('E07 HTTP protects registration, signed playback, retry and removal between two accounts', async () => {
  const fixture = createSupabaseHttpFixture();
  const nativeFetch = globalThis.fetch;
  process.env.SUPABASE_URL = fixture.origin;
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_e07_fixture';
  process.env.SUPABASE_SECRET_KEY = 'e07-fixture-server-key';
  process.env.FEATURE_MP4_RETENTION = 'true';
  process.env.MOCK_EXTERNAL_SERVICES = 'true';
  fixture.state.tables.material_videos = [];
  const material = resourceIds.materialA;
  const path = `original/${identities.a.id}/${material}/source.mp4`;
  fixture.state.objects.set(path, { size: 1024, contentType: 'video/mp4' });
  globalThis.fetch = fixture.fetch;
  const { app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/materials/${material}`;
  async function request(suffix, method = 'GET', body, user = 'a') {
    const result = await fetch(base + suffix, { method,
      headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${identities[user].token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: result.status, body: result.status === 204 ? null : await result.json() };
  }
  const input = { storagePath: path, originalName: 'aula.mp4', sizeBytes: 1024,
    durationMs: 60000, clipStartMs: 30000, clipEndMs: 33000 };
  try {
    assert.equal((await request('/playback', 'GET', null, null)).status, 401);
    for (const [suffix, method, body] of [['/playback', 'GET'], ['/video', 'POST', input], ['/video', 'DELETE']]) {
      const before = fixture.state.effects.length;
      const signed = fixture.state.signedRequests.length;
      const result = await request(suffix, method, body, 'b');
      assert([403, 404].includes(result.status));
      assert.equal(fixture.state.effects.length, before);
      assert.equal(fixture.state.signedRequests.length, signed);
    }
    assert.equal((await request('/video', 'POST', input)).status, 201);
    assert.equal((await request('/video', 'POST', input)).status, 201);
    assert.equal(fixture.state.tables.material_videos.length, 1);
    const playback = await request('/playback');
    assert.equal(playback.status, 200);
    assert.equal(playback.body.video.clipStartMs, 30000);
    assert(playback.body.signedAudioUrl); assert(playback.body.signedVideoUrl);
    assert(fixture.state.signedRequests.every((item) => item.expiresIn === 600));
    assert.equal((await request('/video', 'DELETE')).status, 204);
    assert.equal(fixture.state.tables.material_videos.length, 0);
    assert.equal(fixture.state.objects.has(path), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fixture.close(); globalThis.fetch = nativeFetch;
  }
});
