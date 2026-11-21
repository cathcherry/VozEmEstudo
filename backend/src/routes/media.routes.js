import { limitPerAccount } from '../middleware/rate-limit.middleware.js';
import { env } from '../config/env.js';
import express from 'express';
import { inspectMedia, convertMedia } from '../services/media.service.js';

export const mediaRouter = express.Router();
// FFmpeg work is CPU-bound: a per-account ceiling besides the two-job concurrency limit.
mediaRouter.use(limitPerAccount({ name: 'media', max: env.rateLimitMediaPerMinute, windowMs: 60000 }));
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
