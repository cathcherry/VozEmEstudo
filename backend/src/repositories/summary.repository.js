import { rpc } from './rpc.js';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';

const legacyCommit = (materialId, { jobId, text, model, promptVersion }) =>
  rpc('commit_summary_admin', {
    p_material_id: materialId,
    p_job_id: jobId,
    p_text: text,
    p_model: model,
    p_prompt_version: promptVersion,
  });

/**
 * Records the summary with its name, options and provider. Before the study-authoring migration
 * the E02 commit is used unchanged: the text is kept and the options remain in the job params.
 */
export async function createSummaryVersion(materialId, summary) {
  try {
    return await rpc('commit_named_summary_admin', {
      p_material_id: materialId,
      p_job_id: summary.jobId,
      p_text: summary.text,
      p_model: summary.model,
      p_prompt_version: summary.promptVersion,
      p_label: summary.label || null,
      p_options: summary.options || {},
      p_provider: summary.provider || null,
    });
  } catch (error) {
    if (error.code !== 'SCHEMA_UPGRADE_REQUIRED') throw error;
    return legacyCommit(materialId, summary);
  }
}

export const renameSummary = (userId, materialId, summaryId, label) =>
  rpc('rename_summary_admin', {
    p_user_id: userId,
    p_material_id: materialId,
    p_summary_id: summaryId,
    p_label: label,
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
