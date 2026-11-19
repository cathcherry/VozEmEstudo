import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentWords } from '../src/ai/normalization/segmentation.js';
import { normalizeTranscription } from '../src/ai/normalization/transcription.js';
import {
  createAssemblyAiProvider,
  normalizeAssemblyAiTranscript,
  transcriptRequest,
} from '../src/integrations/asr/assemblyai.client.js';
import {
  assertTranscriptionProvider,
  assertTranscriptionResult,
} from '../src/ai/contracts/transcription.js';
import { createAsyncTranscriptionRunner } from '../src/services/async-transcription.service.js';
import { assemblyAiFourMinuteTranscript } from './fixtures/assemblyai.fixture.js';

const API_KEY = 'aai-fixture-secret-key';

test('a four-minute single utterance becomes short natural segments with preserved word timing', () => {
  const body = assemblyAiFourMinuteTranscript();
  assert.equal(body.utterances.length, 1);
  assert(body.words.length > 500, 'fixture must contain hundreds of words');
  assert(body.words.at(-1).end - body.words[0].start > 235000);
  const result = assertTranscriptionResult(
    normalizeAssemblyAiTranscript(body, { requestedModel: 'assemblyai-stt-3-7' }),
  );
  assert(result.segments.length >= 25, `only ${result.segments.length} segments`);
  for (const [i, segment] of result.segments.entries()) {
    const duration = segment.endMs - segment.startMs;
    assert(duration <= 12000, `segment ${i} lasts ${duration} ms`);
    if (i < result.segments.length - 1)
      assert(duration >= 2000, `segment ${i} too short: ${duration} ms`);
    const own = result.words.filter((word) => word.segment === i);
    // Segment boundaries are exactly the real word times; nothing is interpolated.
    assert.equal(segment.startMs, own[0].startMs);
    assert.equal(segment.endMs, own.at(-1).endMs);
    assert.equal(segment.text, own.map((word) => word.text).join(' '));
    if (i > 0) assert(segment.startMs >= result.segments[i - 1].endMs);
  }
  // Most cuts land on sentence or clause punctuation.
  const natural = result.segments.filter((s) => /[.,!?:;]$/.test(s.text)).length;
  assert(
    natural / result.segments.length > 0.9,
    `${natural}/${result.segments.length} natural cuts`,
  );
  // Words, wording and repetitions are preserved in order ("A ideia, a ideia principal").
  assert.deepEqual(
    result.words.map((w) => [w.startMs, w.endMs, w.text]),
    body.words.map((w) => [w.start, w.end, w.text]),
  );
  assert.match(result.text, /A ideia, a ideia principal/);
  assert.equal(result.segments.map((s) => s.text).join(' '), result.text);
  assert.equal(result.language, 'pt');
  assert.equal(result.words[0].confidence, body.words[0].confidence);
  assert.equal(result.utterances.length, 1, 'provider utterances stay a separate concept');
  assert.equal(result.metadata.actualModel, 'assemblyai-stt-3-7');
});

test('speaker changes and long pauses always start a new segment', () => {
  const word = (text, startMs, endMs, speaker) => ({ text, startMs, endMs, speaker });
  const { segments } = segmentWords([
    word('Professora', 0, 400, 'A'),
    word('explica', 450, 900, 'A'),
    word('Pergunta', 1000, 1400, 'B'),
    word('do', 1450, 1600, 'B'),
    word('aluno', 1650, 2000, 'B'),
    word('Depois', 5000, 5400, 'B'),
  ]);
  assert.deepEqual(
    segments.map((s) => [s.text, s.speaker]),
    [
      ['Professora explica', 'A'],
      ['Pergunta do aluno', 'B'],
      ['Depois', 'B'],
    ],
  );
});

test('missing word data keeps legacy segments and never invents word timestamps', () => {
  const result = normalizeTranscription({
    text: 'Primeira parte. Segunda parte.',
    segments: [
      { startMs: 0, endMs: 4000, text: 'Primeira parte.' },
      { startMs: 4000, endMs: 9000, text: 'Segunda parte.' },
    ],
    metadata: { provider: 'huggingface' },
  });
  assert.deepEqual(result.words, []);
  assert.deepEqual(
    result.segments.map((s) => [s.startMs, s.endMs]),
    [
      [0, 4000],
      [4000, 9000],
    ],
  );
  const plain = normalizeTranscription({
    text: 'Só texto.',
    durationMs: 7000,
    metadata: { provider: 'x' },
  });
  assert.deepEqual(plain.segments, [{ startMs: 0, endMs: 7000, text: 'Só texto.', speaker: null }]);
});

test('request explicitly selects STT 3.7 and never mixes a fixed language with detection', () => {
  const fixed = transcriptRequest('https://cdn/upload/1', {
    model: 'assemblyai-stt-3-7',
    settings: { languageCode: 'pt', speakerLabels: true },
  });
  assert.deepEqual(fixed.speech_models, ['assemblyai-stt-3-7']);
  assert.equal(fixed.language_code, 'pt');
  assert.equal(fixed.speaker_labels, true);
  assert(!('language_detection' in fixed));
  const detected = transcriptRequest('u', {
    model: 'assemblyai-stt-3-7',
    settings: { languageDetection: true, expectedLanguages: ['pt', 'en'], languageCode: 'pt' },
  });
  assert.equal(detected.language_detection, true);
  assert.deepEqual(detected.language_detection_options, { expected_languages: ['pt', 'en'] });
  assert(!('language_code' in detected));
  assert(!('speaker_labels' in detected));
});

function fakeAssemblyAi({ failures = {} } = {}) {
  const requests = [];
  const transcripts = new Map();
  const fetchImpl = async (url, init) => {
    const { pathname, search } = new URL(url);
    requests.push({
      method: init.method,
      pathname,
      search,
      headers: init.headers,
      body: init.body,
    });
    const failure = failures[pathname]?.shift?.();
    if (failure)
      return new Response(JSON.stringify({ error: 'upstream detail ' + API_KEY }), {
        status: failure,
        headers: { 'retry-after': '7' },
      });
    if (pathname === '/v2/upload')
      return Response.json({ upload_url: 'https://cdn.assemblyai.test/upload/abc' });
    if (pathname === '/v2/transcript' && init.method === 'POST') {
      const body = JSON.parse(init.body);
      transcripts.set('t-1', {
        ...assemblyAiFourMinuteTranscript({ id: 't-1' }),
        audio_url: body.audio_url,
        polls: 0,
      });
      return Response.json({ id: 't-1', status: 'queued' });
    }
    if (pathname === '/v2/transcript')
      return Response.json({
        transcripts: [...transcripts.values()].map(({ id, audio_url, status }) => ({
          id,
          audio_url,
          status,
        })),
      });
    const transcript = transcripts.get(pathname.split('/').at(-1));
    transcript.polls += 1;
    return Response.json(
      transcript.polls < 2 ? { id: transcript.id, status: 'processing' } : transcript,
    );
  };
  return { requests, fetchImpl };
}

test('adapter uploads, submits and normalizes a completed Portuguese transcript end to end', async () => {
  const api = fakeAssemblyAi();
  const provider = assertTranscriptionProvider(
    createAssemblyAiProvider({ apiKey: API_KEY, fetchImpl: api.fetchImpl }),
  );
  const store = {
    row: {
      id: 'e',
      job_id: 'j',
      state: 'pending',
      requested_model: 'assemblyai-stt-3-7',
      settings: { languageCode: 'pt' },
      submit_count: 0,
      poll_count: 0,
    },
    async get() {
      return { ...this.row };
    },
    async transition(id, from, patch) {
      if (this.row.state !== from) return null;
      Object.assign(this.row, patch);
      return { ...this.row };
    },
  };
  const persisted = [];
  const advance = createAsyncTranscriptionRunner({
    store,
    persist: async (result) => persisted.push(result),
  });
  const options = { loadAudio: async () => Buffer.from('RIFF....WAVE'), pollIntervalMs: 1 };
  assert.equal((await advance(await store.get(), provider, options)).status, 'waiting');
  assert.equal((await advance(await store.get(), provider, options)).status, 'waiting');
  assert.equal((await advance(await store.get(), provider, options)).status, 'completed');
  assert.equal(persisted.length, 1);
  assert(persisted[0].segments.length > 20);
  assert.equal(store.row.actual_model, 'assemblyai-stt-3-7');
  const submitted = JSON.parse(
    api.requests.find((r) => r.pathname === '/v2/transcript' && r.method === 'POST').body,
  );
  assert.deepEqual(submitted.speech_models, ['assemblyai-stt-3-7']);
  assert.equal(submitted.audio_url, 'https://cdn.assemblyai.test/upload/abc');
  for (const request of api.requests) assert.equal(request.headers.authorization, API_KEY);
  assert.equal(await provider.findSubmission('https://cdn.assemblyai.test/upload/abc'), 't-1');
  assert.equal(await provider.findSubmission('https://cdn.assemblyai.test/upload/other'), null);
});

test('HTTP errors map to retryable or permanent failures without leaking provider details', async () => {
  const api = fakeAssemblyAi({ failures: { '/v2/transcript/t-9': [429, 401, 503] } });
  const provider = createAssemblyAiProvider({ apiKey: API_KEY, fetchImpl: api.fetchImpl });
  await assert.rejects(
    provider.poll('t-9'),
    (e) =>
      e.code === 'ASR_TEMPORARY_ERROR' &&
      e.retryable &&
      e.details.retryAfterSeconds === 7 &&
      !e.message.includes(API_KEY),
  );
  await assert.rejects(provider.poll('t-9'), (e) => e.code === 'ASR_AUTH_FAILED' && !e.retryable);
  await assert.rejects(provider.poll('t-9'), (e) => e.code === 'ASR_TEMPORARY_ERROR');
  const offline = createAssemblyAiProvider({
    apiKey: API_KEY,
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(
    offline.submit('u', { model: 'm' }),
    (e) => e.retryable && e.details.status === 0,
  );
  const unconfigured = createAssemblyAiProvider({ apiKey: '', fetchImpl: api.fetchImpl });
  await assert.rejects(
    unconfigured.upload(Buffer.from('x')),
    (e) => e.code === 'CONFIGURATION_ERROR' && /ASSEMBLYAI_API_KEY/.test(e.message),
  );
  const failed = createAssemblyAiProvider({
    apiKey: API_KEY,
    fetchImpl: async () =>
      Response.json({
        id: 't-2',
        status: 'error',
        error: 'Audio file could not be decoded ' + API_KEY,
      }),
  });
  assert.deepEqual(await failed.poll('t-2'), { state: 'failed', code: 'ASR_PROVIDER_ERROR' });
});

test('mock mode exercises the asynchronous path offline', async () => {
  let called = false;
  const provider = createAssemblyAiProvider({
    apiKey: '',
    mock: true,
    fetchImpl: async () => {
      called = true;
    },
  });
  const id = await provider.submit(await provider.upload(Buffer.from('x')), {
    model: 'assemblyai-stt-3-7',
  });
  const outcome = await provider.poll(id, { model: 'assemblyai-stt-3-7' });
  assert.equal(outcome.state, 'completed');
  assert(outcome.result.words.length > 0);
  assert.equal(called, false);
});

test('unpunctuated run-on speech is still bounded, preferring the longest pauses', () => {
  const words = Array.from({ length: 200 }, (_, i) => ({
    text: 'palavra' + i,
    startMs: i * 400 + (i % 17 === 0 ? 300 : 0) + Math.floor(i / 17) * 300,
    endMs: i * 400 + 300 + (i % 17 === 0 ? 300 : 0) + Math.floor(i / 17) * 300,
    speaker: null,
  }));
  const { segments, words: aligned } = segmentWords(words);
  assert(segments.length >= 7);
  for (const segment of segments.slice(0, -1)) {
    assert(segment.endMs - segment.startMs <= 12000);
    assert(segment.endMs - segment.startMs >= 3000);
  }
  assert.equal(aligned.length, words.length);
});
