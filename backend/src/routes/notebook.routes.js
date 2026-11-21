import { Router } from 'express';
import { notebookService as service } from '../services/notebook.service.js';

const action = (fn) => async (req, res, next) => {
  try {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    res.json(await fn(req));
  } catch (error) {
    next(error);
  }
};
export const notebookRouter = Router();
notebookRouter.get('/:materialId', action((r) => service.get(r.user.id, r.params.materialId)));
notebookRouter.put('/:materialId', action((r) => service.save(r.user.id, r.params.materialId, r.body)));
