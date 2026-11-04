import { JOB_TYPE } from '../config/constants.js';
import { getReviewState, listWarnings } from '../repositories/review.repository.js';
import { validateGeneration } from '../validators/review.validator.js';
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
  return materials.deleteOwnedMaterial(userId, materialId);
}

export async function enqueueInitial(userId, materialId) {
  const material = await materials.getOwnedMaterial(userId, materialId);
  return createJob(userId, materialId, JOB_TYPE.INITIAL, {
    questionCount: material.initial_question_count,
  });
}

export async function enqueueSummary(userId, materialId, input) {
  await materials.getOwnedMaterial(userId, materialId);
  const selection = validateGeneration(input);
  return createJob(userId, materialId, JOB_TYPE.REGENERATE_SUMMARY, {}, selection);
}
export async function enqueueQuestions(userId, materialId, count, input) {
  await materials.getOwnedMaterial(userId, materialId);
  const selection = validateGeneration(input);
  return createJob(userId, materialId, JOB_TYPE.GENERATE_QUESTIONS, { count }, selection);
}
