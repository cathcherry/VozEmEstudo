import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { assertPublicSupabaseKey } from '../src/validators/public-config.validator.js';

test('public key validation keeps empty setup, modern publishable and legacy anon contracts', () => {
  const jwt = (role) =>
    'eyJhbGciOiJIUzI1NiJ9.' +
    Buffer.from(JSON.stringify({ role })).toString('base64url') +
    '.fixture';
  for (const key of ['', 'sb_publishable_synthetic', jwt('anon')])
    assert.doesNotThrow(() => assertPublicSupabaseKey(key));
  for (const key of [
    jwt('service_role'),
    jwt('authenticated'),
    'gsk_' + 'synthetic',
    'eyJinvalid.fixture',
  ])
    assert.throws(
      () => assertPublicSupabaseKey(key),
      (error) => error.status === 503 && error.code === 'CONFIGURATION_ERROR',
    );
});

test('public config rejects a recognized private key placed in the public field', async () => {
  const privateKey = 'sb_' + 'secret_' + 'synthetic'.repeat(4);
  process.env.SUPABASE_URL = 'https://supabase.example.test';
  process.env.SUPABASE_PUBLISHABLE_KEY = privateKey;
  process.env.SUPABASE_SECRET_KEY = privateKey;
  const { app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/config`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(JSON.stringify(body).includes(privateKey), false);
    assert.equal(body.error.code, 'CONFIGURATION_ERROR');
    assert.equal(body.requestId, response.headers.get('x-request-id'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
