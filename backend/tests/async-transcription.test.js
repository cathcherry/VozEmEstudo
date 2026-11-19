import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/domain/errors.js';
import {
  createAsyncTranscriptionRunner,
  SUBMIT_LIMIT,
} from '../src/services/async-transcription.service.js';

/** In-memory twin of ai_job_executions with the same compare-and-set semantics. */
function memoryStore(initial = {}) {
  const row = {
    id: 'exec-1',
    job_id: 'job-1',
    state: 'pending',
    requested_model: 'assemblyai-stt-3-7',
    settings: { languageCode: 'pt' },
    submit_count: 0,
    poll_count: 0,
    upload_ref: null,
    external_job_id: null,
    deadline_at: null,
    ...initial,
  };
  return {
    row,
    async get() {
      return { ...row };
    },
    async transition(id, from, patch) {
      if (id !== row.id || row.state !== from) return null;
      Object.assign(row, patch);
      return { ...row };
    },
  };
}

const completedResult = {
  text: 'Olá turma.',
  language: 'pt',
  segments: [{ startMs: 0, endMs: 900, text: 'Olá turma.', speaker: null }],
  words: [
    { startMs: 0, endMs: 400, text: 'Olá', speaker: null, confidence: 0.9 },
    { startMs: 450, endMs: 900, text: 'turma.', speaker: null, confidence: 0.8 },
  ],
  metadata: {
    provider: 'fake',
    requestedModel: 'assemblyai-stt-3-7',
    actualModel: 'served-model',
    externalJobId: 'ext-1',
    capabilities: {},
  },
};

function fakeProvider(script = {}) {
  const calls = [];
  let polls = 0;
  return {
    calls,
    name: 'fake',
    mode: 'async',
    async upload(bytes) {
      calls.push(['upload', bytes.length]);
      return 'upload://1';
    },
    async submit(ref, options) {
      calls.push(['submit', ref, options.model]);
      if (script.submit) return script.submit();
      return 'ext-1';
    },
    async findSubmission(ref) {
      calls.push(['find', ref]);
      return script.find ? script.find() : null;
    },
    async poll(id) {
      calls.push(['poll', id]);
      polls += 1;
      if (script.poll) return script.poll(polls);
      return polls < 2 ? { state: 'processing' } : { state: 'completed', result: completedResult };
    },
  };
}

const options = {
  loadAudio: async () => Buffer.from('wav'),
  pollIntervalMs: 5000,
  maxWaitMs: 60000,
};

test('submits once, releases the worker while processing and persists the completed transcript', async () => {
  const store = memoryStore();
  const persisted = [];
  const provider = fakeProvider();
  const advance = createAsyncTranscriptionRunner({
    store,
    persist: async (r) => persisted.push(r),
  });
  assert.deepEqual(await advance(await store.get(), provider, options), {
    status: 'waiting',
    delayMs: 5000,
  });
  assert.equal(store.row.state, 'processing');
  assert.equal(store.row.external_job_id, 'ext-1');
  assert.equal(store.row.submit_count, 1);
  // A restarted worker resumes from the stored state with a fresh runner: no new upload/submit.
  const restarted = createAsyncTranscriptionRunner({
    store,
    persist: async (r) => persisted.push(r),
  });
  assert.equal((await restarted(await store.get(), provider, options)).status, 'waiting');
  assert.equal((await restarted(await store.get(), provider, options)).status, 'completed');
  assert.deepEqual(
    provider.calls.map((c) => c[0]),
    ['upload', 'submit', 'poll', 'poll'],
  );
  assert.equal(persisted.length, 1);
  assert.equal(store.row.state, 'completed');
  assert.equal(store.row.actual_model, 'served-model');
  // Repeated completion delivery is a no-op.
  assert.equal((await restarted(await store.get(), provider, options)).status, 'completed');
  assert.equal(persisted.length, 1);
});

test('ambiguous submission is recovered by lookup instead of a second billed submit', async () => {
  const store = memoryStore();
  let accepted = false;
  const provider = fakeProvider({
    submit: () => {
      accepted = true;
      throw new AppError('ASR_TEMPORARY_ERROR', 'Conexão encerrada.', 502, { retryable: true });
    },
    find: () => (accepted ? 'ext-accepted' : null),
  });
  const advance = createAsyncTranscriptionRunner({ store, persist: async () => {} });
  await assert.rejects(advance(await store.get(), provider, options), (e) => e.retryable);
  assert.equal(store.row.state, 'submitting');
  assert.equal((await advance(await store.get(), provider, options)).status, 'waiting');
  assert.equal(store.row.external_job_id, 'ext-accepted');
  assert.equal(provider.calls.filter((c) => c[0] === 'submit').length, 1);
});

test('a submission the provider never received is retried, up to a bounded limit', async () => {
  const store = memoryStore();
  const provider = fakeProvider({
    submit: () => {
      throw new AppError('ASR_TEMPORARY_ERROR', 'Indisponível.', 502, { retryable: true });
    },
  });
  const advance = createAsyncTranscriptionRunner({ store, persist: async () => {} });
  for (let i = 0; i < SUBMIT_LIMIT; i += 1)
    await assert.rejects(advance(await store.get(), provider, options), (e) => e.retryable);
  await assert.rejects(
    advance(await store.get(), provider, options),
    (e) => e.code === 'ASR_SUBMIT_LIMIT' && !e.retryable,
  );
  assert.equal(provider.calls.filter((c) => c[0] === 'submit').length, SUBMIT_LIMIT);
  assert.equal(store.row.state, 'failed');
});

test('rate limits while polling are retryable and leave the durable state untouched', async () => {
  const store = memoryStore({
    state: 'processing',
    external_job_id: 'ext-1',
    upload_ref: 'upload://1',
  });
  const provider = fakeProvider({
    poll: () => {
      throw new AppError('ASR_TEMPORARY_ERROR', 'Limite de requisições.', 502, { retryable: true });
    },
  });
  const advance = createAsyncTranscriptionRunner({ store, persist: async () => {} });
  await assert.rejects(advance(await store.get(), provider, options), (e) => e.retryable);
  assert.equal(store.row.state, 'processing');
  assert.equal(store.row.external_job_id, 'ext-1');
});

test('provider failures and the polling deadline end the execution without infinite polling', async () => {
  const failed = memoryStore({ state: 'processing', external_job_id: 'ext-1' });
  const advance = createAsyncTranscriptionRunner({ store: failed, persist: async () => {} });
  await assert.rejects(
    advance(
      await failed.get(),
      fakeProvider({ poll: () => ({ state: 'failed', code: 'ASR_FAILED' }) }),
      options,
    ),
    (e) => e.code === 'ASR_FAILED' && !e.retryable,
  );
  assert.equal(failed.row.state, 'failed');

  const late = memoryStore({
    state: 'processing',
    external_job_id: 'ext-1',
    deadline_at: new Date(1000).toISOString(),
  });
  const provider = fakeProvider();
  const lateRunner = createAsyncTranscriptionRunner({
    store: late,
    persist: async () => {},
    now: () => 5000,
  });
  await assert.rejects(
    lateRunner(await late.get(), provider, options),
    (e) => e.code === 'ASR_TIMEOUT',
  );
  assert.equal(provider.calls.length, 0);
});

test('a duplicate worker that lost the race continues from the winner state', async () => {
  const store = memoryStore();
  const provider = fakeProvider();
  const stale = await store.get();
  const advance = createAsyncTranscriptionRunner({ store, persist: async () => {} });
  await advance(await store.get(), provider, options);
  // The stale copy still says 'pending'; its transition fails and it adopts the stored state.
  assert.equal((await advance(stale, provider, options)).status, 'waiting');
  assert.equal(provider.calls.filter((c) => c[0] === 'submit').length, 1);
});
