import { generationKey } from '../domain/generation-key.js';
import { rpc } from '../repositories/rpc.js';
import { AppError } from '../domain/errors.js';
import { getAiRegistry } from '../ai/provider-registry.js';
import { env } from '../config/env.js';
import { isFeatureEnabled } from '../config/feature-flags.js';
import { SUMMARY_PROMPT_VERSION } from '../prompts/summary.v1.js';
import { QUESTIONS_V2_PROMPT_VERSION } from '../prompts/questions.v2.js';
import { logger } from '../utils/logger.js';

// Voz em Estudo 3.3 — the canonical generation key connected to the job system
// (FEATURE_GENERATION_REUSE, migration 20261121160000_generation_reuse.sql).
// Before a summary or question job is queued, the server asks the database what to do:
//   reuse  → an equivalent, authorised result exists and the caller accepts it (no AI call);
//   join   → the equivalent job is already running (double click, second tab): wait for it;
//   start  → a new job, counted against the daily budget.

const PROMPTS = { summary: SUMMARY_PROMPT_VERSION, questions: QUESTIONS_V2_PROMPT_VERSION };
const TASK = { summary: 'summary', questions: 'questions' };

const messages = {
  GENERATION_BUDGET_EXCEEDED: [429, () => `Você chegou ao limite de ${env.aiDailyGenerationLimit} gerações com IA por dia. O que já foi gerado continua disponível; tente de novo amanhã.`],
  GENERATION_SOURCE_FORBIDDEN: [409, () => 'Confirme a transcrição desta aula antes de gerar.'],
  GENERATION_SCOPE_FORBIDDEN: [403, () => 'Você não tem acesso a este espaço de geração.'],
  GENERATION_NOT_FOUND: [404, () => 'Geração não encontrada.'],
};
function mapError(error) {
  const match = messages[error?.message];
  if (match) return new AppError(error.message, match[1](), match[0]);
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error?.code))
    return new AppError('GENERATION_REUSE_SCHEMA_REQUIRED', 'A reutilização de gerações ainda não foi habilitada no banco.', 503);
  return error;
}
async function call(name, params) {
  try {
    return await rpc(name, params);
  } catch (error) {
    throw mapError(error);
  }
}

export const generationReuseEnabled = () => isFeatureEnabled('generation_reuse');

/** Model family: provider + model of the task (a model change is a different generation). */
function modelFamily(kind) {
  try {
    const snapshot = getAiRegistry().snapshot(TASK[kind]);
    return `${snapshot.provider}:${snapshot.model || 'default'}`.slice(0, 80);
  } catch {
    return 'default';
  }
}

/** Content settings of a request, in the vocabulary of the generation key. */
export function settingsOf(kind, params = {}) {
  if (kind === 'questions') {
    const config = params.config || {};
    return {
      count: params.count,
      difficulties: config.difficulties,
      skills: config.skills,
      distribution: config.distribution,
      topicFocus: config.topicFocus,
      previousQuestions: config.previousQuestions,
    };
  }
  const options = params.summaryOptions || {};
  return { style: options.style, length: options.length, focus: options.focus, audience: options.audience, format: options.format };
}

export async function beginGeneration({ userId, materialId, kind, sourceRevisionId, params, allowReuse = false }) {
  const key = generationKey({
    scope: `user:${userId}`,
    sources: [sourceRevisionId],
    kind,
    settings: settingsOf(kind, params),
    promptVersion: PROMPTS[kind],
    modelFamily: modelFamily(kind),
  });
  return call('begin_generation_admin', {
    p_user_id: userId,
    p_key: key,
    p_scope_kind: 'user',
    p_scope_id: userId,
    p_kind: kind,
    p_sources: [sourceRevisionId],
    p_prompt_version: PROMPTS[kind],
    p_model_family: modelFamily(kind),
    p_material_id: materialId,
    p_allow_reuse: allowReuse,
    p_daily_limit: env.aiDailyGenerationLimit,
  });
}

export const attachGenerationJob = (generationId, jobId) =>
  call('attach_generation_job_admin', { p_generation_id: generationId, p_job_id: jobId });

/** Called by the worker; never fails the job (bookkeeping is reconciled on the next request). */
export async function completeGeneration(job, result) {
  if (!job?.params?.generationId) return;
  try {
    await call('complete_generation_admin', { p_generation_id: job.params.generationId, p_result: result });
  } catch (error) {
    logger.info('GENERATION_COMPLETE_DEFERRED', { jobId: job.id, code: error?.code || 'UNKNOWN' });
  }
}
export async function failGeneration(job, code) {
  if (!job?.params?.generationId) return;
  try {
    await call('fail_generation_admin', { p_generation_id: job.params.generationId, p_error_code: code });
  } catch (error) {
    logger.info('GENERATION_FAIL_DEFERRED', { jobId: job.id, code: error?.code || 'UNKNOWN' });
  }
}
