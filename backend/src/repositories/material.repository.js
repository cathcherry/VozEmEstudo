import { rpc } from './rpc.js';
import { PERMISSION_DECLARATION } from '../config/permission-declaration.js';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { errors } from '../domain/errors.js';
import { assertSafeStoragePath } from '../validators/storage-path.validator.js';
import { isFeatureEnabled } from '../config/feature-flags.js';

export async function createMaterial(userId, data) {
  return rpc('create_material_with_permission_admin', {
    p_user_id: userId,
    p_data: data,
    p_permission_version: PERMISSION_DECLARATION.version,
    p_permission_text: PERMISSION_DECLARATION.text,
  });
}

export async function listMaterials(userId) {
  const db = getAdminSupabase();
  const fields =
    'id,title,subject,status,current_stage,initial_question_count,created_at,updated_at,completed_at,audio_files(duration_ms,retain_original,extension,original_name)';
  const projection = isFeatureEnabled('catalog_units') ? `${fields},subject_id,unit_id` : fields;
  const { data, error } = await db
    .from('materials')
    .select(projection)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getOwnedMaterial(userId, materialId) {
  const db = getAdminSupabase();
  const { data, error } = await db
    .from('materials')
    .select('*,audio_files(*)')
    .eq('id', materialId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw errors.notFound('Material');
  return data;
}

export async function updateOwnedMaterial(userId, materialId, patch) {
  const db = getAdminSupabase();
  const { data, error } = await db
    .from('materials')
    .update(patch)
    .eq('id', materialId)
    .eq('user_id', userId)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw errors.notFound('Material');
  return data;
}

export async function setMaterialState(
  materialId,
  { status, currentStage = null, errorCode = null, errorMessage = null, completedAt = undefined },
) {
  const db = getAdminSupabase();
  const patch = {
    status,
    current_stage: currentStage,
    last_error_code: errorCode,
    last_error_message: errorMessage,
  };
  if (completedAt !== undefined) patch.completed_at = completedAt;
  const { error } = await db.from('materials').update(patch).eq('id', materialId);
  if (error) throw error;
}

export async function deleteOwnedMaterial(userId, materialId) {
  const db = getAdminSupabase();
  const material = await getOwnedMaterial(userId, materialId);
  const audio = Array.isArray(material.audio_files)
    ? material.audio_files[0]
    : material.audio_files;
  if (audio?.storage_path) {
    assertSafeStoragePath(audio.storage_path);
    await db.storage.from('audios').remove([audio.storage_path]);
  }
  const { error } = await db.from('materials').delete().eq('id', materialId).eq('user_id', userId);
  if (error) throw error;
}
