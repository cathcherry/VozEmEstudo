import test from 'node:test';
import assert from 'node:assert/strict';

const origin = 'http://lease.fixture.invalid';
Object.assign(process.env, {
  SUPABASE_URL: origin,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_lease_fixture',
  SUPABASE_SECRET_KEY: 'lease-fixture-server-key',
  WORKER_STALE_LEASE_SECONDS: '600',
});
const { leaseSeconds } = await import('../src/config/env.js');
const jobs = await import('../src/repositories/job.repository.js');
const { executeClaimedJob } = await import('../src/jobs/job-runner.js');

function capture(handler) {
  const calls = [];
  const native = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method || 'GET', path: url.pathname, query: url.search, body });
    return handler({ url, body, method: init.method || 'GET' });
  };
  return { calls, restore: () => (globalThis.fetch = native) };
}
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

test('lease window: recovery on by default (600 s), 0 disables, small values use the 60 s minimum', () => {
  assert.equal(leaseSeconds(undefined), 600);
  assert.equal(leaseSeconds(''), 600);
  assert.equal(leaseSeconds('0'), 0);
  assert.equal(leaseSeconds('30'), 60);
  assert.equal(leaseSeconds('900'), 900);
});

test('claim recovers abandoned jobs, and falls back once when the database lacks the newer claim', async () => {
  const fx = capture(({ url, body }) => {
    if (url.pathname.endsWith('/rpc/claim_next_processing_job'))
      return 'p_stale_after_seconds' in body
        ? json({ code: 'PGRST202', message: 'Could not find the function' }, 404)
        : json([{ id: 'job-1', locked_by: body.p_worker_id }]);
    return json({}, 500);
  });
  try {
    assert.equal((await jobs.claimNextJob('w-1')).id, 'job-1');
    assert.deepEqual(fx.calls[0].body, { p_worker_id: 'w-1', p_stale_after_seconds: 600 });
    assert.deepEqual(fx.calls[1].body, { p_worker_id: 'w-1' });
    await jobs.claimNextJob('w-1');
    assert.equal(fx.calls.length, 3, 'the missing function is not retried on every poll');
    assert.deepEqual(fx.calls[2].body, { p_worker_id: 'w-1' });
  } finally {
    fx.restore();
  }
});

test('lease renewal only touches a running job still held by the same worker', async () => {
  const fx = capture(() => json([]));
  try {
    await jobs.renewJobLease('job-9', 'worker-a-1');
    const [call] = fx.calls;
    assert.equal(call.method, 'PATCH');
    assert.match(call.path, /\/rest\/v1\/processing_jobs$/);
    assert.match(call.query, /id=eq\.job-9/);
    assert.match(call.query, /locked_by=eq\.worker-a-1/);
    assert.match(call.query, /status=eq\.EM_EXECUCAO/);
    assert.deepEqual(Object.keys(call.body), ['locked_at']);
  } finally {
    fx.restore();
  }
});

test('if the failure itself cannot be recorded, the worker survives and leaves the job leased', async () => {
  const fx = capture(() => {
    throw new TypeError('fetch failed');
  });
  try {
    await executeClaimedJob({
      id: 'job-x',
      material_id: 'mat-x',
      type: 'PROCESSAMENTO_INICIAL',
      attempt_count: 1,
      max_attempts: 3,
      locked_by: 'worker-a-1',
    });
    // No status write succeeded, so nothing was marked failed or done: recovery reclaims it.
    assert(fx.calls.length > 0);
  } finally {
    fx.restore();
  }
});
