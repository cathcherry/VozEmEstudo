import { env } from '../config/env.js';
import { isFeatureEnabled } from '../config/feature-flags.js';
import { AppError } from '../domain/errors.js';
import { getAiRegistry } from '../ai/provider-registry.js';
import { logger } from '../utils/logger.js';
import { nextRetryDelayMs } from './retry-policy.js';
import * as repository from '../repositories/multi-lesson.repository.js';
import {
  buildMultiLessonGenerator,
  mockMultiLessonCompletion,
} from '../services/multi-lesson-generation.service.js';
import { MULTI_LESSON_TASK } from '../services/multi-lesson.service.js';
import { KNOWLEDGE_MAP_PROMPT_VERSION } from '../prompts/multi-lesson.v1.js';

// Milestone C — runs the integrated-material queue (multi_lesson_jobs) from the existing worker
// loop. Its claim, lease and bookkeeping are separate from processing_jobs, so current jobs are
// unaffected. Retryable provider errors go back to the queue with the same backoff as other jobs;
// a final failure frees the generation key in the same database call (fail_generation_admin);
// success completes it (complete_generation_admin).

let schemaAvailable = true;
/** Test seam: forget that the schema was missing. */
export const resetMultiLessonRunner = () => {
  schemaAvailable = true;
};

function startHeartbeat(job, workerId, repo) {
  const window = env.workerStaleLeaseSeconds || 600;
  const timer = setInterval(
    () => {
      repo.renewLease(job.id, workerId).catch(() => {
        /* Retried on the next tick; recovery waits for the full lease window. */
      });
    },
    Math.min(60, Math.floor(window / 3)) * 1000,
  );
  timer.unref?.();
  return () => clearInterval(timer);
}

/** The generator wired to the provider registry (or the offline demo) and the optional cache. */
export function defaultGenerator(job) {
  const record = job.multiLesson || {};
  const ai = record.settings?.ai;
  const snapshot = ai ? { task: MULTI_LESSON_TASK, provider: ai.provider, model: ai.model, settings: {} } : undefined;
  const family = ai ? `${ai.provider}:${ai.model}`.slice(0, 80) : 'default';
  let complete;
  if (env.mockExternalServices) complete = async (args) => mockMultiLessonCompletion(args);
  else {
    const llm = getAiRegistry().text(MULTI_LESSON_TASK, snapshot);
    complete = ({ messages, maxTokens }) => llm.completeJson({ messages, maxTokens });
  }
  return buildMultiLessonGenerator({
    complete,
    cache: repository.createKnowledgeMapCache({
      userId: record.user_id,
      promptVersion: KNOWLEDGE_MAP_PROMPT_VERSION,
      modelFamily: family,
    }),
  });
}

export async function executeMultiLessonJob(job, workerId, { repo = repository, generatorFor = defaultGenerator } = {}) {
  const stop = startHeartbeat(job, workerId, repo);
  try {
    const sources = await repo.jobSources(job.id, workerId);
    const record = job.multiLesson || {};
    const generate = generatorFor(job);
    const output = await generate({ sources, outputs: record.outputs || [], settings: record.settings || {} });
    await repo.completeJob(job.id, workerId, output.result, output.model);
    logger.info('MULTI_LESSON_DONE', { jobId: job.id, calls: output.calls });
    return { ok: true, calls: output.calls };
  } catch (error) {
    const code = error instanceof AppError ? error.code : 'JOB_FAILED';
    const retry = Boolean(error?.retryable) && Number(job.attempt_count) < Number(job.max_attempts);
    const retryAt = retry ? new Date(Date.now() + nextRetryDelayMs(job.attempt_count)).toISOString() : null;
    logger.error('MULTI_LESSON_FAILED', { jobId: job.id, code, retry });
    await repo.failJob(job.id, workerId, code, retryAt).catch(() => {
      // Not recorded (database unreachable): the lease expires and the next claim recovers it.
      logger.error('MULTI_LESSON_BOOKKEEPING_FAILED', { jobId: job.id });
    });
    return { ok: false, code, retry };
  } finally {
    stop();
  }
}

/** Claims and runs one integrated-material job; false when there was nothing to do. */
export async function runNextMultiLessonJob(workerId, options = {}) {
  const repo = options.repo || repository;
  if (!isFeatureEnabled('multi_lesson') || !schemaAvailable) return false;
  let job;
  try {
    job = await repo.claimJob(workerId, env.workerStaleLeaseSeconds || 600);
  } catch (error) {
    if (error?.code === 'MULTI_LESSON_SCHEMA_REQUIRED') {
      // Flag on, migration missing: stop polling this queue instead of failing every loop.
      schemaAvailable = false;
      logger.error('MULTI_LESSON_SCHEMA_REQUIRED', { workerId });
      return false;
    }
    throw error;
  }
  if (!job) return false;
  await executeMultiLessonJob(job, workerId, options);
  return true;
}
