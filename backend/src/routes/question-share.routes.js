import { Router } from 'express';
import { questionShareService as service } from '../services/question-share.service.js';

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
export const questionShareRouter = Router({ mergeParams: true });
questionShareRouter.get(
  '/',
  action((r) => service.list(r.user.id, r.params.materialId, r.params.batchId)),
);
questionShareRouter.post(
  '/',
  action((r) => service.create(r.user.id, r.params.materialId, r.params.batchId, r.body)),
);
questionShareRouter.delete(
  '/:shareId',
  action((r) => service.revoke(r.user.id, r.params.materialId, r.params.batchId, r.params.shareId)),
);
/** Public, unauthenticated: a frozen worksheet without answers. */
export const publicQuestionList = action((r) => service.resolve(r.body));
