import { JOB_STATUS, JOB_TYPE, MATERIAL_STATUS, PROCESSING_STAGE } from '../config/constants.js';
import { completeGeneration } from './generation-reuse.service.js';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { logger } from '../utils/logger.js';
import {
  createInitialTranscription,
  getByMaterial as getTranscription,
  getVersion,
} from '../repositories/transcription.repository.js';
import { listSummaries } from '../repositories/summary.repository.js';
import { listBatches } from '../repositories/question.repository.js';
import { addJobEvent, updateJob } from '../repositories/job.repository.js';
import { setMaterialState } from '../repositories/material.repository.js';
import {
  getGenerationSource,
  getReviewState,
  requirePermission,
} from '../repositories/review.repository.js';
import { convertMedia } from './media.service.js';
import { downloadAudioBuffer, finalizeAudioStorage } from './audio.service.js';
import { transcribeMaterial } from './transcription.service.js';
import { createAsyncTranscriptionRunner } from './async-transcription.service.js';
import {
  executionStore,
  isSchemaMissing,
  schemaRequired,
} from '../repositories/ai-execution.repository.js';
import { getAiRegistry } from '../ai/provider-registry.js';
import { applyRecordingLanguage } from '../ai/provider-config.js';
import { AppError } from '../domain/errors.js';
import { generateSummary } from './summary.service.js';
import { generateQuestions } from './question.service.js';
import { evaluateWarnings, initialWarningAnalysisId } from './warnings.service.js';

/** Provider/model pinned at enqueue (recorded now for jobs enqueued before the snapshot existed). */
async function executionFor(job, task) {
  try {
    return (
      (await executionStore.get(job.id)) ||
      (await executionStore.record(
        job,
        applyRecordingLanguage(getAiRegistry().snapshot(task), job.params?.recordingLanguage),
      ))
    );
  } catch (error) {
    // Before the AI migration only synchronous providers with live configuration can run.
    if (isSchemaMissing(error)) return null;
    throw error;
  }
}
const snapshotOf = (execution) =>
  execution && {
    task: execution.task,
    provider: execution.provider,
    model: execution.requested_model,
    settings: execution.settings || {},
  };

/** Frees the worker while the external provider transcribes; polling does not consume attempts. */
async function releaseForPolling(job, delayMs, message) {
  await updateJob(job.id, {
    status: JOB_STATUS.WAITING_RETRY,
    current_stage: PROCESSING_STAGE.TRANSCRIPTION,
    next_attempt_at: new Date(Date.now() + delayMs).toISOString(),
    locked_at: null,
    locked_by: null,
    error_code: null,
    error_message: null,
    attempt_count: Math.max(0, Number(job.attempt_count) - 1),
  });
  if (message)
    await addJobEvent(job.id, {
      status: JOB_STATUS.WAITING_RETRY,
      stage: PROCESSING_STAGE.TRANSCRIPTION,
      message,
    });
}

/**
 * Downloads the stored audio for a provider. MP4 is always reduced to WAV. Uploads are now
 * compact MP3 ('speech'); AssemblyAI reads it directly, while synchronous providers (the
 * Whisper fallback labels its input as WAV) get WAV.
 */
async function loadProviderAudio(audio, { wavOnly }) {
  const bytes = await downloadAudioBuffer(audio.storage_path);
  const extension = String(audio.extension || '').toLowerCase();
  if (extension === 'mp4' || (wavOnly && extension !== 'wav'))
    return (await convertMedia(bytes, extension, { output: 'wav' })).buffer;
  return bytes;
}

async function transcribeWithProvider(job, material, audio) {
  const loadAudio = () => loadProviderAudio(audio, { wavOnly: false });
  const execution = await executionFor(job, 'transcription');
  const { provider, snapshot } = getAiRegistry().transcription(snapshotOf(execution) || undefined);
  const durationMs = audio.duration_ms || 0;
  if (provider.mode === 'sync') {
    await stage(job, PROCESSING_STAGE.TRANSCRIPTION, 'Transcrevendo o áudio.');
    await transcribeMaterial(material.id, await loadProviderAudio(audio, { wavOnly: true }), {
      durationMs,
      snapshot,
    });
    return 'completed';
  }
  if (!execution) throw schemaRequired();
  const firstStep = ['pending', 'uploaded'].includes(execution.state);
  if (firstStep)
    await stage(job, PROCESSING_STAGE.TRANSCRIPTION, 'Enviando o áudio para transcrição.');
  const { asr } = getAiRegistry().config;
  const advance = createAsyncTranscriptionRunner({
    store: executionStore,
    persist: (result) => createInitialTranscription(material.id, result),
  });
  const outcome = await advance(execution, provider, {
    loadAudio,
    durationMs,
    pollIntervalMs: asr.pollIntervalMs,
    maxWaitMs: asr.maxWaitMs,
  });
  if (outcome.status === 'waiting') {
    await releaseForPolling(
      job,
      outcome.delayMs,
      firstStep ? 'Áudio enviado. Aguardando o provedor de transcrição.' : null,
    );
    return 'waiting';
  }
  return 'completed';
}

/** Explicit, observable fallback (ASR_FALLBACK_PROVIDER); never chosen implicitly. */
async function transcribeWithFallback(job, material, audio) {
  try {
    return await transcribeWithProvider(job, material, audio);
  } catch (error) {
    const fallback = getAiRegistry().config.asr.fallbackProvider;
    if (!fallback || !(error instanceof AppError) || error.retryable) throw error;
    const { provider, snapshot } = getAiRegistry().transcription({
      ...applyRecordingLanguage(
        getAiRegistry().snapshot('transcription'),
        job.params?.recordingLanguage,
      ),
      provider: fallback,
      model: null,
    });
    if (provider.mode !== 'sync') throw error;
    logger.info('ASR_FALLBACK_USED', { jobId: job.id, from: error.code, to: fallback });
    await addJobEvent(job.id, {
      status: JOB_STATUS.RUNNING,
      stage: PROCESSING_STAGE.TRANSCRIPTION,
      message: `Transcrição principal falhou (${error.code}); usando o provedor alternativo configurado.`,
    });
    const bytes = await loadProviderAudio(audio, { wavOnly: true });
    await transcribeMaterial(material.id, bytes, { durationMs: audio.duration_ms || 0, snapshot });
    return 'completed';
  }
}

async function getMaterialForWorker(materialId) {
  const { data, error } = await getAdminSupabase()
    .from('materials')
    .select('*,audio_files(*)')
    .eq('id', materialId)
    .single();
  if (error) throw error;
  return data;
}
async function stage(job, stageName, message) {
  await updateJob(job.id, { current_stage: stageName });
  await setMaterialState(job.material_id, {
    status: MATERIAL_STATUS.PROCESSING,
    currentStage: stageName,
  });
  await addJobEvent(job.id, { status: JOB_STATUS.RUNNING, stage: stageName, message });
}
export async function runJob(job) {
  logger.info('JOB_STARTED', {
    jobId: job.id,
    materialId: job.material_id,
    type: job.type,
    attempt: job.attempt_count,
  });
  await addJobEvent(job.id, {
    status: JOB_STATUS.RUNNING,
    stage: job.current_stage,
    message: 'Processamento iniciado.',
  });
  if (job.type === JOB_TYPE.INITIAL) return runInitial(job);
  if (job.type === JOB_TYPE.REGENERATE_SUMMARY) return runGeneration(job, 'summary');
  if (job.type === JOB_TYPE.GENERATE_QUESTIONS) return runGeneration(job, 'questions');
  throw new Error('Tipo de tarefa não implementado.');
}
async function finishJob(job, message) {
  await updateJob(job.id, {
    status: JOB_STATUS.COMPLETE,
    current_stage: null,
    completed_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    error_code: null,
    error_message: null,
  });
  await addJobEvent(job.id, { status: JOB_STATUS.COMPLETE, message });
}
async function recomputeMaterialStatus(materialId) {
  const transcription = await getTranscription(materialId);
  if (!transcription) return setMaterialState(materialId, { status: MATERIAL_STATUS.FAILED });
  const [summaries, batches] = await Promise.all([
    listSummaries(materialId),
    listBatches(materialId),
  ]);
  const ready =
    summaries.some(
      (s) => s.is_current && s.source_transcription_revision === transcription.current_revision,
    ) && batches.some((b) => b.source_transcription_revision === transcription.current_revision);
  await setMaterialState(materialId, {
    status: ready ? MATERIAL_STATUS.READY : MATERIAL_STATUS.PARTIAL,
    completedAt: new Date().toISOString(),
  });
}
async function runInitial(job) {
  const material = await getMaterialForWorker(job.material_id);
  await requirePermission(material.user_id, material.id);
  const audio = Array.isArray(material.audio_files)
    ? material.audio_files[0]
    : material.audio_files;
  const transcription = await getTranscription(material.id);
  if (!transcription) {
    if (!audio?.storage_path) throw new Error('Arquivo de áudio temporário não encontrado.');
    // Source media stays untouched until the transcript is durable (retention runs below).
    if ((await transcribeWithFallback(job, material, audio)) === 'waiting') return;
  }
  // Retention is resolved after the ASR snapshot is durable, independently of human review or LLM success.
  await stage(job, PROCESSING_STAGE.FINALIZATION, 'Aplicando a escolha de conservação do áudio.');
  await finalizeAudioStorage(audio);
  const review = await getReviewState(material.user_id, material.id);
  const source = await getVersion(material.id, review.sourceRevisionId);
  await evaluateWarnings(
    material.user_id,
    material,
    source,
    initialWarningAnalysisId(job.id, source.id),
  );
  await setMaterialState(material.id, { status: MATERIAL_STATUS.PARTIAL });
  await finishJob(
    job,
    'Transcrição pronta para conferência. Confirme a revisão antes de gerar resumo e questões.',
  );
}
async function runGeneration(job, kind) {
  job.aiSnapshot = snapshotOf(
    await executionFor(job, kind === 'summary' ? 'summary' : 'questions'),
  );
  // This RPC reads only the immutable, confirmed source fixed at enqueue; it never selects current_text.
  const source = await getGenerationSource(job);
  const stageName = kind === 'summary' ? PROCESSING_STAGE.SUMMARY : PROCESSING_STAGE.QUESTIONS;
  await stage(
    job,
    stageName,
    kind === 'summary'
      ? 'Gerando resumo da revisão confirmada.'
      : 'Gerando questões da revisão confirmada.',
  );
  const table = kind === 'summary' ? 'summary_versions' : 'question_batches';
  const { data: existing, error } = await getAdminSupabase()
    .from(table)
    .select('id')
    .eq('processing_job_id', job.id)
    .maybeSingle();
  if (error) throw error;
  if (!existing) {
    if (kind === 'summary') await generateSummary(job, source);
    else await generateQuestions(job, source, job.params.count);
  }
  await recomputeMaterialStatus(job.material_id);
  await finishJob(job, kind === 'summary' ? 'Resumo atualizado.' : 'Novo lote de questões gerado.');
  // 3.3: the equivalent generation is now ready for joins and authorised reuse.
  await completeGeneration(job, { jobId: job.id, kind });
}
