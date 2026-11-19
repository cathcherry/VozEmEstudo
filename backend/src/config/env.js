import 'dotenv/config';

function bool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  oauthProviders: (process.env.OAUTH_PROVIDERS || 'google,github').split(',').map((p) => p.trim()).filter((p) => ['google', 'github'].includes(p)),

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
  workerStaleLeaseSeconds: number(process.env.WORKER_STALE_LEASE_SECONDS, 0),
  jobMaxAttempts: number(process.env.JOB_MAX_ATTEMPTS, 3),
  retryDelay1Ms: number(process.env.JOB_RETRY_DELAY_1_MS, 15000),
  retryDelay2Ms: number(process.env.JOB_RETRY_DELAY_2_MS, 60000),

  mockExternalServices: bool(process.env.MOCK_EXTERNAL_SERVICES, false),
});

export function missingRuntimeSecrets() {
  return [
    ['SUPABASE_URL', env.supabaseUrl],
    ['SUPABASE_PUBLISHABLE_KEY', env.supabasePublishableKey],
    ['SUPABASE_SECRET_KEY', env.supabaseSecretKey],
  ].filter(([, value]) => !value).map(([name]) => name);
}
