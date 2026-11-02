import { z } from 'zod';
import { assertAudioMetadata, assertQuestionCount } from '../domain/rules.js';

import { validatePermission } from './review.validator.js';

const uuid = z.string().uuid();

export function validateCreateMaterial(input) {
  const permission = validatePermission(input);
  const parsed = z
    .object({
      id: uuid,
      title: z.string().trim().min(1).max(200),
      subject: z.string().trim().max(200).optional().nullable(),
      originalFilename: z.string().trim().min(1).max(255),
      mimeType: z.string().trim().min(1).max(120),
      extension: z.string().trim(),
      sizeBytes: z.coerce.number().positive(),
      durationMs: z.coerce.number().nonnegative().optional().nullable(),
      questionCount: z.coerce.number(),
      retainAudio: z.boolean(),
      storagePath: z.string().trim().min(1).max(500),
    })
    .parse(input);

  const audio = assertAudioMetadata(parsed);
  const questionCount = assertQuestionCount(parsed.questionCount);
  return { ...parsed, ...audio, questionCount, ...permission };
}

export function validateMaterialPatch(input) {
  return z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      subject: z.string().trim().max(200).nullable().optional(),
    })
    .strict()
    .parse(input);
}
