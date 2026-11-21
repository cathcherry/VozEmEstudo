import test from 'node:test';
import assert from 'node:assert/strict';
import { limitPerAccount } from '../src/middleware/rate-limit.middleware.js';

function run(middleware, user) {
  const headers = {};
  let result = 'next';
  middleware({ user: user && { id: user } }, { set: (k, v) => (headers[k] = v) }, (error) => {
    if (error) result = error;
  });
  return { result, headers };
}

test('per-account limit: counts each account separately, recovers after the window', () => {
  let time = 0;
  const limit = limitPerAccount({ name: 't', max: 2, windowMs: 60000, now: () => time });
  assert.equal(run(limit, 'a').result, 'next');
  assert.equal(run(limit, 'a').result, 'next');
  const blocked = run(limit, 'a');
  assert.equal(blocked.result.status, 429);
  assert.equal(blocked.result.code, 'RATE_LIMITED');
  assert.equal(blocked.headers['Retry-After'], '60');
  assert.equal(run(limit, 'b').result, 'next', 'another account is not affected');
  time = 60001;
  assert.equal(run(limit, 'a').result, 'next', 'window passed');
});

test('a limit of 0 is off; requests without an account are left to requireAuth', () => {
  const off = limitPerAccount({ name: 't', max: 0, windowMs: 1000 });
  for (let i = 0; i < 5; i++) assert.equal(run(off, 'a').result, 'next');
  const on = limitPerAccount({ name: 't', max: 1, windowMs: 1000 });
  assert.equal(run(on, null).result, 'next');
});
