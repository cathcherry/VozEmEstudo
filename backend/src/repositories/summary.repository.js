import { rpc } from './rpc.js';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';

export const createSummaryVersion = (materialId, { jobId, text, model, promptVersion }) =>
  rpc('commit_summary_admin', {
    p_material_id: materialId,
    p_job_id: jobId,
    p_text: text,
    p_model: model,
    p_prompt_version: promptVersion,
  });

export async function listSummaries(materialId) {
  const db = getAdminSupabase();
  const { data, error } = await db
    .from('summary_versions')
    .select('*')
    .eq('material_id', materialId)
    .order('version', { ascending: false });
  if (error) throw error;
  return data || [];
}
