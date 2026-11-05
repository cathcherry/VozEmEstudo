import { apiFetch } from './http.js';
import { getSupabase } from './supabase-browser.js';

export const getPlayback = (id) => apiFetch(`/api/materials/${encodeURIComponent(id)}/playback`);
export const removeOriginalVideo = (id) => apiFetch(`/api/materials/${encodeURIComponent(id)}/video`, { method: 'DELETE' });

export async function retainOriginalVideo(materialId, { file, durationMs, range }) {
  if (file.name.split('.').pop().toLowerCase() !== 'mp4') throw new Error('A conservação original aceita somente MP4.');
  const supabase = await getSupabase();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('Entre novamente para guardar o vídeo.');
  const path = `original/${auth.user.id}/${materialId}/source.mp4`;
  const bucket = supabase.storage.from('study-videos');
  const { error } = await bucket.upload(path, file, { upsert: false, contentType: 'video/mp4' });
  if (error) {
    // Never overwrite original bytes. Recover an upload committed before a lost response.
    const { data: existing, error: infoError } = await bucket.info(path);
    if (infoError || Number(existing?.size) !== file.size || existing?.contentType !== 'video/mp4') throw error;
  }
  return apiFetch(`/api/materials/${encodeURIComponent(materialId)}/video`, {
    method: 'POST', body: JSON.stringify({ storagePath: path, originalName: file.name,
      sizeBytes: file.size, durationMs, clipStartMs: Math.round(range.start * 1000),
      clipEndMs: Math.min(durationMs, Math.round(range.end * 1000)) }),
  });
}
