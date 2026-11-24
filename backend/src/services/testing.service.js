// Public testing program (FEATURE_PUBLIC_TESTING): server-enforced quotas, admin allowlist, global
// caps and the shared demonstration lessons. The rules live in SQL
// (database/migrations/20261125100000_public_testing.sql): every expensive action is reserved
// atomically and idempotently before it runs. With the flag off this module changes nothing.
// With the flag on and the schema missing it fails closed (no expensive work starts).
import { randomUUID } from 'node:crypto';
import { rpc } from '../repositories/rpc.js';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError } from '../domain/errors.js';
import { isFeatureEnabled } from '../config/feature-flags.js';
import { logger } from '../utils/logger.js';

export const USAGE_KIND = Object.freeze({
  TRANSCRIPTION: 'transcription_seconds',
  PROCESSING_LLM: 'processing_llm',
  SUMMARY: 'summary',
  QUESTIONS: 'questions',
  FLASHCARDS: 'flashcards',
  FLASHCARD_REPLACE: 'flashcard_replace',
  WARNINGS: 'warnings',
  MULTI_LESSON: 'multi_lesson',
});

const KIND_LABEL = {
  transcription_seconds: 'transcrição',
  processing_llm: 'gravações processadas',
  summary: 'resumos',
  questions: 'listas de questões',
  flashcards: 'geração de flashcards',
  flashcard_replace: 'novas sugestões de cartão',
  warnings: 'nova análise de avisos',
  multi_lesson: 'material integrado',
};

export const publicTestingEnabled = () => isFeatureEnabled('public_testing');

/** The program's RPCs, failing closed with a clear code when the migration is not applied. */
async function call(name, parameters) {
  try {
    return await rpc(name, parameters);
  } catch (error) {
    if (error?.code === 'SCHEMA_UPGRADE_REQUIRED')
      throw new AppError(
        'PUBLIC_TESTING_SCHEMA_REQUIRED',
        'O programa de testes ainda não está configurado neste servidor. Nenhum processamento foi iniciado.',
        503,
      );
    throw error;
  }
}

const minutes = (seconds) => {
  const value = Math.max(0, Number(seconds) || 0);
  if (value < 60) return `${Math.round(value)} s`;
  const m = Math.floor(value / 60);
  const s = Math.round(value % 60);
  return s ? `${m} min ${s} s` : `${m} min`;
};

/** The user-facing error for a refused reservation. No billing or provider detail leaks. */
export function quotaError(kind, result) {
  if (result?.reason === 'global_cap') {
    return new AppError(
      'TESTING_CAPACITY_REACHED',
      'Atingimos o limite de processamento do programa de testes por agora. Tente de novo mais tarde: suas aulas, as aulas de demonstração e os materiais salvos continuam disponíveis.',
      503,
      { details: { kind, window: result.window || null } },
    );
  }
  const limit = Number(result?.limit ?? 0);
  if (kind === USAGE_KIND.PROCESSING_LLM) {
    return new AppError(
      'RECORDING_QUOTA_EXCEEDED',
      `Durante os testes, cada participante pode processar até ${limit} ${limit === 1 ? 'gravação' : 'gravações'}. As aulas de demonstração e o que você já enviou continuam disponíveis.`,
      403,
      { details: { kind, limit, used: Number(result?.used ?? 0), remaining: Number(result?.remaining ?? 0) } },
    );
  }
  if (kind === USAGE_KIND.TRANSCRIPTION) {
    const remaining = Number(result?.remaining ?? 0);
    return new AppError(
      'TRANSCRIPTION_QUOTA_EXCEEDED',
      remaining > 0
        ? `Esta gravação passa do seu limite de transcrição. Restam ${minutes(remaining)} de ${minutes(limit)}: recorte um trecho menor.`
        : `Você já usou os ${minutes(limit)} de transcrição do período de testes. As aulas de demonstração e o que você já enviou continuam disponíveis.`,
      403,
      { details: { kind, limit, used: Number(result?.used ?? 0), remaining } },
    );
  }
  return new AppError(
    'GENERATION_QUOTA_EXCEEDED',
    limit > 0
      ? `Você já usou ${limit === 1 ? 'a geração' : `as ${limit} gerações`} de ${KIND_LABEL[kind] || 'IA'} do período de testes. O que já foi gerado continua disponível.`
      : `Durante o período de testes, ${KIND_LABEL[kind] || 'este recurso'} não está disponível para contas de participante.`,
    403,
    { details: { kind, limit, used: Number(result?.used ?? 0), remaining: Number(result?.remaining ?? 0) } },
  );
}

/**
 * Reserves `units` of `kind` for the account. `ref` identifies the work (job id, request key):
 * repeating a ref never counts twice. Throws the friendly quota error when refused.
 * Returns null when the program is off (nothing recorded).
 */
export async function reserve(userId, kind, ref, units = 1, materialId = null) {
  if (!publicTestingEnabled()) return null;
  const result = await call('testing_reserve_admin', {
    p_user_id: userId,
    p_kind: kind,
    p_ref: String(ref),
    p_units: Math.max(1, Math.ceil(Number(units) || 1)),
    p_material_id: materialId,
  });
  if (!result?.ok) {
    logger.info('USAGE_REFUSED', { kind, reason: result?.reason, window: result?.window || null });
    throw quotaError(kind, result);
  }
  return result;
}

/** Gives units back when the work never reached a provider. Never throws. */
export async function release(userId, kind, ref) {
  if (!publicTestingEnabled()) return false;
  try {
    return await call('testing_release_admin', { p_user_id: userId, p_kind: kind, p_ref: String(ref) });
  } catch (error) {
    logger.error('USAGE_RELEASE_FAILED', { kind, code: error?.code || 'unknown' });
    return false;
  }
}

/** Runs `work` under a reservation; releases it if `work` throws (nothing was produced). */
export async function withReservation(userId, kind, ref, work, { units = 1, materialId = null } = {}) {
  const key = ref || randomUUID();
  const reservation = await reserve(userId, kind, key, units, materialId);
  try {
    return await work(key);
  } catch (error) {
    if (reservation && !reservation.duplicate) await release(userId, kind, key);
    throw error;
  }
}

/** Whether a reservation for this ref already exists (avoids re-probing media on every poll). */
export async function hasReservation(userId, kind, ref) {
  if (!publicTestingEnabled()) return true;
  const { data, error } = await getAdminSupabase()
    .from('usage_ledger')
    .select('id')
    .eq('user_id', userId)
    .eq('kind', kind)
    .eq('ref', String(ref))
    .neq('status', 'released')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

const EMPTY_USAGE = Object.freeze({ policy: 'off', admin: false, programEnabled: false, limits: {}, used: {}, demoAccess: false });

/** Role, limits and use of the signed-in account (for Conta and the welcome toast). */
export async function usage(userId) {
  if (!publicTestingEnabled()) return { ...EMPTY_USAGE };
  return call('testing_usage_admin', { p_user_id: userId });
}

// Admin status is read on the server only; a short cache keeps revocation quick (≤ 30 s).
const adminCache = new Map();
export async function isAdmin(userId) {
  if (!publicTestingEnabled() || !userId) return false;
  const cached = adminCache.get(userId);
  if (cached && cached.until > Date.now()) return cached.value;
  const value = Boolean(await call('testing_is_admin', { p_user_id: userId }));
  adminCache.set(userId, { value, until: Date.now() + 30_000 });
  return value;
}
export const clearAdminCache = () => adminCache.clear();

/** Program-wide numbers (no identities). Admins only; others get 404 (the route does not exist for them). */
export async function overview(userId) {
  if (!(await isAdmin(userId))) throw new AppError('NOT_FOUND', 'Recurso não encontrado.', 404);
  return call('testing_overview_admin', {});
}

/** Pre-check before queueing a transcription: refuse early when nothing is left (UX only). */
export async function assertTranscriptionAvailable(userId, declaredDurationMs) {
  if (!publicTestingEnabled()) return;
  const current = await usage(userId);
  const limit = current.limits?.transcription_seconds;
  if (limit === undefined || limit === null) return;
  const used = Number(current.used?.transcription_seconds || 0);
  const remaining = Math.max(0, Number(limit) - used);
  const declared = Math.ceil((Number(declaredDurationMs) || 0) / 1000);
  if (remaining <= 0 || (declared > 0 && declared > remaining))
    throw quotaError(USAGE_KIND.TRANSCRIPTION, { reason: 'user_quota', limit, used, remaining });
}

/** Testers: smaller requests (a 5-minute lesson supports ~12 questions; the free LLM tier rejects big calls). */
export const TESTER_MAX = Object.freeze({ questions: 10, flashcards: 20 });
export async function assertTesterRequestSize(userId, what, count) {
  if (!publicTestingEnabled()) return;
  const max = TESTER_MAX[what];
  if (!max || !(Number(count) > max)) return;
  const current = await usage(userId);
  if (current.policy !== 'tester') return;
  throw new AppError(
    'TESTER_REQUEST_TOO_LARGE',
    what === 'questions'
      ? `Durante os testes, cada lista pode ter até ${max} questões.`
      : `Durante os testes, cada geração pode ter até ${max} cartões.`,
    400,
    { details: { what, max } },
  );
}
