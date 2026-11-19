import { AppError } from '../domain/errors.js';
import { validateFlashcardGeneration, validateGeneratedFlashcards } from '../validators/flashcard-generation.validator.js';
import { buildFlashcardMessages, FLASHCARD_PROMPT_VERSION } from '../prompts/flashcards.v1.js';

// Dependencies are injected so authorization and malformed-provider paths can be tested without a live account.
export function buildFlashcardGenerationService({ getOwnedMaterial, getReviewState, getVersion, complete, model }) {
  const active = new Set();
  return async function generate(userId, body) {
    const { materialId, sourceRevisionId, count } = validateFlashcardGeneration(body);
    if (active.has(userId)) throw new AppError('GENERATION_BUSY', 'Aguarde a geração em andamento.', 429);
    active.add(userId);
    try {
      await getOwnedMaterial(userId, materialId);
      const review = await getReviewState(userId, materialId);
      if (review.state !== 'ready_to_generate' || review.permissionRequired ||
          review.sourceRevisionId !== sourceRevisionId ||
          review.confirmation?.sourceRevisionId !== sourceRevisionId)
        throw new AppError('TRANSCRIPTION_CONFIRMATION_REQUIRED',
          'Confirme a revisão atual da transcrição antes de gerar cartões.', 409);
      const source = await getVersion(materialId, sourceRevisionId);
      if (!source.full_text?.trim()) throw new AppError('EMPTY_SOURCE', 'A transcrição está vazia.', 422);
      if (source.full_text.length > 80000) throw new AppError('SOURCE_TOO_LARGE',
        'Esta transcrição excede o limite de 80 mil caracteres para geração de cartões.', 422);
      const raw = await complete({ messages: buildFlashcardMessages(source.full_text, count),
        maxTokens: Math.min(12000, count * 550 + 500) });
      return { materialId, sourceRevisionId, revision: source.revision,
        model: typeof model === 'function' ? model() : model, promptVersion: FLASHCARD_PROMPT_VERSION,
        cards: validateGeneratedFlashcards(raw, count, source.full_text) };
    } finally { active.delete(userId); }
  };
}
