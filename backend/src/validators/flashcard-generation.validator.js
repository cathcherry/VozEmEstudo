import { z } from 'zod';
import { AppError } from '../domain/errors.js';

export const validateFlashcardGeneration = (body) => z.object({
  materialId: z.string().uuid(),
  sourceRevisionId: z.string().uuid(),
  count: z.union([z.literal(5), z.literal(10), z.literal(20)]).default(5),
}).strict().parse(body);

export function validateGeneratedFlashcards(raw, count, source) {
  const result = z.object({ cards: z.array(z.object({
    front: z.string().trim().min(1).max(1000),
    back: z.string().trim().min(1).max(2000),
    evidence: z.string().trim().min(15).max(1500),
  }).strict()).min(1).max(count) }).strict().safeParse(raw);
  const normalize = (text) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('pt-BR');
  const seen = new Set();
  const sourceText = normalize(source);
  if (!result.success || result.data.cards.some((card) => {
    const key = normalize(card.front);
    const invalid = seen.has(key) || !sourceText.includes(normalize(card.evidence));
    seen.add(key);
    return invalid;
  })) throw new AppError('LLM_INVALID_OUTPUT',
    'A geração não produziu cartões válidos com trechos localizáveis na transcrição. Tente novamente.', 502);
  return result.data.cards;
}

export const FLASHCARD_STYLES = Object.freeze(['question_answer', 'term_definition', 'concise_explanation']);
export const FLASHCARD_DIFFICULTIES = Object.freeze(['basic', 'intermediate', 'advanced']);
export const FLASHCARD_FOCUS = Object.freeze([
  'definitions', 'facts', 'concepts', 'processes', 'comparisons', 'application', 'cause_effect',
]);
const uniqueSet = (values) =>
  z.array(z.enum(values)).min(1).max(values.length).refine((v) => new Set(v).size === v.length);

/** Flashcards 2.0 preview: custom count, multi-select difficulty/focus, style and an avoid list. */
export const validateFlashcardGenerationV2 = (body, { max = 50 } = {}) =>
  z.object({
    materialId: z.string().uuid(),
    sourceRevisionId: z.string().uuid(),
    count: z.number().int().min(1).max(max),
    config: z.object({
      difficulties: uniqueSet(FLASHCARD_DIFFICULTIES).default(['basic', 'intermediate']),
      focus: uniqueSet(FLASHCARD_FOCUS).default(['concepts', 'definitions']),
      style: z.enum(FLASHCARD_STYLES).default('question_answer'),
    }).strict(),
    // Fronts already accepted in the preview or saved in the target set: never proposed again.
    avoid: z.array(z.string().trim().min(1).max(1000)).max(300).default([]),
    setId: z.string().uuid().optional(),
  }).strict().parse(body);

const savedCard = z.object({
  front: z.string().trim().min(1).max(1000),
  back: z.string().trim().min(1).max(2000),
  evidence: z.string().trim().max(1500).optional(),
  sourceSegments: z.array(z.object({
    position: z.number().int().min(0),
    startMs: z.number().int().min(0).nullable().optional(),
    endMs: z.number().int().min(0).nullable().optional(),
  }).strict()).max(5).default([]),
  style: z.enum(FLASHCARD_STYLES).optional(),
  difficulty: z.enum(FLASHCARD_DIFFICULTIES).optional(),
  focus: z.enum(FLASHCARD_FOCUS).optional(),
}).strict();

export const validateNewFlashcardSet = (body) =>
  z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    materialId: z.string().uuid().nullable().default(null),
    sourceRevisionId: z.string().uuid().nullable().default(null),
    config: z.record(z.unknown()).default({}),
    cards: z.array(savedCard).min(1).max(100),
  }).strict().parse(body);

export const validateSetCards = (body) =>
  z.object({ cards: z.array(savedCard).min(1).max(100) }).strict().parse(body).cards;

export const validateSetPatch = (body) =>
  z.object({
    name: z.string().trim().min(1).max(160).optional(),
    archived: z.boolean().optional(),
  }).strict().refine((v) => Object.keys(v).length > 0).parse(body);
