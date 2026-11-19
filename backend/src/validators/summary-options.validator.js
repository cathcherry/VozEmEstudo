import { z } from 'zod';
import { validateGeneration } from './review.validator.js';

export const validateSummaryOptions = (input = {}) => z.object({
  format: z.enum(['paragraphs', 'topics']).default('paragraphs'),
  length: z.enum(['short', 'standard', 'detailed']).default('standard'),
  // Optional and absent by default, so legacy options keep their exact shape.
  readingLevel: z.enum(['simple']).optional(),
}).strict().parse(input);

export function validateSummaryGeneration(input = {}) {
  if (!input?.sourceRevisionId) validateGeneration(input);
  const parsed = z.object({
    sourceRevisionId: z.string().uuid(),
    idempotencyKey: z.string().uuid().optional(),
    options: z.unknown().optional(),
  }).strict().parse(input);
  const { options, ...selection } = parsed;
  return { selection: validateGeneration(selection), options: validateSummaryOptions(options) };
}
