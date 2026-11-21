import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { verifyRelease } from '../release/verify-release.mjs';

const root = new URL('../../', import.meta.url).pathname;

test('release 3.4 manifest: files, checksums, dependency order, guards, additivity and RLS', () => {
  const { manifest, problems } = verifyRelease('database/release/3.4/manifest.json', root);
  assert.deepEqual(problems, []);
  assert.equal(manifest.steps.length, 8);
  // Every 3.3/3.4 migration in the repository is in the release, in timestamp order.
  const all = readdirSync(new URL('database/migrations/', `file://${root}`)).filter((f) => f >= '20261121130000').sort();
  assert.deepEqual(manifest.steps.map((s) => s.migration.split('/').pop()), all);
});
