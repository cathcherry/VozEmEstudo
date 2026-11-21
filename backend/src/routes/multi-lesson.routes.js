import { Router } from 'express';
import { multiLessonService as service } from '../services/multi-lesson.service.js';
import { limitPerAccount } from '../middleware/rate-limit.middleware.js';

// Integrated materials are private to the account: never cached, never indexed.
const action =
  (fn, status = 200) =>
  async (req, res, next) => {
    try {
      res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
      res.status(status).json(await fn(req));
    } catch (error) {
      next(error);
    }
  };

export const multiLessonRouter = Router();
const r = multiLessonRouter;
r.post(
  '/preview',
  action((q) => service.preview(q.user, q.body)),
);
r.get(
  '/',
  action((q) => service.list(q.user)),
);
// Paid requests: a per-account ceiling on top of the daily generation budget.
r.post(
  '/',
  limitPerAccount({ name: 'multi-lesson-create', max: 20, windowMs: 3600000 }),
  action((q) => service.create(q.user, q.body), 202),
);
r.get(
  '/:id',
  action((q) => service.get(q.user, q.params.id)),
);
r.delete(
  '/:id',
  action((q) => service.remove(q.user, q.params.id)),
);
