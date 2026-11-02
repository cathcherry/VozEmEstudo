import { transcribeAudio } from '../integrations/asr/huggingface-whisper.client.js';
import { createInitialTranscription, getByMaterial, applyEdits, restoreRevision, listVersions } from '../repositories/transcription.repository.js';

export async function transcribeMaterial(materialId, audioBuffer, { durationMs }) {
  const result = await transcribeAudio(audioBuffer, { durationMs });
  if (!result.text) throw new Error('O serviço de ASR retornou uma transcrição vazia.');
  await createInitialTranscription(materialId, result);
  return getByMaterial(materialId);
}

export { getByMaterial as getTranscriptionByMaterial, applyEdits as applyTranscriptionEdits, restoreRevision, listVersions };
