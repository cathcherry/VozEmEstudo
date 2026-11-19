import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import {
  validateFlashcardGeneration, validateGeneratedFlashcards, validateFlashcardGenerationV2,
} from '../validators/flashcard-generation.validator.js';
import { buildFlashcardMessagesV2, FLASHCARD_V2_PROMPT_VERSION } from '../prompts/flashcards.v2.js';
import { filterRedundant, normalizeText } from '../domain/question-redundancy.js';
import { sourceReferences } from './question-generation.service.js';
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

const cardSchema = z.object({
  front: z.string().trim().min(1).max(1000),
  back: z.string().trim().min(1).max(2000),
  evidence: z.string().trim().min(15).max(1500),
  difficulty: z.string().optional(),
  focus: z.string().optional(),
}).passthrough();

/**
 * Flashcards 2.0 preview. Never saves; never pads. Cards without a literal source quote, exact or
 * near duplicates (within the preview, the avoid list and cards already saved for the lesson/set)
 * are dropped. At most two model calls: one request plus one bounded top-up.
 */
export function buildFlashcardGenerationServiceV2({
  getOwnedMaterial, getReviewState, getVersion, complete, model, existingFronts, max = 50,
}) {
  const active = new Set();
  return async function generate(userId, body) {
    const { materialId, sourceRevisionId, count, config, avoid, setId } = validateFlashcardGenerationV2(body, { max });
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
      const normalizedSource = normalizeText(source.full_text);
      const previous = [...avoid, ...(await existingFronts(userId, materialId, setId))]
        .map((front) => ({ statement: front }));
      const accepted = [];
      const rejected = {};
      const reject = (reason) => { rejected[reason] = (rejected[reason] || 0) + 1; };
      let calls = 0;
      async function round(wanted) {
        calls += 1;
        const raw = await complete({
          messages: buildFlashcardMessagesV2(source.full_text, {
            count: wanted, config, avoid: [...previous.map((p) => p.statement), ...accepted.map((c) => c.front)],
          }),
          maxTokens: Math.min(12000, wanted * 550 + 500),
        });
        const parsed = z.object({ cards: z.array(z.unknown()).max(200) }).safeParse(raw);
        if (!parsed.success) {
          if (calls === 1) throw new AppError('LLM_INVALID_OUTPUT',
            'A geração não produziu cartões no formato esperado. Tente novamente.', 502, { retryable: true });
          reject('invalid');
          return 0;
        }
        const candidates = [];
        for (const item of parsed.data.cards) {
          const card = cardSchema.safeParse(item);
          if (!card.success) { reject('invalid'); continue; }
          const quote = normalizeText(card.data.evidence);
          if (quote.length < 10 || !normalizedSource.includes(quote)) { reject('unsupported'); continue; }
          candidates.push({
            statement: card.data.front,
            correctText: card.data.back,
            front: card.data.front,
            back: card.data.back,
            evidence: card.data.evidence,
            difficulty: config.difficulties.includes(card.data.difficulty) ? card.data.difficulty : config.difficulties[0],
            focus: config.focus.includes(card.data.focus) ? card.data.focus : config.focus[0],
          });
        }
        const result = filterRedundant(candidates, { previous, accepted });
        for (const { reason } of result.rejected) reject(reason);
        accepted.push(...result.accepted);
        return parsed.data.cards.length;
      }
      const returned = await round(count);
      // Top up once only when the model offered enough but some cards were discarded.
      if (accepted.length < count && returned >= count) await round(count - accepted.length);
      const cards = accepted.slice(0, count).map((card) => ({
        front: card.front,
        back: card.back,
        evidence: card.evidence,
        difficulty: card.difficulty,
        focus: card.focus,
        style: config.style,
        sourceSegments: sourceReferences(card.evidence, source.segments_snapshot || []),
      }));
      return {
        materialId, sourceRevisionId, revision: source.revision, requested: count,
        model: typeof model === 'function' ? model() : model, promptVersion: FLASHCARD_V2_PROMPT_VERSION,
        cards, rejected, modelCalls: calls,
        shortfall: cards.length < count ? 'Somente estes cartões distintos têm apoio na transcrição.' : null,
      };
    } finally { active.delete(userId); }
  };
}

/** Deterministic stand-in for MOCK_EXTERNAL_SERVICES: each card quotes one transcript sentence. */
export async function mockFlashcardCompletionV2({ messages }) {
  const input = JSON.parse(messages[1].content);
  const avoid = new Set(input.avoid.map(normalizeText));
  const sentences = (input.transcript.match(/[^.!?]+[.!?]?/g) || [])
    .map((s) => s.trim()).filter((s) => s.length >= 15);
  const wanted = Number(messages[0].content.match(/Retorne de 0 a (\d+)/)?.[1] || 5);
  return {
    cards: sentences
      .map((sentence, i) => ({
        front: `Segundo a aula, o que se afirma no ponto ${i + 1} (“${sentence.split(' ').slice(0, 3).join(' ')}…”)?`,
        back: sentence,
        evidence: sentence,
      }))
      .filter((card) => !avoid.has(normalizeText(card.front)))
      .slice(0, wanted),
  };
}
