import { z } from 'zod';

const uuid = z.string().uuid();

export function quizId(value) {
  return uuid.parse(value);
}
export function validateQuizStart(body) {
  return z.object({
    materialId: uuid,
    batchId: uuid,
    feedbackMode: z.enum(['immediate', 'deferred']),
  }).strict().parse(body);
}
export function validateQuizAnswer(body) {
  return z.object({
    questionId: uuid,
    selectedIndex: z.number().int().min(0).max(3),
  }).strict().parse(body);
}
