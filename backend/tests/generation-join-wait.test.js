import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForGenerationJob } from '../src/services/material.service.js';

// Found on staging (3.4 E2E): five equivalent requests at once → 1 start + 4 joins, but the joins
// arrived before the start had attached its job and answered 202 without a jobId.
test('a join waits for the job the starting request is creating', async () => {
  let calls = 0;
  const waits = [];
  const job = await waitForGenerationJob(
    async () => {
      calls += 1;
      return calls < 3 ? null : { id: 'job-1', status: 'PENDENTE' };
    },
    { sleep: async (ms) => waits.push(ms) },
  );
  assert.equal(job.id, 'job-1');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [250, 250]);
});

test('gives up after the attempts (the caller keeps the old answer) and survives lookup errors', async () => {
  let calls = 0;
  const job = await waitForGenerationJob(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary');
      return null;
    },
    { attempts: 4, sleep: async () => {} },
  );
  assert.equal(job, null);
  assert.equal(calls, 4);
});
