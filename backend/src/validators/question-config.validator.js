import { z } from 'zod';
import { errors } from '../domain/errors.js';
import { QUESTION_COUNTS } from '../config/constants.js';

export const DIFFICULTIES = Object.freeze(['basic', 'intermediate', 'advanced']);
export const SKILLS = Object.freeze([
  'recall',
  'understanding',
  'interpretation',
  'application',
  'analysis',
  'cause_effect',
  'evaluation',
  'synthesis',
]);
/**
 * Formats with complete generation, persistence, grading, feedback and export. Multiple selection,
 * true/false, short answer and open response are designed for but deliberately not accepted yet.
 */
export const QUESTION_FORMATS = Object.freeze(['single_choice']);
export const PREVIOUS_POLICIES = Object.freeze(['avoid', 'prioritize_new', 'review']);

const unique = (values) => new Set(values).size === values.length;
const set = (values) =>
  z.array(z.enum(values)).min(1).max(values.length).refine(unique, 'Valor repetido.');

const configSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    difficulties: set(DIFFICULTIES).default(['basic', 'intermediate']),
    skills: set(SKILLS).default(['recall', 'understanding']),
    // Free text is only a hint for selecting content; it is sent to the model as data.
    topicFocus: z.string().trim().max(300).optional(),
    format: z.enum(QUESTION_FORMATS).default('single_choice'),
    distribution: z.enum(['balanced', 'progressive']).default('balanced'),
    previousQuestions: z.enum(PREVIOUS_POLICIES).default('avoid'),
    feedbackMode: z.enum(['immediate', 'deferred']).optional(),
  })
  .strict();

export function validateQuestionConfig(input) {
  const parsed = configSchema.parse(input ?? {});
  if (!parsed.topicFocus) delete parsed.topicFocus;
  return parsed;
}

/** Presets stay valid everywhere; custom counts need the authoring migration and stay bounded. */
export function assertListQuestionCount(value, { custom = false, max = 40 } = {}) {
  const count = Number(value);
  if (!Number.isInteger(count)) throw errors.invalidQuestionCount();
  if (custom ? count < 1 || count > max : !QUESTION_COUNTS.includes(count))
    throw errors.invalidQuestionCount(custom ? max : undefined);
  return count;
}

export const validateListTitle = (input) =>
  z
    .object({ title: z.string().trim().min(1).max(160) })
    .strict()
    .parse(input).title;
