import { AppError } from '../domain/errors.js';
import { getAiRegistry } from '../ai/provider-registry.js';
import { assertTranscriptionResult } from '../ai/contracts/transcription.js';
import {
  createInitialTranscription,
  getByMaterial,
  applyEdits,
  restoreRevision,
  listVersions,
} from '../repositories/transcription.repository.js';

/** Synchronous providers (legacy Whisper): transcribe and persist in one worker run. */
export async function transcribeMaterial(materialId, audioBuffer, { durationMs, snapshot } = {}) {
  const { provider, snapshot: resolved } = getAiRegistry().transcription(snapshot);
  if (provider.mode !== 'sync')
    throw new AppError('ASR_ASYNC_REQUIRED', 'Este provedor exige processamento assíncrono.', 500);
  const result = assertTranscriptionResult(
    await provider.transcribe(audioBuffer, {
      durationMs,
      model: resolved.model,
      settings: resolved.settings,
    }),
  );
  if (!result.text) throw new Error('O serviço de ASR retornou uma transcrição vazia.');
  await createInitialTranscription(materialId, result);
  return getByMaterial(materialId);
}

export {
  getByMaterial as getTranscriptionByMaterial,
  applyEdits as applyTranscriptionEdits,
  restoreRevision,
  listVersions,
};
