import { validateRecordingLanguage } from '../validators/recording-language.validator.js';
import { getAiRegistry } from '../ai/provider-registry.js';
import { JOB_TYPE } from '../config/constants.js';
import { getReviewState, listWarnings } from '../repositories/review.repository.js';
import { validateGeneration } from '../validators/review.validator.js';
import { validateSummaryGeneration } from '../validators/summary-options.validator.js';
import { errors } from '../domain/errors.js';
import { validateCreateMaterial, validateMaterialPatch } from '../validators/material.validator.js';
import { assertSafeStoragePath } from '../validators/storage-path.validator.js';
import * as materials from '../repositories/material.repository.js';
import { getByMaterial as getTranscription } from '../repositories/transcription.repository.js';
import { listSummaries } from '../repositories/summary.repository.js';
import { listBatches } from '../repositories/question.repository.js';
import { createJob } from '../repositories/job.repository.js';
import { createAudioSignedUrl } from './audio.service.js';
import { isFeatureEnabled } from '../config/feature-flags.js';
import { videoService } from './video.service.js';

function assertStorageOwnership(storagePath, userId, materialId) {
  assertSafeStoragePath(storagePath);
  const expectedPrefix = `temp/${userId}/${materialId}/`;
  if (!storagePath.startsWith(expectedPrefix)) throw errors.forbidden();
}

export async function create(userId, input) {
  const data = validateCreateMaterial(input);
  assertStorageOwnership(data.storagePath, userId, data.id);
  return materials.createMaterial(userId, data);
}

export async function list(userId) {
  return materials.listMaterials(userId);
}

export async function get(userId, materialId) {
  const material = await materials.getOwnedMaterial(userId, materialId);
  const [transcription, summaries, batches, review, warnings] = await Promise.all([
    getTranscription(materialId),
    listSummaries(materialId),
    listBatches(materialId),
    getReviewState(userId, materialId),
    listWarnings(materialId),
  ]);
  const audio = Array.isArray(material.audio_files)
    ? material.audio_files[0]
    : material.audio_files;
  const signedAudioUrl =
    audio?.retain_original && audio?.storage_path
      ? await createAudioSignedUrl(audio.storage_path)
      : null;
  const currentRevision = transcription?.current_revision || 0;
  return {
    ...material,
    ...(isFeatureEnabled('mp4_retention') ? await videoService.playback(userId, materialId) : {}),
    audio,
    signedAudioUrl,
    transcription,
    review,
    warnings: warnings.map((warning) => ({
      ...warning,
      stale: warning.sourceRevisionId !== review.sourceRevisionId,
    })),
    summaries: summaries.map((s) => ({
      ...s,
      stale: s.source_transcription_revision < currentRevision,
    })),
    questionBatches: batches.map((b) => ({
      ...b,
      stale: b.source_transcription_revision < currentRevision,
    })),
  };
}

export async function patch(userId, materialId, input) {
  const patchData = validateMaterialPatch(input);
  const changes = {};
  if ('title' in patchData) changes.title = patchData.title;
  if ('subject' in patchData) {
    changes.subject = patchData.subject;
    // Legacy free-text edits explicitly unlink the structured catalog assignment.
    if (isFeatureEnabled('catalog_units')) {
      changes.subject_id = null;
      changes.unit_id = null;
    }
  }
  return materials.updateOwnedMaterial(userId, materialId, changes);
}

export async function remove(userId, materialId) {
  await videoService.remove(userId, materialId, { allowMissingSchema: true });
  return materials.deleteOwnedMaterial(userId, materialId);
}

export async function enqueueInitial(userId, materialId, input = {}) {
  const material = await materials.getOwnedMaterial(userId, materialId);
  const recordingLanguage = validateRecordingLanguage(
    input.recordingLanguage,
    getAiRegistry().config,
  );
  return createJob(userId, materialId, JOB_TYPE.INITIAL, {
    questionCount: material.initial_question_count,
    ...(recordingLanguage ? { recordingLanguage } : {}),
  });
}

export async function enqueueSummary(userId, materialId, input) {
  await materials.getOwnedMaterial(userId, materialId);
  const { selection, options } = validateSummaryGeneration(input);
  // Preserve params for legacy callers (including retries of already queued jobs).
  const params = input.options === undefined ? {} : { summaryOptions: options };
  return createJob(userId, materialId, JOB_TYPE.REGENERATE_SUMMARY, params, selection);
}
export async function enqueueQuestions(userId, materialId, count, input) {
  await materials.getOwnedMaterial(userId, materialId);
  const selection = validateGeneration(input);
  return createJob(userId, materialId, JOB_TYPE.GENERATE_QUESTIONS, { count }, selection);
}
