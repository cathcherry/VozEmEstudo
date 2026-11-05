import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadinessChecks, featureSchema, readinessFlagErrors, runReadinessChecks } from '../../backend/src/diagnostics/readiness.js';

function fixture({ missing, publicVideo = false } = {}) {
  const queries = [];
  const db = {
    from: (name) => ({ select: (columns, options) => {
      queries.push({ name, columns, options });
      return { error: name === missing ? { message: 'sensitive provider detail' } : null };
    } }),
    rpc: (name) => { assert.equal(name, 'current_permission_version'); return { data: 'test-version' }; },
    storage: { getBucket: (name) => ({ data: { public: name === 'study-videos' && publicVideo, file_size_limit: 104857600, allowed_mime_types: ['video/mp4'] } }) },
  };
  return { db, queries };
}

test('flags OFF tolerate absent optional modules and use metadata-only HEAD reads', async () => {
  const { db, queries } = fixture({ missing: 'study_annotations' });
  const results = await runReadinessChecks(createReadinessChecks(db, {}, 'audios', 'test-version'));
  assert(results.every((r) => r.ok));
  assert(!queries.some((q) => q.name === 'study_annotations'));
  assert(queries.every((q) => q.options.head === true && !q.options.count));
});

test('active modules fail safely for missing schema and public video bucket', async () => {
  const { db } = fixture({ missing: 'study_annotations', publicVideo: true });
  const flags = Object.fromEntries(Object.keys(featureSchema).map((key) => [key, true]));
  const results = await runReadinessChecks(createReadinessChecks(db, flags, 'audios', 'test-version'));
  assert(results.some((r) => !r.ok && r.label.includes('annotations')));
  assert(results.some((r) => !r.ok && r.label.includes('study-videos')));
  assert(!JSON.stringify(results).includes('sensitive provider detail'));
});

test('timeouts and thrown provider errors become bounded, redacted failures', async () => {
  const results = await runReadinessChecks([
    { label: 'hung', run: () => new Promise(() => {}) },
    { label: 'secret', run: () => { throw new Error('private-token'); } },
    { label: 'healthy', run: () => ({ data: null }) },
  ], 10);
  assert.deepEqual(results.map((r) => r.ok), [false, false, true]);
  assert(!JSON.stringify(results).includes('private-token'));
  assert(readinessFlagErrors({ social_basic: true }).length);
  assert(readinessFlagErrors({ quiz_review: true }).length);
  assert.deepEqual(readinessFlagErrors({ quiz_v2: true, quiz_review: true }), []);
});
