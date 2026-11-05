import { z } from 'zod';
const uuid = z.string().uuid();
export const studyId = (value) => uuid.parse(value);
export const validateProgressQuery = (body) => z.object({
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
}).strict().parse(body);
export const validateProgress = (body) => z.object({
  version: z.number().int().min(0).max(2147483646), requestId: uuid,
  patch: z.object({
    position: z.number().finite().min(0).max(7200).optional(),
    playbackRate: z.union([z.literal(0.5),z.literal(0.75),z.literal(1),z.literal(1.25),z.literal(1.5),z.literal(2),z.literal(2.5),z.literal(3)]).optional(),
    completed: z.boolean().optional(),
    intervals: z.array(z.tuple([z.number().finite().min(0),z.number().finite().max(7200)])
      .refine(([start,end]) => end>start)).max(300).optional(),
  }).strict().refine((patch) => Object.keys(patch).length>0),
}).strict().parse(body);
export const validateSession = (body) => z.object({
  sessionId: uuid, materialId: uuid.nullable().default(null),
  kind: z.enum(['reading','pomodoro']),
}).strict().parse(body);
export const validateTick = (body) => z.object({
  sequence: z.number().int().min(1).max(2147483646), active: z.boolean(), close: z.boolean(),
}).strict().parse(body);
export function validateStudySettings(body) {
  return z.object({ goalMinutes: z.number().int().min(0).max(10080),
    timezone: z.string().max(100).refine((zone) => {
      try { new Intl.DateTimeFormat('pt-BR',{timeZone:zone}); return true; } catch { return false; }
    }),
  }).strict().parse(body);
}
