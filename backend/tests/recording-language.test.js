import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAiConfig,
  recordingLanguageOptions,
  applyRecordingLanguage,
  snapshotTask,
} from '../src/ai/provider-config.js';
import { validateRecordingLanguage } from '../src/validators/recording-language.validator.js';
import { transcriptRequest } from '../src/integrations/asr/assemblyai.client.js';

const assembly = createAiConfig({ ASR_PROVIDER: 'assemblyai', LLM_PROVIDER: 'groq' });

test('only providers that accept a language parameter offer the choice', () => {
  assert.deepEqual(recordingLanguageOptions(createAiConfig({})), { options: [], default: null });
  assert.deepEqual(recordingLanguageOptions(assembly), {
    options: ['auto', 'pt', 'en', 'es', 'zh'],
    default: 'pt',
  });
  const custom = createAiConfig({
    ASR_PROVIDER: 'assemblyai',
    ASR_SELECTABLE_LANGUAGES: 'pt, EN, fr, <bad>',
    ASR_LANGUAGE_DETECTION: 'true',
  });
  assert.deepEqual(recordingLanguageOptions(custom), {
    options: ['auto', 'pt', 'en', 'fr'],
    default: 'auto',
  });
});

test('the choice reaches the AssemblyAI request: fixed code or detection, never both', () => {
  const base = snapshotTask(assembly, 'transcription');
  const spanish = applyRecordingLanguage(base, 'es');
  assert.equal(spanish.settings.recordingLanguage, 'es');
  const fixed = transcriptRequest('upload://x', spanish);
  assert.equal(fixed.language_code, 'es');
  assert.equal(fixed.language_detection, undefined);
  const auto = transcriptRequest('upload://x', applyRecordingLanguage(base, 'auto'));
  assert.equal(auto.language_detection, true);
  assert.equal(auto.language_code, undefined);
  // No choice keeps the server default; other tasks are untouched.
  assert.equal(
    transcriptRequest('upload://x', applyRecordingLanguage(base, null)).language_code,
    'pt',
  );
  const summary = snapshotTask(assembly, 'summary');
  assert.equal(applyRecordingLanguage(summary, 'es'), summary);
});

test('validation accepts only offered options and is optional', () => {
  assert.equal(validateRecordingLanguage(undefined, assembly), null);
  assert.equal(validateRecordingLanguage('zh', assembly), 'zh');
  assert.throws(() => validateRecordingLanguage('xx', assembly), /idioma da gravação/);
  assert.throws(() => validateRecordingLanguage(['pt'], assembly), /idioma/);
  assert.throws(() => validateRecordingLanguage('pt', createAiConfig({})), /não permite escolher/);
});
