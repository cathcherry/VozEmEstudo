import { z } from 'zod';
import { AppError } from '../domain/errors.js';

const questionSchema = z.object({
  statement: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().optional().default(''),
});

export function validateQuestionsPayload(payload, expectedCount) {
  const schema = z.object({ questions: z.array(questionSchema).length(expectedCount) });
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new AppError(
      'LLM_INVALID_OUTPUT',
      'O modelo não retornou as questões no formato esperado.',
      502,
      {
        retryable: true,
        details: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      },
    );
  }
  return result.data.questions;
}

const warningSchema = z
  .object({
    state: z.enum(['warning', 'insufficient', 'error', 'no_warning']),
    reason: z.string().trim().min(1).max(1500),
    guidance: z.string().trim().min(1).max(1000),
    segments: z
      .array(
        z
          .object({ position: z.number().int().nonnegative(), quote: z.string().min(1).max(400) })
          .strict(),
      )
      .max(3),
  })
  .strict();
export function validateWarningPayload(payload, source) {
  const parsed = warningSchema.safeParse(payload);
  if (!parsed.success)
    throw new AppError('LLM_INVALID_OUTPUT', 'O aviso não atende ao formato esperado.', 502);
  const segmentRefs = parsed.data.segments.map((reference) => {
    const segment = source.segments_snapshot.find((item) => item.position === reference.position);
    if (!segment || !segment.text.includes(reference.quote))
      throw new AppError(
        'LLM_INVALID_OUTPUT',
        'O trecho do aviso não pertence à revisão analisada.',
        502,
      );
    return {
      position: segment.position,
      segmentId: segment.id || null,
      startMs: segment.startMs,
      endMs: segment.endMs,
      quote: reference.quote,
    };
  });
  return { ...parsed.data, segmentRefs };
}
