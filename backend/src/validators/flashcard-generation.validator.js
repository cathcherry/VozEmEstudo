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
