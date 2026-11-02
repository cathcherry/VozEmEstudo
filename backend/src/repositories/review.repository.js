import { rpc } from './rpc.js';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { PERMISSION_DECLARATION } from '../config/permission-declaration.js';

export const declarePermission = (userId, materialId) =>
  rpc('declare_material_permission_admin', {
    p_user_id: userId,
    p_material_id: materialId,
    p_permission_version: PERMISSION_DECLARATION.version,
    p_permission_text: PERMISSION_DECLARATION.text,
  });
export const requirePermission = (userId, materialId) =>
  rpc('require_material_permission_admin', {
    p_user_id: userId,
    p_material_id: materialId,
    p_permission_version: PERMISSION_DECLARATION.version,
  });
export const confirmRevision = (userId, materialId, sourceRevisionId) =>
  rpc('confirm_transcription_admin', {
    p_user_id: userId,
    p_material_id: materialId,
    p_source_version_id: sourceRevisionId,
    p_permission_version: PERMISSION_DECLARATION.version,
  });
export const getReviewState = (userId, materialId) =>
  rpc('get_transcription_review_admin', {
    p_user_id: userId,
    p_material_id: materialId,
    p_permission_version: PERMISSION_DECLARATION.version,
  }).then((review) => ({
    ...review,
    confirmation: review.confirmation
      ? {
          id: review.confirmation.id,
          userId: review.confirmation.user_id,
          materialId: review.confirmation.material_id,
          sourceRevisionId: review.confirmation.transcription_version_id,
          consentVersion: review.confirmation.consent_version,
          confirmedAt: new Date(review.confirmation.confirmed_at).toISOString(),
        }
      : null,
  }));
export const getGenerationSource = (job) =>
  rpc('get_generation_source_admin', {
    p_material_id: job.material_id,
    p_job_id: job.id,
  });
export async function listWarnings(materialId) {
  const { data, error } = await getAdminSupabase()
    .from('content_warnings')
    .select('*')
    .eq('material_id', materialId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data || []).map(warningDto);
}
export const saveWarnings = (userId, materialId, sourceRevisionId, analysisId, warnings) =>
  rpc('save_content_warnings_admin', {
    p_user_id: userId,
    p_material_id: materialId,
    p_source_version_id: sourceRevisionId,
    p_analysis_id: analysisId,
    p_warnings: warnings,
  }).then((rows) => rows.map(warningDto));
function warningDto(row) {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    materialId: row.material_id,
    sourceRevisionId: row.revision_id,
    type: row.type,
    state: row.state,
    explanation: row.explanation,
    guidance: row.guidance,
    segmentRefs: row.segment_refs,
    model: row.model,
    promptVersion: row.prompt_version,
    contextSubject: row.context_subject,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function getWarningAnalysis(materialId, analysisId) {
  const { data, error } = await getAdminSupabase()
    .from('content_warnings')
    .select('*')
    .eq('material_id', materialId)
    .eq('analysis_id', analysisId)
    .order('type', { ascending: true });
  if (error) throw error;
  return (data || []).map(warningDto).sort((a, b) => a.type.localeCompare(b.type));
}
