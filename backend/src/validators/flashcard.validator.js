import { z } from 'zod';

const uuid = z.string().uuid();
const front = z.string().trim().min(1).max(1000);
const back = z.string().trim().min(1).max(2000);
const materialId = uuid.nullable().optional();
const clean = (text) => text.replace(/\s+/gu, ' ');

export function flashcardId(value) {
  return uuid.parse(value);
}

export function validateNewFlashcard(body) {
  const parsed = z.object({
    front, back, materialId,
  }).strict().parse(body);
  return {
    front_text: clean(parsed.front),
    back_text: parsed.back,
    material_id: parsed.materialId || null,
  };
}

export function validateFlashcardPatch(body) {
  const parsed = z.object({
    front: front.optional(),
    back: back.optional(),
    materialId,
    archived: z.boolean().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, {
    message: 'Informe uma alteração.',
  }).parse(body);
  const patch = {};
  if ('front' in parsed) patch.front_text = clean(parsed.front);
  if ('back' in parsed) patch.back_text = parsed.back;
  if ('materialId' in parsed) patch.material_id = parsed.materialId;
  if ('archived' in parsed) patch.status = parsed.archived ? 'archived' : 'active';
  return patch;
}

export function validateFlashcardQuery(input) {
  return z.object({
    filter: z.enum(['due', 'all']).default('due'),
    materialId: uuid.optional(),
    status: z.enum(['all', 'active', 'archived']).default('all'),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
  }).strict().parse(input);
}

export function validateFlashcardReview(body) {
  return z.object({
    rating: z.number().int().min(0).max(3),
    requestId: uuid,
  }).strict().parse(body);
}

