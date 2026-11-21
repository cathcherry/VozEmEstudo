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
import { createJob, createQuestionListJob, getOwnedJob, findOwnedJobByGeneration } from '../repositories/job.repository.js';
import { generationReuseEnabled, beginGeneration, attachGenerationJob } from './generation-reuse.service.js';
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

export async function enqueueSummary(userId, materialId, rawInput) {
  await materials.getOwnedMaterial(userId, materialId);
  // `reuse` (3.3) accepts an equivalent finished result instead of a new AI call.
  const { reuse, classroomId, ...input } = rawInput || {};
  const { selection, options } = validateSummaryGeneration(input);
  // Preserve params for legacy callers (including retries of already queued jobs).
  const params = input.options === undefined ? {} : { summaryOptions: options };
  if (generationReuseEnabled())
    return queueGeneration(userId, materialId, 'summary', params, selection, { allowReuse: reuse === true, classroomId }, (p) =>
      createJob(userId, materialId, JOB_TYPE.REGENERATE_SUMMARY, p, selection));
  return createJob(userId, materialId, JOB_TYPE.REGENERATE_SUMMARY, params, selection);
}
export async function enqueueQuestions(userId, materialId, count, rawInput, config) {
  await materials.getOwnedMaterial(userId, materialId);
  const { reuse, classroomId, ...input } = rawInput || {};
  const selection = validateGeneration(input);
  // Without a config the request keeps its legacy params shape (and idempotency comparison).
  const params = config === undefined ? { count } : { count, config };
  if (generationReuseEnabled())
    return queueGeneration(userId, materialId, 'questions', params, selection, { allowReuse: reuse === true, classroomId }, (p) =>
      isFeatureEnabled('study_authoring')
        ? createQuestionListJob(userId, materialId, p, selection)
        : createJob(userId, materialId, JOB_TYPE.GENERATE_QUESTIONS, p, selection));
  if (isFeatureEnabled('study_authoring'))
    return createQuestionListJob(userId, materialId, params, selection);
  return createJob(userId, materialId, JOB_TYPE.GENERATE_QUESTIONS, params, selection);
}

/**
 * A `join` can arrive in the few milliseconds between the first request starting the generation
 * and attaching its job (double click, five tabs). Without a job id the client cannot follow the
 * job, so wait briefly for the job the first request is creating (tagged with the generation id).
 */
export async function waitForGenerationJob(lookup, { attempts = 12, delayMs = 250, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const job = await lookup().catch(() => null);
    if (job) return job;
    if (attempt < attempts - 1) await sleep(delayMs);
  }
  return null;
}

/**
 * Generation reuse (3.3): the same job response shape is returned in every case, so the client
 * keeps polling a job. `reuse` → the finished job of the equivalent result; `join` → the job that
 * is already running; `start` → a new job tagged with its generation id.
 */
async function queueGeneration(userId, materialId, kind, params, selection, { allowReuse, classroomId }, queue) {
  const outcome = await beginGeneration({
    userId,
    materialId,
    kind,
    sourceRevisionId: selection.sourceRevisionId,
    params,
    allowReuse,
    classroomId: typeof classroomId === 'string' && /^[0-9a-f-]{36}$/i.test(classroomId) ? classroomId : null,
  });
  const generation = outcome.generation;
  if (outcome.decision !== 'start') {
    const jobId = generation.job_id || generation.result?.jobId;
    const job = jobId
      ? await getOwnedJob(userId, jobId).catch(() => null)
      : await waitForGenerationJob(() => findOwnedJobByGeneration(userId, materialId, generation.id));
    return { ...(job || { status: 'PENDENTE', material_id: materialId }), generation: { id: generation.id, decision: outcome.decision } };
  }
  // A retry with the same idempotency key keeps the original params (and generation) of its job.
  const job = await queue({ ...params, generationId: generation.id });
  if (job.params?.generationId === generation.id) await attachGenerationJob(generation.id, job.id);
  return { ...job, generation: { id: generation.id, decision: 'start' } };
}
