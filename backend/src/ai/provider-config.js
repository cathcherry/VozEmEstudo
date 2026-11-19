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
  return { recognitionProvider: LABELS[config.asr.provider], textProvider: vendors.join(', ') };
}
