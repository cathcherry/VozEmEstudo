import { z } from 'zod';
import { assertSafeStoragePath } from './storage-path.validator.js';
import { errors } from '../domain/errors.js';

export const videoMaterialId = (value) => z.string().uuid().parse(value);
export function validateVideo(body, userId, materialId) {
  const data = z.object({
    originalName: z.string().trim().min(1).max(255),
    storagePath: z.string().max(500),
    sizeBytes: z.number().int().positive().max(104857600),
    durationMs: z.number().int().positive().max(7200000),
    clipStartMs: z.number().int().nonnegative(),
    clipEndMs: z.number().int().positive(),
  }).strict().refine((item) => item.clipEndMs > item.clipStartMs && item.clipEndMs <= item.durationMs,
    { message: 'O recorte deve estar dentro do vídeo original.' }).parse(body);
  assertSafeStoragePath(data.storagePath);
  if (data.storagePath !== `original/${userId}/${materialId}/source.mp4`)
    throw errors.forbidden();
  return data;
}
