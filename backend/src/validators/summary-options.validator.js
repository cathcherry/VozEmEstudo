import { z } from 'zod';
import { validateGeneration } from './review.validator.js';

/**
 * Summary formats. 'paragraphs' (narrative) and 'topics' (bullet points) are the original values
 * and keep their stored shape; the others were added with study authoring.
 */
export const SUMMARY_FORMATS = Object.freeze([
  'paragraphs',
  'topics',
  'structured',
  'definitions',
  'comparative',
  'chronological',
  'cause_effect',
]);
export const SUMMARY_LENGTHS = Object.freeze(['short', 'standard', 'detailed']);
export const SUMMARY_FOCUS = Object.freeze([
  'concepts',
  'terminology',
  'processes',
  'causes',
  'comparisons',
  'dates',
  'examples',
  'arguments',
  'exam',
]);

const focus = z
  .array(z.enum(SUMMARY_FOCUS))
  .max(SUMMARY_FOCUS.length)
  .refine((items) => new Set(items).size === items.length, 'Foco repetido.');

export const validateSummaryOptions = (input = {}) => {
  const parsed = z
    .object({
      format: z.enum(SUMMARY_FORMATS).default('paragraphs'),
      length: z.enum(SUMMARY_LENGTHS).default('standard'),
      // Optional and absent by default, so legacy options keep their exact shape.
      readingLevel: z.enum(['simple']).optional(),
      focus: focus.optional(),
      label: z.string().trim().min(1).max(120).optional(),
    })
    .strict()
    .parse(input);
  if (parsed.focus && !parsed.focus.length) delete parsed.focus;
  return parsed;
};

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

export const validateSummaryLabel = (input) =>
  z
    .object({ label: z.string().trim().max(120).nullable() })
    .strict()
    .transform(({ label }) => ({ label: label || null }))
    .parse(input);
