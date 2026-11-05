import * as repository from '../repositories/video.repository.js';
import { getOwnedMaterial } from '../repositories/material.repository.js';
import { AppError } from '../domain/errors.js';
import { validateVideo, videoMaterialId } from '../validators/video.validator.js';
import { assertSafeStoragePath } from '../validators/storage-path.validator.js';

function assertPath(row, userId, materialId) {
  assertSafeStoragePath(row.storage_path);
  if (row.storage_path !== `original/${userId}/${materialId}/source.mp4`)
    throw new AppError('VIDEO_PATH_CONFLICT', 'O caminho do vídeo não corresponde à aula.', 409);
}
export function videoDto(row) {
  return row ? { originalName: row.original_name, sizeBytes: Number(row.size_bytes),
    durationMs: Number(row.duration_ms), clipStartMs: Number(row.clip_start_ms),
    clipEndMs: Number(row.clip_end_ms) } : null;
}
export function buildVideoService(store = repository, getMaterial = getOwnedMaterial) {
  function matches(row, data) {
    return row && row.storage_path === data.storagePath && row.original_name === data.originalName &&
      Number(row.size_bytes) === data.sizeBytes && Number(row.duration_ms) === data.durationMs &&
      Number(row.clip_start_ms) === data.clipStartMs && Number(row.clip_end_ms) === data.clipEndMs;
  }
  return {
    async attach(userId, materialId, body) {
      videoMaterialId(materialId);
      const data = validateVideo(body, userId, materialId);
      const material = await getMaterial(userId, materialId);
      const audio = Array.isArray(material.audio_files) ? material.audio_files[0] : material.audio_files;
      if (!audio?.duration_ms || Math.abs(Number(audio.duration_ms) - (data.clipEndMs - data.clipStartMs)) > 1500)
        throw new AppError('VIDEO_RANGE_CONFLICT', 'O trecho do vídeo não corresponde ao áudio preparado.', 409);
      let row = await store.getOwnedVideo(userId, materialId);
      if (!row) {
        const { data: info, error } = await store.videoObjectInfo(data.storagePath);
        if (error || Number(info?.size) !== data.sizeBytes || info?.contentType !== 'video/mp4')
          throw new AppError('VIDEO_UPLOAD_REQUIRED', 'Confira o envio do MP4 original antes de vinculá-lo.', 409);
        row = await store.insertOwnedVideo(userId, materialId, data);
      }
      if (!matches(row, data)) throw new AppError('VIDEO_CONFLICT', 'Esta aula já possui outro vídeo ou recorte.', 409);
      return videoDto(row);
    },
    async playback(userId, materialId) {
      videoMaterialId(materialId);
      await getMaterial(userId, materialId);
      const row = await store.getOwnedVideo(userId, materialId);
      if (!row) return { video: null, signedVideoUrl: null };
      assertPath(row, userId, materialId);
      return { video: videoDto(row), signedVideoUrl: await store.signVideo(row.storage_path) };
    },
    async remove(userId, materialId, { allowMissingSchema = false } = {}) {
      videoMaterialId(materialId);
      await getMaterial(userId, materialId);
      const row = await store.getOwnedVideo(userId, materialId, allowMissingSchema);
      if (!row) return;
      assertPath(row, userId, materialId);
      // Keep the DB record if Storage fails, so a retry can still find and delete the object.
      await store.removeVideoObject(row.storage_path);
      await store.deleteOwnedVideo(userId, materialId);
    },
  };
}
export const videoService = buildVideoService();
