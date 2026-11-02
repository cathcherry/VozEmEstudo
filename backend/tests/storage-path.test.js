import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeStoragePath } from '../src/validators/storage-path.validator.js';
import { createAudioSignedUrl, downloadAudioBuffer, finalizeAudioStorage } from '../src/services/audio.service.js';

test('accepts raw storage keys used by current and legacy uploads', () => {
  for (const path of ['temp/user/material/fixture.wav', 'retained/user/material/recording.mp3', 'retained/user/material/aula de ciências.wav', 'temp/user/material/.recording.wav']) {
    assert.equal(assertSafeStoragePath(path), path);
  }
});

test('rejects URL normalization and encoded traversal before using an admin client', () => {
  for (const path of [null, 123, '', '/temp/user/material/file.wav', 'temp/user/material/../../../other/file.wav', 'temp/user/material/%2e%2e/file.wav', 'temp/user/material/%252e%252e/file.wav', 'temp/user/material/..%2ffile.wav', 'temp/user/material/..\\file.wav', 'temp/user/material/file.wav?download=true', 'temp/user/material/file.wav#fragment', 'temp/user/material/.\n./file.wav', 'temp/user/material//file.wav']) {
    assert.throws(() => assertSafeStoragePath(path), (error) => error.status === 403 && error.code === 'FORBIDDEN');
  }
});

test('blocks unsafe stored keys across signing, download and finalization', async () => {
  const path = 'temp/user/material/../../../retained/other/file.wav';
  const forbidden = (error) => error.status === 403 && error.code === 'FORBIDDEN';
  await assert.rejects(createAudioSignedUrl(path), forbidden);
  await assert.rejects(downloadAudioBuffer(path), forbidden);
  for (const retain of [true, false]) {
    await assert.rejects(finalizeAudioStorage({ storage_path: path, retain_original: retain }), forbidden);
  }
  assert.equal(await createAudioSignedUrl(null), null);
  assert.equal(await finalizeAudioStorage({ storage_path: null }), null);
});
