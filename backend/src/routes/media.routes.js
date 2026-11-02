import express from 'express';
import { inspectMedia, convertMedia } from '../services/media.service.js';

export const mediaRouter = express.Router();
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
