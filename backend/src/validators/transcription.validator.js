import { z } from 'zod';

export function validateTranscriptionEdits(input) {
  return z.object({
    expectedRevision: z.number().int().min(1),
    segments: z.array(z.object({ id: z.string().uuid(), text: z.string().trim() })).min(1),
  }).parse(input);
}
