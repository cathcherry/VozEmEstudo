import 'dotenv/config';

function bool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

/** Invalid, empty or out-of-range values fall back to 40; the database accepts at most 100. */
function listLimit(value) {
  const parsed = Math.floor(Number(value));
  return value && parsed >= 1 ? Math.min(100, parsed) : 40;
}
function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Stale-lease window: 600 s by default, 0 disables, other values are raised to the 60 s minimum. */
export function leaseSeconds(value) {
  const seconds = String(value ?? '').trim() === '' ? 600 : number(value, 600);
  return seconds <= 0 ? 0 : Math.max(60, Math.round(seconds));
}

/**
 * Content-Security-Policy mode: an explicit 'off', 'report-only' or 'enforce' always wins; when
 * unset (or invalid) production enforces the policy and other environments leave it off.
 */
export function cspMode(value, nodeEnv) {
  if (['off', 'report-only', 'enforce'].includes(value)) return value;
  return nodeEnv === 'production' ? 'enforce' : 'off';
}

/** Express "trust proxy": unset/false (default), true, or a number of proxy hops. */
export function trustProxy(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text || text === 'false' || text === '0') return false;
  if (text === 'true') return true;
  const hops = Math.floor(Number(text));
  return Number.isFinite(hops) && hops > 0 ? hops : false;
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: number(process.env.PORT, 3000),
  appOrigin: process.env.APP_ORIGIN || 'http://localhost:3000',
  serveFrontend: bool(process.env.SERVE_FRONTEND, true),

  supabaseUrl: process.env.SUPABASE_URL || '',
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY || '',
  // How user tokens are checked: 'server' (getUser, default) or 'jwks' (signature via public JWKS).
  supabaseAuthVerify: process.env.SUPABASE_AUTH_VERIFY === 'jwks' ? 'jwks' : 'server',
  audioBucket: process.env.SUPABASE_AUDIO_BUCKET || 'audios',
  // Per-account limits on costly requests (0 turns a limit off). See docs/HOSPEDAGEM.md.
  // Content-Security-Policy for the served pages: 'off', 'report-only' or 'enforce'. Unset:
  // 'enforce' when NODE_ENV=production, 'off' otherwise (see cspMode).
  contentSecurityPolicy: cspMode(process.env.CONTENT_SECURITY_POLICY, process.env.NODE_ENV),
  // Behind a hosting proxy, the number of hops to trust so req.ip is the visitor's address
  // (used only by the limit on the public share endpoints).
  trustProxy: trustProxy(process.env.TRUST_PROXY),
  // Unauthenticated share lookups per address per minute (0 turns the limit off).
  rateLimitPublicSharesPerMinute: number(process.env.RATE_LIMIT_PUBLIC_SHARES_PER_MINUTE, 30),
  rateLimitTranscriptionsPerDay: number(process.env.RATE_LIMIT_TRANSCRIPTIONS_PER_DAY, 20),
  rateLimitGenerationsPerHour: number(process.env.RATE_LIMIT_GENERATIONS_PER_HOUR, 30),
  rateLimitMediaPerMinute: number(process.env.RATE_LIMIT_MEDIA_PER_MINUTE, 20),
  oauthProviders: (process.env.OAUTH_PROVIDERS || 'google,github')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => ['google', 'github'].includes(p)),

  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',

  hfToken: process.env.HF_TOKEN || '',
  hfAsrSpaceId: process.env.HF_ASR_SPACE_ID || 'openai/whisper',
  hfAsrApiName: process.env.HF_ASR_API_NAME || '/predict',
  hfAsrAudioField: process.env.HF_ASR_AUDIO_FIELD || 'inputs',
  hfAsrTaskField: process.env.HF_ASR_TASK_FIELD || 'task',
  hfAsrTaskValue: process.env.HF_ASR_TASK_VALUE || 'transcribe',
  hfAsrReturnsSegments: bool(process.env.HF_ASR_RETURNS_SEGMENTS, false),

  workerId: process.env.WORKER_ID || `worker-${process.pid}`,
  workerPollMs: number(process.env.WORKER_POLL_MS, 2000),
  workerConcurrency: number(process.env.WORKER_CONCURRENCY, 1),
  // 0 keeps the original claim RPC; >= 60 reclaims jobs whose worker died (needs the AI migration).
  // 0 disables recovery of jobs abandoned by a stopped worker; otherwise at least 60 s.
  workerStaleLeaseSeconds: leaseSeconds(process.env.WORKER_STALE_LEASE_SECONDS),
  jobMaxAttempts: number(process.env.JOB_MAX_ATTEMPTS, 3),
  // Generations that START an AI call per account per day (reuse and joins never count).
  aiDailyGenerationLimit: number(process.env.AI_DAILY_GENERATION_LIMIT, 40),
  retryDelay1Ms: number(process.env.JOB_RETRY_DELAY_1_MS, 15000),
  retryDelay2Ms: number(process.env.JOB_RETRY_DELAY_2_MS, 60000),

  mockExternalServices: bool(process.env.MOCK_EXTERNAL_SERVICES, false),
  // Offline demo only: a JSON array of strings used as the simulated transcript's segments.
  mockAsrSegmentsFile: process.env.MOCK_ASR_SEGMENTS_FILE || '',
  // Server-side ceiling for one question list; the database accepts at most 100.
  maxQuestionListCount: listLimit(process.env.MAX_QUESTION_LIST_COUNT),
});

/** Settings that are unsafe for a public deployment (logged as warnings at API start-up). */
export function productionConfigWarnings(config = env) {
  if (config.nodeEnv !== 'production') return [];
  const warnings = [];
  if (config.mockExternalServices) warnings.push('MOCK_EXTERNAL_SERVICES=true simula transcrição e IA');
  if (config.contentSecurityPolicy !== 'enforce') warnings.push(`CONTENT_SECURITY_POLICY=${config.contentSecurityPolicy}`);
  if (!/^https:\/\//.test(config.appOrigin)) warnings.push('APP_ORIGIN não usa https://');
  if (/localhost|127\.0\.0\.1/.test(config.appOrigin)) warnings.push('APP_ORIGIN aponta para localhost');
  if (config.mockAsrSegmentsFile) warnings.push('MOCK_ASR_SEGMENTS_FILE definido');
  return warnings;
}

export function missingRuntimeSecrets() {
  return [
    ['SUPABASE_URL', env.supabaseUrl],
    ['SUPABASE_PUBLISHABLE_KEY', env.supabasePublishableKey],
    ['SUPABASE_SECRET_KEY', env.supabaseSecretKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
}
