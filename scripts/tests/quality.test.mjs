import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectFormatFiles, checkFormatFiles } from '../format-check.mjs';

test('format debt requires an exact historical hash; changed and new files fail', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'voz-format-fixture-'));
  try {
    const filename = path.join(directory, 'legacy.js');
    const original = 'const value=1;export {value};';
    await writeFile(filename, original);
    const baseline = {
      files: { 'legacy.js': createHash('sha256').update(original).digest('hex') },
    };
    const before = await checkFormatFiles([filename], baseline, directory);
    assert.deepEqual(before.legacyDebt, ['legacy.js']);
    assert.deepEqual(before.failures, []);
    await writeFile(filename, original + '\nconst other=2;');
    assert.deepEqual((await checkFormatFiles([filename], baseline, directory)).failures, [
      'legacy.js',
    ]);
    assert.deepEqual((await checkFormatFiles([filename], { files: {} }, directory)).failures, [
      'legacy.js',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('format scanning never reads an environment file, even when it looks like JSON', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'voz-format-exclusions-'));
  try {
    await writeFile(path.join(directory, '.env.private.json'), '{"private":"fixture"}');
    await writeFile(path.join(directory, 'safe.js'), 'export const safe = true;\n');
    assert.deepEqual(
      (await collectFormatFiles(directory)).map((file) => path.basename(file)),
      ['safe.js'],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
