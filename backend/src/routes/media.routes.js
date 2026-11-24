import { limitPerAccount } from '../middleware/rate-limit.middleware.js';
import { env } from '../config/env.js';
import express from 'express';
import { AppError } from '../domain/errors.js';
import { inspectMedia, convertMedia } from '../services/media.service.js';

export const MAX_INFLIGHT_UPLOADS = 3;

/**
 * Bounds memory: each request body (up to 100 MB) is buffered before FFmpeg's two-slot check, so
 * without this many parallel uploads could each hold 100 MB. Counted until the response ends.
 */
export function limitInflight(max = MAX_INFLIGHT_UPLOADS) {
  let inflight = 0;
  return (req, res, next) => {
    if (inflight >= max) {
      res.set('Retry-After', '10');
      return next(new AppError('MEDIA_BUSY', 'O conversor está ocupado. Tente novamente em alguns instantes.', 429));
    }
    inflight += 1;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        inflight -= 1;
      }
    };
    res.once('finish', release);
    res.once('close', release);
    return next();
  };
}

export const mediaRouter = express.Router();
// FFmpeg work is CPU-bound: a per-account ceiling besides the two-job concurrency limit.
mediaRouter.use(limitPerAccount({ name: 'media', max: env.rateLimitMediaPerMinute, windowMs: 60000 }));
mediaRouter.use(limitInflight());
mediaRouter.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));
mediaRouter.post('/inspect', async (req, res, next) => {
  try { res.json(await inspectMedia(req.body, req.query.extension)); }
  catch (error) { next(error); }
});
mediaRouter.post('/convert', async (req, res, next) => {
  try {
    const result = await convertMedia(req.body, req.query.extension, { start: req.query.start, end: req.query.end, output: req.query.output || 'wav' });
    res.set({ 'Content-Type': result.mimeType, 'Content-Disposition': `attachment; filename="trecho.${result.extension}"`, 'X-Media-Duration-Ms': String(result.durationMs), 'Cache-Control': 'no-store' });
    res.send(result.buffer);
  } catch (error) { next(error); }
});
