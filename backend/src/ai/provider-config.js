/**
 * Resolves which provider/model serves each AI task. Pure function of the environment so the
 * worker can snapshot it when a job is enqueued and tests can build isolated configurations.
 * Unset values keep the historical behaviour (Hugging Face ASR + Groq text generation).
 */
export const TEXT_TASKS = Object.freeze([
  'summary',
  'questions',
  'warnings',
  'flashcards',
  'cleanup',
]);
export const ASR_PROVIDERS = Object.freeze(['huggingface', 'assemblyai']);
export const TEXT_PROVIDERS = Object.freeze(['groq', 'assemblyai-gateway']);
export const VISION_PROVIDERS = Object.freeze(['disabled']);

export const ASSEMBLYAI_STT_MODEL = 'assemblyai-stt-3-7';
/**
 * Spoken-language choices offered at upload. Only providers that accept a language parameter
 * offer them (the Hugging Face Space call has none). The list is configurable because model
 * coverage changes: ASR_SELECTABLE_LANGUAGES overrides the default. "auto" = provider detection.
 * The recording language is never translated and is independent of the interface language.
 */
export const LANGUAGE_CHOICE_PROVIDERS = Object.freeze(['assemblyai']);
/**
 * Every language of AssemblyAI-STT-3.7 (32 languages; English also has three regional codes), from
 * https://www.assemblyai.com/docs/pre-recorded-audio/supported-languages (checked 2026-11-20).
 * Codes outside this list would silently fall back to another model (Universal-2), so they are not
 * offered. Portuguese first; the page sorts the rest by name.
 */
export const ASSEMBLYAI_STT_3_7_LANGUAGES = Object.freeze([
  'pt',
  'en',
  'en_us',
  'en_uk',
  'en_au',
  'es',
  'fr',
  'de',
  'it',
  'af',
  'ar',
  'yue',
  'ca',
  'da',
  'nl',
  'et',
  'fi',
  'gl',
  'he',
  'hi',
  'ja',
  'ko',
  'zh',
  'mr',
  'no',
  'nn',
  'fa',
  'ro',
  'ru',
  'sv',
  'tr',
  'ur',
  'vi',
  'xh',
  'zu',
]);
const DEFAULT_SELECTABLE_LANGUAGES = ASSEMBLYAI_STT_3_7_LANGUAGES;
const GROQ_DEFAULT_MODEL = 'llama-3.3-70b-versatile';

const text = (value) => String(value ?? '').trim();
const list = (value) =>
  text(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const bool = (value, fallback = false) =>
  value == null || value === '' ? fallback : String(value).toLowerCase() === 'true';
const positive = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

function choose(name, value, allowed, fallback) {
  const selected = text(value).toLowerCase() || fallback;
  if (!allowed.includes(selected)) throw new Error(`${name} inválido: use ${allowed.join(', ')}.`);
  return selected;
}

function textModel(provider, source, task) {
  const configured = text(source[`LLM_${task.toUpperCase()}_MODEL`]) || text(source.LLM_MODEL);
  if (configured) return configured;
  if (provider === 'groq') return text(source.GROQ_MODEL) || GROQ_DEFAULT_MODEL;
  // The Gateway serves several vendors; a model must be chosen deliberately.
  return text(source.ASSEMBLYAI_LLM_MODEL) || null;
}

export function createAiConfig(source = process.env) {
  const asrProvider = choose('ASR_PROVIDER', source.ASR_PROVIDER, ASR_PROVIDERS, 'huggingface');
  const asrFallback = text(source.ASR_FALLBACK_PROVIDER).toLowerCase() || null;
  if (asrFallback && (!ASR_PROVIDERS.includes(asrFallback) || asrFallback === asrProvider))
    throw new Error('ASR_FALLBACK_PROVIDER deve ser outro provedor de transcrição válido.');
  const asr = Object.freeze({
    provider: asrProvider,
    model:
      text(source.ASR_MODEL) ||
      (asrProvider === 'assemblyai'
        ? ASSEMBLYAI_STT_MODEL
        : text(source.HF_ASR_SPACE_ID) || 'openai/whisper'),
    // Explicit fallback only: never switch to another paid provider unless configured.
    fallbackProvider: asrFallback,
    languageCode: text(source.ASR_LANGUAGE) || 'pt',
    languageDetection: bool(source.ASR_LANGUAGE_DETECTION),
    expectedLanguages: list(source.ASR_EXPECTED_LANGUAGES),
    speakerLabels: bool(source.ASR_SPEAKER_LABELS),
    selectableLanguages: LANGUAGE_CHOICE_PROVIDERS.includes(asrProvider)
      ? Object.freeze(
          (list(source.ASR_SELECTABLE_LANGUAGES).length
            ? list(source.ASR_SELECTABLE_LANGUAGES)
            : DEFAULT_SELECTABLE_LANGUAGES
          )
            .map((code) => code.toLowerCase())
            .filter((code) => /^[a-z]{2,3}(_[a-z]{2})?$/.test(code)),
        )
      : Object.freeze([]),
    pollIntervalMs: positive(source.ASR_POLL_INTERVAL_MS, 15000),
    maxWaitMs: positive(source.ASR_MAX_WAIT_MS, 3 * 60 * 60 * 1000),
  });
  const llmDefault = choose('LLM_PROVIDER', source.LLM_PROVIDER, TEXT_PROVIDERS, 'groq');
  const llm = Object.freeze(
    Object.fromEntries(
      TEXT_TASKS.map((task) => {
        const provider = choose(
          `LLM_${task.toUpperCase()}_PROVIDER`,
          source[`LLM_${task.toUpperCase()}_PROVIDER`],
          TEXT_PROVIDERS,
          llmDefault,
        );
        return [task, Object.freeze({ provider, model: textModel(provider, source, task) })];
      }),
    ),
  );
  const vision = Object.freeze({
    provider: choose('VISION_PROVIDER', source.VISION_PROVIDER, VISION_PROVIDERS, 'disabled'),
    model: text(source.VISION_MODEL) || null,
  });
  const credentials = Object.freeze({
    groq: text(source.GROQ_API_KEY),
    assemblyai: text(source.ASSEMBLYAI_API_KEY),
    huggingface: text(source.HF_TOKEN),
  });
  const endpoints = Object.freeze({
    assemblyai: (text(source.ASSEMBLYAI_BASE_URL) || 'https://api.assemblyai.com').replace(
      /\/$/,
      '',
    ),
    assemblyaiGateway: (
      text(source.ASSEMBLYAI_LLM_GATEWAY_URL) || 'https://llm-gateway.assemblyai.com/v1'
    ).replace(/\/$/, ''),
    // 'json_object' requests JSON mode; 'none' relies only on prompts + local validation.
    assemblyaiGatewayJsonMode: choose(
      'ASSEMBLYAI_LLM_JSON_MODE',
      source.ASSEMBLYAI_LLM_JSON_MODE,
      ['json_object', 'none'],
      'json_object',
    ),
  });
  return Object.freeze({ asr, llm, vision, credentials, endpoints });
}

/** Lists the missing credentials for the configured providers, without exposing values. */
export function missingAiCredentials(config) {
  const needed = new Set([
    config.asr.provider,
    ...Object.values(config.llm).map((t) => t.provider),
  ]);
  if (config.asr.fallbackProvider) needed.add(config.asr.fallbackProvider);
  const missing = [];
  if (needed.has('groq') && !config.credentials.groq) missing.push('GROQ_API_KEY');
  if (
    (needed.has('assemblyai') || needed.has('assemblyai-gateway')) &&
    !config.credentials.assemblyai
  )
    missing.push('ASSEMBLYAI_API_KEY');
  for (const [task, entry] of Object.entries(config.llm))
    if (!entry.model) missing.push(`LLM_${task.toUpperCase()}_MODEL`);
  return missing;
}

/** Non-secret snapshot persisted with a job so later configuration changes do not affect it. */
export function snapshotTask(config, task) {
  if (task === 'transcription') {
    const { provider, model, languageCode, languageDetection, expectedLanguages, speakerLabels } =
      config.asr;
    return {
      task,
      provider,
      model,
      settings: { languageCode, languageDetection, expectedLanguages, speakerLabels },
    };
  }
  const entry = config.llm[task];
  if (!entry) throw new Error(`Tarefa de IA desconhecida: ${task}`);
  return { task, provider: entry.provider, model: entry.model, settings: {} };
}

const LABELS = Object.freeze({
  huggingface: 'Hugging Face (ASR)',
  assemblyai: 'AssemblyAI (ASR)',
  groq: 'Groq',
  'assemblyai-gateway': 'AssemblyAI LLM Gateway',
});
/** User-facing disclosure of which vendors receive audio/text; contains no models or secrets. */
export function disclosureLabels(config) {
  const vendors = [...new Set(Object.values(config.llm).map((entry) => LABELS[entry.provider]))];
  const fallback = config.asr.fallbackProvider ? LABELS[config.asr.fallbackProvider] : null;
  return {
    recognitionProvider: LABELS[config.asr.provider],
    // Audio may also reach the fallback ASR vendor, so it must be disclosed when configured.
    ...(fallback ? { fallbackRecognitionProvider: fallback } : {}),
    textProvider: vendors.join(', '),
  };
}

/** Choices for the upload form; empty `options` means the provider cannot take a language. */
export function recordingLanguageOptions(config) {
  const codes = config.asr.selectableLanguages || [];
  if (!codes.length) return { options: [], default: null };
  return {
    options: ['auto', ...codes],
    default: config.asr.languageDetection
      ? 'auto'
      : codes.includes(config.asr.languageCode)
        ? config.asr.languageCode
        : 'auto',
  };
}

/** Applies the user's per-recording choice to a transcription snapshot (pure). */
export function applyRecordingLanguage(snapshot, recordingLanguage) {
  if (snapshot?.task !== 'transcription' || !recordingLanguage) return snapshot;
  const settings = { ...(snapshot.settings || {}) };
  if (recordingLanguage === 'auto') {
    settings.languageDetection = true;
  } else {
    settings.languageDetection = false;
    settings.languageCode = recordingLanguage;
    settings.expectedLanguages = [];
  }
  return { ...snapshot, settings: { ...settings, recordingLanguage } };
}
