import { AppError } from '../domain/errors.js';
import { JOB_STATUS, MATERIAL_STATUS } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import { nowIso } from '../utils/time.js';
import { addJobEvent, renewJobLease, updateJob } from '../repositories/job.repository.js';
import { env } from '../config/env.js';
import { setMaterialState } from '../repositories/material.repository.js';
import { getByMaterial as getTranscription } from '../repositories/transcription.repository.js';
import { nextRetryDelayMs, shouldRetry } from './retry-policy.js';
import { runJob } from '../services/processing.service.js';
import { failGeneration } from '../services/generation-reuse.service.js';

/** Renews the lease while the job runs, at a third of the stale window (at most every minute). */
function startHeartbeat(job) {
  const window = env.workerStaleLeaseSeconds;
  if (!window || !job.locked_by) return () => {};
  const timer = setInterval(
    () => {
      renewJobLease(job.id, job.locked_by).catch(() => {
        /* A missed renewal is retried on the next tick; recovery waits for the full window. */
      });
    },
    Math.min(60, Math.floor(window / 3)) * 1000,
  );
  timer.unref?.();
  return () => clearInterval(timer);
}

export async function executeClaimedJob(job) {
  const stopHeartbeat = startHeartbeat(job);
  try {
    await runJob(job);
  } catch (error) {
    await recordFailure(job, error).catch(() => {
      // The failure could not be recorded (e.g. database unreachable). The job keeps its lease and
      // is recovered by the next claim once the stale window passes; nothing is marked done.
      logger.error('JOB_BOOKKEEPING_FAILED', { jobId: job.id, materialId: job.material_id });
    });
  } finally {
    stopHeartbeat();
  }
}

async function recordFailure(job, error) {
  const safeMessage =
    error instanceof AppError
      ? error.message
      : 'Não foi possível concluir esta etapa. Tente novamente.';
  const safeCode = error instanceof AppError ? error.code : 'JOB_FAILED';
  const retry = shouldRetry(error, job);
  logger.error('JOB_FAILED', {
    jobId: job.id,
    materialId: job.material_id,
    code: safeCode,
    retry,
  });

  if (retry) {
    const nextAt = new Date(Date.now() + nextRetryDelayMs(job.attempt_count)).toISOString();
    await updateJob(job.id, {
      status: JOB_STATUS.WAITING_RETRY,
      current_stage: null,
      next_attempt_at: nextAt,
      locked_at: null,
      locked_by: null,
      error_code: safeCode,
      error_message: safeMessage,
    });
    await addJobEvent(job.id, {
      status: JOB_STATUS.WAITING_RETRY,
      message: `Falha temporária. Nova tentativa programada para ${nextAt}.`,
    });
    return;
  }

  // 3.3: a final failure frees the generation key, so the next equivalent request starts again.
  await failGeneration(job, safeCode);
  await updateJob(job.id, {
    status: JOB_STATUS.FAILED,
    current_stage: null,
    completed_at: nowIso(),
    error_code: safeCode,
    error_message: safeMessage,
  });
  const transcription = await getTranscription(job.material_id).catch(() => null);
  await setMaterialState(job.material_id, {
    status: transcription ? MATERIAL_STATUS.PARTIAL : MATERIAL_STATUS.FAILED,
    currentStage: null,
    errorCode: safeCode,
    errorMessage: safeMessage,
  });
  await addJobEvent(job.id, {
    status: JOB_STATUS.FAILED,
    message: 'A tarefa falhou após as tentativas disponíveis.',
  });
}
