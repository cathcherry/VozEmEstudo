import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoService } from '../src/services/video.service.js';
import { validateVideo } from '../src/validators/video.validator.js';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const material = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const input = { storagePath: `original/${owner}/${material}/source.mp4`, originalName: 'aula.mp4',
  sizeBytes: 1000, durationMs: 90000, clipStartMs: 30000, clipEndMs: 40000 };
const row = { storage_path: input.storagePath, original_name: input.originalName,
  size_bytes: 1000, duration_ms: 90000, clip_start_ms: 30000, clip_end_ms: 40000 };
function setup(overrides = {}, owned = async () => ({ audio_files: [{ duration_ms: 10000 }] })) {
  const calls = [];
  const store = {
    getOwnedVideo: async (...args) => { calls.push(['get', ...args]); return null; },
    videoObjectInfo: async (path) => { calls.push(['info', path]); return { data: { size: 1000, contentType: 'video/mp4' } }; },
    insertOwnedVideo: async (...args) => { calls.push(['insert', ...args]); return row; },
    signVideo: async (path) => { calls.push(['sign', path]); return 'signed-url'; },
    removeVideoObject: async (path) => { calls.push(['remove-object', path]); },
    deleteOwnedVideo: async (...args) => { calls.push(['delete-row', ...args]); },
    ...overrides,
  };
  return { service: buildVideoService(store, owned), calls };
}
test('MP4 registration validates uploaded object and records the original timeline offset', async () => {
  const { service, calls } = setup();
  const result = await service.attach(owner, material, input);
  assert.deepEqual(calls.map((call) => call[0]), ['get', 'info', 'insert']);
  assert.deepEqual(calls[2].slice(1), [owner, material, input]);
  assert.equal(result.clipStartMs, 30000);
  assert.equal(result.clipEndMs, 40000);
  assert(!Object.hasOwn(result, 'storagePath'));
});
test('registration retry returns the same metadata without overwriting original bytes', async () => {
  const { service, calls } = setup({ getOwnedVideo: async () => row });
  await service.attach(owner, material, input);
  assert.equal(calls.length, 0);
  await assert.rejects(service.attach(owner, material, { ...input, originalName: 'outra.mp4' }),
    (error) => error.code === 'VIDEO_CONFLICT');
});
test('foreign account cannot register, sign or remove a video', async () => {
  const { service, calls } = setup({}, async () => { throw new Error('NOT_FOUND'); });
  await assert.rejects(service.attach(owner, material, input), /NOT_FOUND/);
  await assert.rejects(service.playback(owner, material), /NOT_FOUND/);
  await assert.rejects(service.remove(owner, material), /NOT_FOUND/);
  assert.equal(calls.length, 0);
});
test('invalid, foreign and encoded paths, sizes and ranges are rejected', () => {
  for (const patch of [
    { storagePath: `original/other/${material}/source.mp4` }, { storagePath: input.storagePath.replace('source', '%2e%2e/source') },
    { storagePath: input.storagePath.replace('source', '../source') },
    { sizeBytes: 104857601 }, { clipStartMs: 40000 }, { clipEndMs: 90001 },
    { user_id: owner }, { durationMs: 7200001 },
  ]) assert.throws(() => validateVideo({ ...input, ...patch }, owner, material));
});
test('range must correspond to prepared audio before any Storage access', async () => {
  const { service, calls } = setup({}, async () => ({ audio_files: [{ duration_ms: 5000 }] }));
  await assert.rejects(service.attach(owner, material, input), (error) => error.code === 'VIDEO_RANGE_CONFLICT');
  assert.equal(calls.length, 0);
});
test('missing object, wrong content type or size blocks registration', async () => {
  for (const response of [{ error: new Error('missing') },
    { data: { size: 999, contentType: 'video/mp4' } }, { data: { size: 1000, contentType: 'text/html' } }]) {
    const { service, calls } = setup({ videoObjectInfo: async () => response });
    await assert.rejects(service.attach(owner, material, input), (error) => error.code === 'VIDEO_UPLOAD_REQUIRED');
    assert(!calls.some((call) => call[0] === 'insert'));
  }
});
test('signed playback uses only the owned stored path and returns clip metadata', async () => {
  const { service, calls } = setup({ getOwnedVideo: async () => row });
  const result = await service.playback(owner, material);
  assert.equal(result.signedVideoUrl, 'signed-url');
  assert.equal(result.video.durationMs, 90000);
  assert.deepEqual(calls, [['sign', input.storagePath]]);
});
test('corrupt stored path is never signed or removed', async () => {
  const { service, calls } = setup({ getOwnedVideo: async () => ({ ...row, storage_path: 'original/foreign/file.mp4' }) });
  await assert.rejects(service.playback(owner, material), (error) => error.code === 'VIDEO_PATH_CONFLICT');
  await assert.rejects(service.remove(owner, material), (error) => error.code === 'VIDEO_PATH_CONFLICT');
  assert.equal(calls.length, 0);
});
test('deletion removes object before row and retains metadata on Storage failure', async () => {
  const { service, calls } = setup({ getOwnedVideo: async () => row });
  await service.remove(owner, material);
  assert.deepEqual(calls.map((call) => call[0]), ['remove-object', 'delete-row']);
  const fail = setup({ getOwnedVideo: async () => row, removeVideoObject: async () => { throw new Error('offline'); } });
  await assert.rejects(fail.service.remove(owner, material), /offline/);
  assert.equal(fail.calls.length, 0);
});
