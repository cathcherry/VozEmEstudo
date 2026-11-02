import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import { PERMISSION_DECLARATION } from '../config/permission-declaration.js';

export function validatePermission(input) {
  if (input?.permissionAccepted !== true) {
    throw new AppError(
      'PERMISSION_REQUIRED',
      'Confirme a declaração de permissão antes de enviar ou processar a gravação.',
      422,
    );
  }
  if (input.permissionVersion !== PERMISSION_DECLARATION.version) {
    throw new AppError(
      'PERMISSION_RECONFIRMATION_REQUIRED',
      'A declaração de permissão mudou. Leia e confirme o texto vigente.',
      409,
    );
  }
  return { permissionAccepted: true, permissionVersion: PERMISSION_DECLARATION.version };
}
export const validateConfirmation = (input) =>
  z
    .object({
      sourceRevisionId: z.string().uuid(),
    })
    .strict()
    .parse(input);
export function validateGeneration(input = {}) {
  if (!input?.sourceRevisionId)
    throw new AppError(
      'SOURCE_REVISION_REQUIRED',
      'Selecione a revisão confirmada para gerar materiais.',
      409,
    );
  return z
    .object({
      sourceRevisionId: z.string().uuid(),
      idempotencyKey: z.string().uuid().optional(),
    })
    .strict()
    .parse(input);
}

export const validateWarningRequest = (input) =>
  z
    .object({
      sourceRevisionId: z.string().uuid(),
      idempotencyKey: z.string().uuid().optional(),
    })
    .strict()
    .parse(input);
