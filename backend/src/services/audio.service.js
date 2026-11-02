import { AppError } from '../domain/errors.js';
import { env } from '../config/env.js';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { assertSafeStoragePath } from '../validators/storage-path.validator.js';

export async function downloadAudioBuffer(storagePath) {
  assertSafeStoragePath(storagePath);
  const db = getAdminSupabase();
  const { data, error } = await db.storage.from(env.audioBucket).download(storagePath);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

export async function finalizeAudioStorage(audio) {
  if (!audio?.storage_path) return null;
  assertSafeStoragePath(audio.storage_path);
  const db = getAdminSupabase();
  const bucket = db.storage.from(env.audioBucket);

  if (!audio.retain_original) {
    const { error } = await bucket.remove([audio.storage_path]);
    if (error) throw finalizationError();
    const { error: updateError } = await db
      .from('audio_files')
      .update({ storage_path: null, deleted_at: new Date().toISOString() })
      .eq('id', audio.id);
    if (updateError) throw finalizationError();
    return null;
  }

  if (audio.storage_path.startsWith('retained/')) return audio.storage_path;
  const fileName = audio.storage_path.split('/').pop();
  const parts = audio.storage_path.split('/');
  const userId = parts[1];
  const materialId = audio.material_id;
  const retainedPath = `retained/${userId}/${materialId}/${fileName}`;
  assertSafeStoragePath(retainedPath);
  const { error } = await bucket.move(audio.storage_path, retainedPath);
  if (error) {
    // Storage and PostgreSQL cannot share a transaction. Reconcile a move committed before a DB failure.
    const [{ data: target, error: targetError }, { error: sourceError }] = await Promise.all([
      bucket.info(retainedPath),
      bucket.info(audio.storage_path),
    ]);
    const sourceMissing =
      sourceError &&
      (Number(sourceError.statusCode) === 404 ||
        /not.?found|no.?such.?key/i.test(sourceError.message));
    if (targetError || target?.size !== Number(audio.size_bytes) || !sourceMissing)
      throw finalizationError();
  }
  const { error: updateError } = await db
    .from('audio_files')
    .update({ storage_path: retainedPath })
    .eq('id', audio.id);
  if (updateError) throw finalizationError();
  return retainedPath;
}

export async function createAudioSignedUrl(storagePath, expiresInSeconds = 600) {
  if (!storagePath) return null;
  assertSafeStoragePath(storagePath);
  const db = getAdminSupabase();
  const { data, error } = await db.storage
    .from(env.audioBucket)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw error;
  return data?.signedUrl || data?.signedURL || null;
}

function finalizationError() {
  return new AppError(
    'STORAGE_FINALIZATION_PENDING',
    'Não foi possível concluir a conservação ou limpeza do áudio. O sistema tentará novamente.',
    503,
    { retryable: true },
  );
}
