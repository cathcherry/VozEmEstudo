import { apiFetch } from './http.js';
import { getSupabase } from './supabase-browser.js';
import { getPublicConfig } from './config.js';

export const listMaterials = () => apiFetch('/api/materials');
export const getMaterial = (id) => apiFetch(`/api/materials/${id}`);
export const deleteMaterial = (id) => apiFetch(`/api/materials/${id}`, { method: 'DELETE' });
export const updateMaterial = (id, body) =>
  apiFetch(`/api/materials/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const processMaterial = (id) => apiFetch(`/api/materials/${id}/process`, { method: 'POST' });
export const regenerateSummary = (id, sourceRevisionId, idempotencyKey, options = {}) =>
  apiFetch(`/api/materials/${id}/summaries`, {
    method: 'POST',
    body: JSON.stringify({ sourceRevisionId, idempotencyKey, ...options }),
  });
export const generateQuestions = (id, count, sourceRevisionId, idempotencyKey) =>
  apiFetch(`/api/materials/${id}/question-batches`, {
    method: 'POST',
    body: JSON.stringify({ count, sourceRevisionId, idempotencyKey }),
  });
export const saveTranscriptionEdits = (id, expectedRevision, segments) =>
  apiFetch(`/api/materials/${id}/transcription`, {
    method: 'PATCH',
    body: JSON.stringify({ expectedRevision, segments }),
  });
export const getTranscriptionVersions = (id) =>
  apiFetch(`/api/materials/${id}/transcription/versions`);
export const restoreTranscriptionVersion = (id, revision) =>
  apiFetch(`/api/materials/${id}/transcription/versions/${revision}/restore`, { method: 'POST' });
export const answerQuestion = (id, selectedIndex) =>
  apiFetch(`/api/questions/${id}/answer`, {
    method: 'POST',
    body: JSON.stringify({ selectedIndex }),
  });

export async function createMaterialWithUpload({
  file,
  title,
  subject,
  questionCount,
  retainAudio,
  durationMs,
  permissionAccepted,
  permissionVersion,
  id = crypto.randomUUID(),
}) {
  if (permissionAccepted !== true)
    throw new Error('Confirme a declaração de permissão antes de enviar.');
  const supabase = await getSupabase();
  const config = await getPublicConfig();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error('Sessão inválida. Entre novamente.');

  async function recoverExisting() {
    try {
      const existing = await getMaterial(id);
      if (
        existing.title !== title ||
        (existing.subject || '') !== (subject || '') ||
        existing.initial_question_count !== questionCount ||
        existing.audio?.retain_original !== retainAudio
      ) {
        const conflict = new Error(
          'Este envio já existe com escolhas diferentes. Revise o formulário.',
        );
        conflict.code = 'IDEMPOTENCY_CONFLICT';
        throw conflict;
      }
      return existing;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }
  const existing = await recoverExisting();
  if (existing) return existing;
  const extension = file.name.split('.').pop().toLowerCase();
  const safeName = file.name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(0, 150);
  const storagePath = `temp/${userData.user.id}/${id}/${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(config.audioBucket)
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    });
  if (uploadError) {
    // The same UUID may have an uploaded object after an interrupted POST. Never overwrite it.
    const recovered = await recoverExisting();
    if (recovered) return recovered;
    const duplicate =
      uploadError.statusCode === '409' ||
      /already exists|duplicate/i.test(uploadError.message || '');
    if (!duplicate && Number(uploadError.statusCode) < 500) throw uploadError;
    const { data: info, error: infoError } = await supabase.storage
      .from(config.audioBucket)
      .info(storagePath);
    if (infoError || info?.size !== file.size || (file.type && info.contentType !== file.type))
      throw uploadError;
  }

  try {
    const material = await apiFetch('/api/materials', {
      method: 'POST',
      body: JSON.stringify({
        id,
        title,
        subject: subject || null,
        originalFilename: file.name,
        mimeType: file.type || 'application/octet-stream',
        extension,
        sizeBytes: file.size,
        durationMs,
        questionCount,
        retainAudio,
        storagePath,
        permissionAccepted,
        permissionVersion,
      }),
    });
    return material;
  } catch (error) {
    if (!error.status || error.status >= 500) {
      const recovered = await recoverExisting().catch(() => null);
      if (recovered) return recovered;
    }
    // An ambiguous network/server failure may already have committed; preserve its bytes for recovery.
    if (
      (error.status >= 400 && error.status < 500 && error.code !== 'IDEMPOTENCY_CONFLICT') ||
      error.code === 'SCHEMA_UPGRADE_REQUIRED'
    ) {
      await supabase.storage
        .from(config.audioBucket)
        .remove([storagePath])
        .catch(() => {});
    }
    throw error;
  }
}

export const declareMaterialPermission = (id, permissionVersion) =>
  apiFetch(`/api/materials/${id}/permission`, {
    method: 'POST',
    body: JSON.stringify({ permissionAccepted: true, permissionVersion }),
  });
export const confirmTranscription = (id, sourceRevisionId) =>
  apiFetch(`/api/materials/${id}/transcription/confirm`, {
    method: 'POST',
    body: JSON.stringify({ sourceRevisionId }),
  });
export const refreshWarnings = (id, sourceRevisionId, idempotencyKey) =>
  apiFetch(`/api/materials/${id}/transcription/warnings`, {
    method: 'POST',
    body: JSON.stringify({ sourceRevisionId, idempotencyKey }),
  });
