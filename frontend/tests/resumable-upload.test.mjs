import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_SIZE,
  NETWORK_MESSAGE,
  resumableUpload,
  uploadMetadata,
} from '../js/api/resumable-upload.js';

const decode = (value) => Buffer.from(value, 'base64').toString('utf8');

/** Minimal in-memory TUS server (as Supabase Storage speaks it) with injectable failures. */
function tusServer({ existing = false, failures = {} } = {}) {
  const state = { received: 0, length: 0, metadata: null, calls: [], stored: null };
  const fail = (kind) => {
    const queue = failures[kind];
    return queue?.length ? queue.shift() : null;
  };
  const reply = (status, headers = {}) => new Response(null, { status, headers });
  const fetchImpl = async (url, init) => {
    state.calls.push(`${init.method} ${url}`);
    assert.equal(init.headers['Tus-Resumable'], '1.0.0');
    if (init.method === 'POST') {
      if (existing)
        return new Response('{"message":"The resource already exists"}', { status: 409 });
      state.length = Number(init.headers['Upload-Length']);
      state.metadata = Object.fromEntries(
        init.headers['Upload-Metadata'].split(',').map((pair) => {
          const [key, value] = pair.split(' ');
          return [key, decode(value)];
        }),
      );
      assert.equal(init.headers['x-upsert'], 'false');
      return reply(201, { Location: '/storage/v1/upload/resumable/abc' });
    }
    assert.equal(url, 'https://project.supabase.test/storage/v1/upload/resumable/abc');
    if (init.method === 'HEAD') {
      const failure = fail('head');
      if (failure === 'network')
        throw new TypeError('NetworkError when attempting to fetch resource.');
      return reply(200, {
        'Upload-Offset': String(state.received),
        'Upload-Length': String(state.length),
      });
    }
    const offset = Number(init.headers['Upload-Offset']);
    const failure = fail('patch');
    if (failure === 'network')
      throw new TypeError('NetworkError when attempting to fetch resource.');
    if (offset !== state.received) return reply(409);
    const bytes = new Uint8Array(await init.body.arrayBuffer());
    assert(bytes.length === CHUNK_SIZE || offset + bytes.length === state.length);
    state.stored = state.stored ? Buffer.concat([state.stored, bytes]) : Buffer.from(bytes);
    state.received += bytes.length;
    // The server keeps the chunk but the response never reaches the browser.
    if (failure === 'lost-response')
      throw new TypeError('NetworkError when attempting to fetch resource.');
    if (typeof failure === 'number') return reply(failure);
    return reply(204, { 'Upload-Offset': String(state.received) });
  };
  return { state, fetchImpl };
}

function fileOf(size) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = i % 251;
  return { bytes, file: new Blob([bytes], { type: 'audio/mpeg' }) };
}

const options = (server, file, extra = {}) => ({
  endpoint: 'https://project.supabase.test/storage/v1/upload/resumable',
  headers: { authorization: 'Bearer token' },
  bucket: 'audios',
  objectName: 'temp/user/material/Aula-trecho.mp3',
  file,
  contentType: 'audio/mpeg',
  fetchImpl: server.fetchImpl,
  delays: [0, 0, 0],
  ...extra,
});

test('metadata is TUS base64 and carries bucket, object and content type', () => {
  const header = uploadMetadata({ bucketName: 'audios', objectName: 'temp/ação.mp3', empty: '' });
  const pairs = header.split(',').map((pair) => pair.split(' '));
  assert.deepEqual(
    pairs.map(([key]) => key),
    ['bucketName', 'objectName'],
  );
  assert.equal(decode(pairs[1][1]), 'temp/ação.mp3');
});

test('uploads in 6 MB chunks and reports progress', async () => {
  const server = tusServer();
  const { bytes, file } = fileOf(CHUNK_SIZE * 2 + 1234);
  const progress = [];
  await resumableUpload(options(server, file, { onProgress: (f) => progress.push(f) }));
  assert.deepEqual(server.state.stored, Buffer.from(bytes));
  assert.equal(server.state.metadata.bucketName, 'audios');
  assert.equal(server.state.metadata.contentType, 'audio/mpeg');
  assert.equal(server.state.calls.filter((c) => c.startsWith('PATCH')).length, 3);
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 1);
  assert(progress.every((value, i) => i === 0 || value >= progress[i - 1]));
});

test('a dropped connection resumes from the server offset instead of restarting', async () => {
  const server = tusServer({ failures: { patch: [null, 'network'], head: ['network'] } });
  const { bytes, file } = fileOf(CHUNK_SIZE * 2 + 10);
  await resumableUpload(options(server, file));
  assert.deepEqual(server.state.stored, Buffer.from(bytes), 'every byte exactly once');
  assert.equal(server.state.calls.filter((c) => c.startsWith('POST')).length, 1);
  assert(server.state.calls.some((c) => c.startsWith('HEAD')));
});

test('a chunk stored but whose response was lost is not sent twice', async () => {
  const server = tusServer({ failures: { patch: ['lost-response', 503] } });
  const { bytes, file } = fileOf(CHUNK_SIZE + 99);
  await resumableUpload(options(server, file));
  assert.deepEqual(server.state.stored, Buffer.from(bytes));
});

test('an existing object is reported as 409 and never overwritten', async () => {
  const server = tusServer({ existing: true });
  const { file } = fileOf(10);
  await assert.rejects(resumableUpload(options(server, file)), (error) => {
    assert.equal(error.statusCode, '409');
    assert.match(error.message, /already exists/);
    return true;
  });
  assert.equal(server.state.calls.length, 1);
});

test('gives up with a clear message when the connection does not come back', async () => {
  const server = tusServer({
    failures: { patch: Array(10).fill('network'), head: Array(10).fill('network') },
  });
  const { file } = fileOf(100);
  await assert.rejects(resumableUpload(options(server, file)), (error) => {
    assert.equal(error.code, 'UPLOAD_NETWORK');
    assert.equal(error.message, NETWORK_MESSAGE);
    return true;
  });
});

test('a refused chunk (e.g. 413) fails at once with the storage message', async () => {
  const server = tusServer({ failures: { patch: [413] } });
  const { file } = fileOf(100);
  await assert.rejects(resumableUpload(options(server, file)), { statusCode: '413' });
});
