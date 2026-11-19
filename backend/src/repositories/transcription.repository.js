import { rpc } from './rpc.js';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { errors } from '../domain/errors.js';

export async function createInitialTranscription(materialId, result) {
  // Results with word timings also store their alignment atomically (AI migration required).
  const name = result.words?.length
    ? 'create_initial_transcription_with_alignment_admin'
    : 'create_initial_transcription_admin';
  return rpc(name, { p_material_id: materialId, p_result: result });
}

export async function getByMaterial(materialId) {
  const db = getAdminSupabase();
  const { data, error } = await db
    .from('transcriptions')
    .select('*,transcription_segments(*)')
    .eq('material_id', materialId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  data.transcription_segments = (data.transcription_segments || []).sort(
    (a, b) => a.position - b.position,
  );
  return data;
}

export async function listVersions(materialId) {
  const transcription = await getByMaterial(materialId);
  if (!transcription) throw errors.notFound('Transcrição');
  const db = getAdminSupabase();
  const { data, error } = await db
    .from('transcription_versions')
    .select('id,revision,origin,full_text,segments_snapshot,created_at')
    .eq('transcription_id', transcription.id)
    .order('revision', { ascending: false });
  if (error) throw error;
  return data || [];
}

export const applyEdits = (materialId, expectedRevision, edits, userId) =>
  rpc('apply_transcription_edits_owned_admin', {
    p_user_id: userId,
    p_material_id: materialId,
    p_expected_revision: expectedRevision,
    p_edits: edits,
  });
export const restoreRevision = (materialId, revision, userId) =>
  rpc('restore_transcription_revision_owned_admin', {
    p_user_id: userId,
    p_material_id: materialId,
    p_revision: revision,
  });
export async function getVersion(materialId, sourceRevisionId) {
  const transcription = await getByMaterial(materialId);
  if (!transcription) throw errors.notFound('Transcrição');
  const { data, error } = await getAdminSupabase()
    .from('transcription_versions')
    .select('*')
    .eq('id', sourceRevisionId)
    .eq('transcription_id', transcription.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw errors.notFound('Revisão');
  return data;
}
