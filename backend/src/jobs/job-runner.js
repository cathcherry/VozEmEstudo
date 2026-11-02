import { AppError } from '../domain/errors.js';
import { JOB_STATUS, MATERIAL_STATUS } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import { nowIso } from '../utils/time.js';
import { addJobEvent, updateJob } from '../repositories/job.repository.js';
import { setMaterialState } from '../repositories/material.repository.js';
import { getByMaterial as getTranscription } from '../repositories/transcription.repository.js';
import { nextRetryDelayMs, shouldRetry } from './retry-policy.js';
import { runJob } from '../services/processing.service.js';

export async function executeClaimedJob(job) {
  try {
    await runJob(job);
  } catch (error) {
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
}
