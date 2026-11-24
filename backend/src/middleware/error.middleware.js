import { ZodError } from 'zod';
import { AppError } from '../domain/errors.js';
import { logger } from '../utils/logger.js';

export function notFoundMiddleware(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' },
    requestId: req.requestId,
  });
}

export function errorMiddleware(error, req, res, _next) {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'O corpo da requisição deve conter JSON válido.' },
      requestId: req.requestId,
    });
  }
  if (error.type === 'entity.too.large')
    return res.status(413).json({
      error: { code: 'MEDIA_TOO_LARGE', message: 'O arquivo excede o limite de 100 MB.' },
      requestId: req.requestId,
    });
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Os dados enviados são inválidos.',
        details: error.issues,
      },
      requestId: req.requestId,
    });
  }

  const status = error instanceof AppError ? error.status : 500;
  const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof AppError ? error.message : 'Ocorreu um erro interno.';

  // Unexpected errors keep only their class and code in the log (never the raw message, which can
  // carry SQL fragments or user content); the client always gets the generic message.
  logger.error('HTTP_ERROR', {
    requestId: req.requestId,
    code,
    status,
    message,
    ...(error instanceof AppError ? {} : { cause: { name: error?.name, code: error?.code } }),
  });
  return res.status(status).json({ error: { code, message }, requestId: req.requestId });
}
