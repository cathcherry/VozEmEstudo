import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAiConfig,
  disclosureLabels,
  missingAiCredentials,
  snapshotTask,
} from '../src/ai/provider-config.js';
import { createProviderRegistry } from '../src/ai/provider-registry.js';
import { createGroqProvider } from '../src/integrations/llm/groq.client.js';
import { createHuggingFaceProvider } from '../src/integrations/asr/huggingface-whisper.client.js';
import { assertTranscriptionResult } from '../src/ai/contracts/transcription.js';

test('defaults preserve the legacy Hugging Face + Groq configuration', () => {
  const config = createAiConfig({ GROQ_MODEL: 'groq-legacy', HF_ASR_SPACE_ID: 'space/x' });
  assert.equal(config.asr.provider, 'huggingface');
  assert.equal(config.asr.model, 'space/x');
  assert.equal(config.asr.fallbackProvider, null);
  for (const task of ['summary', 'questions', 'warnings', 'flashcards', 'cleanup'])
    assert.deepEqual({ ...config.llm[task] }, { provider: 'groq', model: 'groq-legacy' });
  assert.equal(config.vision.provider, 'disabled');
  assert.deepEqual(disclosureLabels(config), {
    recognitionProvider: 'Hugging Face (ASR)',
    textProvider: 'Groq',
  });
});

test('each task selects its own provider and model; AssemblyAI ASR defaults to STT 3.7', () => {
  const config = createAiConfig({
    ASR_PROVIDER: 'assemblyai',
    ASR_LANGUAGE: 'pt',
    ASR_EXPECTED_LANGUAGES: 'pt, en',
    LLM_PROVIDER: 'groq',
    LLM_MODEL: 'shared-model',
    LLM_SUMMARY_MODEL: 'summary-model',
    LLM_CLEANUP_PROVIDER: 'assemblyai-gateway',
    LLM_CLEANUP_MODEL: 'cleanup-model',
  });
  assert.equal(config.asr.model, 'assemblyai-stt-3-7');
  assert.deepEqual(config.asr.expectedLanguages, ['pt', 'en']);
  assert.equal(config.llm.summary.model, 'summary-model');
  assert.equal(config.llm.questions.model, 'shared-model');
  assert.deepEqual(
    { ...config.llm.cleanup },
    { provider: 'assemblyai-gateway', model: 'cleanup-model' },
  );
  assert.deepEqual(snapshotTask(config, 'transcription'), {
    task: 'transcription',
    provider: 'assemblyai',
    model: 'assemblyai-stt-3-7',
    settings: {
      languageCode: 'pt',
      languageDetection: false,
      expectedLanguages: ['pt', 'en'],
      speakerLabels: false,
    },
  });
});

test('invalid providers and implicit fallbacks are rejected; missing credentials are listed by name', () => {
  assert.throws(() => createAiConfig({ ASR_PROVIDER: 'whatever' }), /ASR_PROVIDER inválido/);
  assert.throws(() => createAiConfig({ LLM_SUMMARY_PROVIDER: 'openai' }), /LLM_SUMMARY_PROVIDER/);
  assert.throws(
    () => createAiConfig({ ASR_PROVIDER: 'assemblyai', ASR_FALLBACK_PROVIDER: 'assemblyai' }),
    /ASR_FALLBACK_PROVIDER/,
  );
  const config = createAiConfig({
    ASR_PROVIDER: 'assemblyai',
    LLM_PROVIDER: 'assemblyai-gateway',
    LLM_SUMMARY_PROVIDER: 'groq',
    LLM_SUMMARY_MODEL: 'm',
  });
  const missing = missingAiCredentials(config);
  assert(missing.includes('GROQ_API_KEY'));
  assert(missing.includes('ASSEMBLYAI_API_KEY'));
  // The gateway serves several vendors, so its model must be chosen deliberately.
  assert(missing.includes('LLM_QUESTIONS_MODEL'));
  assert(!missing.includes('LLM_SUMMARY_MODEL'));
  assert(!JSON.stringify(missing).includes('secret'));
});

test('registry binds the task model, honours job snapshots and refuses unknown providers', async () => {
  const calls = [];
  const fake = (name) => ({
    name,
    completeText: async (args) => (
      calls.push({ name, ...args }),
      { text: 'ok', model: args.model + '-actual' }
    ),
    completeJson: async (args) => (calls.push({ name, ...args }), { data: {}, model: args.model }),
  });
  const registry = createProviderRegistry({
    config: createAiConfig({ LLM_SUMMARY_MODEL: 'live-summary', GROQ_API_KEY: 'k' }),
    factories: {
      text: { groq: () => fake('groq'), other: () => fake('other') },
      transcription: {},
    },
    mock: false,
  });
  const live = registry.text('summary');
  assert.deepEqual(await live.completeText({ messages: [] }), {
    text: 'ok',
    model: 'live-summary-actual',
  });
  // A job keeps the provider/model resolved at enqueue even if the environment changed since.
  const pinned = registry.text('summary', {
    task: 'summary',
    provider: 'other',
    model: 'pinned',
    settings: {},
  });
  await pinned.completeText({ messages: [] });
  assert.deepEqual(
    calls.map(({ name, model }) => [name, model]),
    [
      ['groq', 'live-summary'],
      ['other', 'pinned'],
    ],
  );
  assert.throws(
    () => registry.transcription(),
    (error) => error.code === 'CONFIGURATION_ERROR',
  );
  assert.throws(
    () => registry.text('summary', { provider: 'groq', model: null }),
    (error) => error.code === 'CONFIGURATION_ERROR' && /LLM_SUMMARY_MODEL/.test(error.message),
  );
});

test('Groq adapter reports the actual model and maps provider errors without leaking them', async () => {
  const requests = [];
  let failure = null;
  const provider = createGroqProvider({
    apiKey: 'k',
    createClient: () => ({
      chat: {
        completions: {
          create: async (body) => {
            requests.push(body);
            if (failure) throw failure;
            return {
              model: 'served-model',
              choices: [{ message: { content: body.response_format ? '{"a":1}' : ' texto ' } }],
            };
          },
        },
      },
    }),
  });
  assert.deepEqual(await provider.completeText({ model: 'm', messages: [] }), {
    text: 'texto',
    model: 'served-model',
  });
  assert.deepEqual(await provider.completeJson({ model: 'm', messages: [] }), {
    data: { a: 1 },
    model: 'served-model',
  });
  assert.deepEqual(requests[1].response_format, { type: 'json_object' });
  failure = Object.assign(new Error('secret upstream detail'), { status: 429 });
  await assert.rejects(
    provider.completeText({ model: 'm', messages: [] }),
    (error) =>
      error.code === 'LLM_TEMPORARY_ERROR' && error.retryable && !error.message.includes('secret'),
  );
  failure = Object.assign(new Error('bad request'), { status: 400 });
  await assert.rejects(
    provider.completeJson({ model: 'm', messages: [] }),
    (error) => error.code === 'LLM_FAILED' && !error.retryable,
  );
  await assert.rejects(
    createGroqProvider({ apiKey: '' }).completeText({ model: 'm', messages: [] }),
    (error) => error.code === 'CONFIGURATION_ERROR' && /GROQ_API_KEY/.test(error.message),
  );
});

test('legacy Whisper results are normalized without inventing word timestamps', async () => {
  const provider = createHuggingFaceProvider({
    transcribe: async () => ({
      text: 'Olá turma.',
      language: 'pt',
      segments: [{ position: 0, startMs: 0, endMs: 2000, text: 'Olá turma.' }],
    }),
  });
  const result = assertTranscriptionResult(
    await provider.transcribe(Buffer.from('x'), { durationMs: 2000 }),
  );
  assert.equal(provider.mode, 'sync');
  assert.deepEqual(result.words, []);
  assert.deepEqual(result.segments, [
    { startMs: 0, endMs: 2000, text: 'Olá turma.', speaker: null },
  ]);
  assert.equal(result.metadata.provider, 'huggingface');
  assert.equal(result.metadata.capabilities.wordTimestamps, false);
});
