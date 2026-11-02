import { randomUUID } from 'node:crypto';
import { rpc } from './rpc.js';
import { PERMISSION_DECLARATION } from '../config/permission-declaration.js';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { env } from '../config/env.js';
import { errors } from '../domain/errors.js';

export async function createJob(
  userId,
  materialId,
  type,
  params = {},
  { sourceRevisionId = null, idempotencyKey = randomUUID() } = {},
) {
  return rpc('enqueue_processing_job_admin', {
    p_user_id: userId,
    p_material_id: materialId,
    p_type: type,
    p_params: params,
    p_source_version_id: sourceRevisionId,
    p_idempotency_key: idempotencyKey,
    p_permission_version: PERMISSION_DECLARATION.version,
    p_max_attempts: env.jobMaxAttempts,
  });
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

export async function claimNextJob(workerId) {
  const db = getAdminSupabase();
  const { data, error } = await db.rpc('claim_next_processing_job', { p_worker_id: workerId });
  if (error) throw error;
  return data?.[0] || null;
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
