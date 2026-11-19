import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError } from '../domain/errors.js';

const TABLE = 'ai_job_executions';

/** True when the AI migration has not been applied yet (table or function absent). */
export function isSchemaMissing(error) {
  return ['PGRST205', 'PGRST202', '42P01', '42883'].includes(error?.code);
}

export function schemaRequired() {
  return new AppError(
    'SCHEMA_UPGRADE_REQUIRED',
    'Aplique a migration 20261119030000_ai_executions.sql antes de usar provedores assíncronos.',
    503,
    { retryable: false },
  );
}

const toRow = (job, snapshot) => ({
  job_id: job.id,
  material_id: job.material_id,
  task: snapshot.task,
  provider: snapshot.provider,
  requested_model: snapshot.model,
  settings: snapshot.settings || {},
});

/** Inserts the snapshot once; a retried enqueue keeps the original row. */
export async function recordExecutionSnapshot(job, snapshot) {
  const db = getAdminSupabase();
  const { error } = await db
    .from(TABLE)
    .upsert(toRow(job, snapshot), { onConflict: 'job_id', ignoreDuplicates: true });
  if (error) throw error;
  return getExecution(job.id);
}

export async function getExecution(jobId) {
  const { data, error } = await getAdminSupabase()
    .from(TABLE)
    .select('*')
    .eq('job_id', jobId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Compare-and-set on `state`: returns the updated row, or null when another execution already
 * advanced it (duplicate or stale worker), so callers never overwrite newer progress.
 */
export async function transitionExecution(id, fromState, patch) {
  const { data, error } = await getAdminSupabase()
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('state', fromState)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export const executionStore = Object.freeze({
  record: recordExecutionSnapshot,
  get: getExecution,
  transition: transitionExecution,
});
