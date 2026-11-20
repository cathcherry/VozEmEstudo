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

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: number(process.env.PORT, 3000),
  appOrigin: process.env.APP_ORIGIN || 'http://localhost:3000',
  serveFrontend: bool(process.env.SERVE_FRONTEND, true),

  supabaseUrl: process.env.SUPABASE_URL || '',
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY || '',
  audioBucket: process.env.SUPABASE_AUDIO_BUCKET || 'audios',
  oauthProviders: (process.env.OAUTH_PROVIDERS || 'google,github')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => ['google', 'github'].includes(p)),

  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',

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
  retryDelay1Ms: number(process.env.JOB_RETRY_DELAY_1_MS, 15000),
  retryDelay2Ms: number(process.env.JOB_RETRY_DELAY_2_MS, 60000),

  mockExternalServices: bool(process.env.MOCK_EXTERNAL_SERVICES, false),
  // Server-side ceiling for one question list; the database accepts at most 100.
  maxQuestionListCount: listLimit(process.env.MAX_QUESTION_LIST_COUNT),
});

export function missingRuntimeSecrets() {
  return [
    ['SUPABASE_URL', env.supabaseUrl],
    ['SUPABASE_PUBLISHABLE_KEY', env.supabasePublishableKey],
    ['SUPABASE_SECRET_KEY', env.supabaseSecretKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
}
