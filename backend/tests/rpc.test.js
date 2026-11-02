import test from 'node:test';
import assert from 'node:assert/strict';

test('E02 RPC transient failures are retryable; schema and permission failures remain fail-closed', async () => {
  process.env.SUPABASE_URL = 'http://rpc.e02.invalid';
  process.env.SUPABASE_SECRET_KEY = 'e02-fixture-server-key';
  const nativeFetch = globalThis.fetch;
  let failure;
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, process.env.SUPABASE_URL);
    return new Response(JSON.stringify(failure.body), {
      status: failure.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const { rpc } = await import('../src/repositories/rpc.js');
    for (const [status, code] of [
      [503, 'FIXTURE_UNAVAILABLE'],
      [429, 'FIXTURE_LIMIT'],
      [408, 'FIXTURE_TIMEOUT'],
      [400, '40001'],
      [400, '40P01'],
      [400, '55P03'],
      [400, '08006'],
    ]) {
      failure = { status, body: { code, message: 'Sensitive synthetic database error' } };
      await assert.rejects(
        rpc('fixture_operation', {}),
        (error) =>
          error.code === 'DATABASE_TEMPORARY_ERROR' &&
          error.status === 503 &&
          error.retryable &&
          !error.message.includes('Sensitive synthetic'),
      );
    }
    for (const [code, message, expectedCode, expectedStatus] of [
      ['PGRST202', 'Sensitive synthetic missing RPC', 'SCHEMA_UPGRADE_REQUIRED', 503],
      ['P0001', 'PERMISSION_REQUIRED', 'PERMISSION_REQUIRED', 422],
      ['P0001', 'REVISION_CONFLICT', 'REVISION_CONFLICT', 409],
    ]) {
      failure = { status: 503, body: { code, message } };
      await assert.rejects(
        rpc('fixture_operation', {}),
        (error) =>
          error.code === expectedCode && error.status === expectedStatus && !error.retryable,
      );
    }
  } finally {
    globalThis.fetch = nativeFetch;
  }
});
