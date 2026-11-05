import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError, errors } from '../domain/errors.js';

export const VIDEO_BUCKET = 'study-videos';
function assertVideoDb(error) {
  if (!error) return;
  if (['42P01', 'PGRST205'].includes(error.code))
    throw new AppError('VIDEO_SCHEMA_REQUIRED', 'A conservação de vídeos ainda não foi habilitada no banco.', 503);
  if (error.code === '23503') throw errors.notFound('Aula');
  throw error;
}
export async function getOwnedVideo(userId, materialId, allowMissingSchema = false) {
  const { data, error } = await getAdminSupabase().from('material_videos')
    .select('*').eq('material_id', materialId).eq('user_id', userId).maybeSingle();
  if (allowMissingSchema && ['42P01', 'PGRST205'].includes(error?.code)) return null;
  assertVideoDb(error);
  return data;
}
export async function insertOwnedVideo(userId, materialId, item) {
  const { data, error } = await getAdminSupabase().from('material_videos').insert({
    user_id: userId, material_id: materialId, original_name: item.originalName,
    storage_path: item.storagePath, size_bytes: item.sizeBytes, duration_ms: item.durationMs,
    clip_start_ms: item.clipStartMs, clip_end_ms: item.clipEndMs,
  }).select('*').single();
  if (error?.code === '23505') return getOwnedVideo(userId, materialId);
  assertVideoDb(error);
  return data;
}
export async function deleteOwnedVideo(userId, materialId) {
  const { error } = await getAdminSupabase().from('material_videos').delete()
    .eq('user_id', userId).eq('material_id', materialId);
  assertVideoDb(error);
}
export const videoObjectInfo = (path) => getAdminSupabase().storage.from(VIDEO_BUCKET).info(path);
export async function signVideo(path) {
  const { data, error } = await getAdminSupabase().storage.from(VIDEO_BUCKET).createSignedUrl(path, 600);
  if (error) throw error;
  return data?.signedUrl || data?.signedURL;
}
export async function removeVideoObject(path) {
  const { error } = await getAdminSupabase().storage.from(VIDEO_BUCKET).remove([path]);
  if (error) throw error;
}
