import { randomUUID } from 'node:crypto';
import { rpc } from './rpc.js';
import { PERMISSION_DECLARATION } from '../config/permission-declaration.js';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { env } from '../config/env.js';
import { errors } from '../domain/errors.js';
import { getAiRegistry } from '../ai/provider-registry.js';
import { applyRecordingLanguage } from '../ai/provider-config.js';
import { recordExecutionSnapshot } from './ai-execution.repository.js';
import { logger } from '../utils/logger.js';

const JOB_TASK = Object.freeze({
  PROCESSAMENTO_INICIAL: 'transcription',
  REGERAR_RESUMO: 'summary',
  GERAR_QUESTOES: 'questions',
});

/** Pins provider/model at enqueue; if this write fails the worker records it when claiming. */
async function snapshotProviders(job) {
  const task = JOB_TASK[job?.type];
  if (!task) return;
  try {
    await recordExecutionSnapshot(
      job,
      applyRecordingLanguage(getAiRegistry().snapshot(task), job.params?.recordingLanguage),
    );
  } catch (error) {
    logger.info('AI_SNAPSHOT_DEFERRED', { jobId: job.id, code: error?.code || 'UNKNOWN' });
  }
}

export async function createJob(
  userId,
  materialId,
  type,
  params = {},
  { sourceRevisionId = null, idempotencyKey = randomUUID() } = {},
) {
  const job = await rpc('enqueue_processing_job_admin', {
    p_user_id: userId,
    p_material_id: materialId,
    p_type: type,
    p_params: params,
    p_source_version_id: sourceRevisionId,
    p_idempotency_key: idempotencyKey,
    p_permission_version: PERMISSION_DECLARATION.version,
    p_max_attempts: env.jobMaxAttempts,
  });
  await snapshotProviders(job);
  return job;
}

/** Question list with a custom count (1-100); same ownership/confirmation rules as createJob. */
export async function createQuestionListJob(
  userId,
  materialId,
  params,
  { sourceRevisionId, idempotencyKey = randomUUID() },
) {
  const job = await rpc('enqueue_question_list_admin', {
    p_user_id: userId,
    p_material_id: materialId,
    p_params: params,
    p_source_version_id: sourceRevisionId,
    p_idempotency_key: idempotencyKey,
    p_permission_version: PERMISSION_DECLARATION.version,
    p_max_attempts: env.jobMaxAttempts,
  });
  await snapshotProviders(job);
  return job;
}

export async function getOwnedJob(userId, jobId) {
  const db = getAdminSupabase();
  const { data, error } = await db
    .from('processing_jobs')
    .select('*,materials!inner(user_id)')
    .eq('id', jobId)
    .eq('materials.user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw errors.notFound('Tarefa');
  delete data.materials;
  return data;
}

/** The job a generation (3.3 reuse) created on one of the account's lessons, or null. */
export async function findOwnedJobByGeneration(userId, materialId, generationId) {
  const db = getAdminSupabase();
  const { data, error } = await db
    .from('processing_jobs')
    .select('*,materials!inner(user_id)')
    .eq('material_id', materialId)
    .eq('materials.user_id', userId)
    .eq('params->>generationId', generationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  delete data.materials;
  return data;
}

export async function listOwnedEvents(userId, jobId) {
  await getOwnedJob(userId, jobId);
  const db = getAdminSupabase();
  const { data, error } = await db
    .from('processing_job_events')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

let staleClaimAvailable = true;

/**
 * Claims the next due job. With a stale-lease window (default 600 s) the claim also recovers jobs
 * whose worker stopped mid-task (closed window, crash, lost network); running jobs renew their
 * lease with renewJobLease, so a long job is not mistaken for a dead one. Databases without the
 * newer claim function (migration 20261119030000_ai_executions.sql) fall back to the plain claim.
 */
export async function claimNextJob(workerId) {
  const db = getAdminSupabase();
  const stale = env.workerStaleLeaseSeconds;
  if (stale > 0 && staleClaimAvailable) {
    const { data, error } = await db.rpc('claim_next_processing_job', {
      p_worker_id: workerId,
      p_stale_after_seconds: stale,
    });
    if (!error) return data?.[0] || null;
    if (error.code !== 'PGRST202') throw error;
    staleClaimAvailable = false;
    logger.warn('WORKER_STALE_LEASE_UNAVAILABLE', {
      hint: 'Aplique 20261119030000_ai_executions.sql para recuperar tarefas interrompidas.',
    });
  }
  const { data, error } = await db.rpc('claim_next_processing_job', { p_worker_id: workerId });
  if (error) throw error;
  return data?.[0] || null;
}

/** Keeps a running job's lease fresh. Only the worker that holds the lock can renew it. */
export async function renewJobLease(jobId, workerId) {
  const db = getAdminSupabase();
  const { error } = await db
    .from('processing_jobs')
    .update({ locked_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('locked_by', workerId)
    .eq('status', 'EM_EXECUCAO');
  if (error) throw error;
}

export async function updateJob(jobId, patch) {
  const db = getAdminSupabase();
  const { error } = await db.from('processing_jobs').update(patch).eq('id', jobId);
  if (error) throw error;
}

export async function addJobEvent(jobId, { status = null, stage = null, message = null }) {
  const db = getAdminSupabase();
  const { error } = await db
    .from('processing_job_events')
    .insert({ job_id: jobId, status, stage, message });
  if (error) throw error;
}
