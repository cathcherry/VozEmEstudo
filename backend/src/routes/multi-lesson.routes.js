import * as testing from '../services/testing.service.js';
import { Router } from 'express';
import { multiLessonService as service } from '../services/multi-lesson.service.js';
import { multiLessonExportService as exportsService } from '../services/multi-lesson-export.service.js';
import { limitPerAccount } from '../middleware/rate-limit.middleware.js';
import { isFeatureEnabled } from '../config/feature-flags.js';

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
  action((q) => testing.withReservation(q.user.id, testing.USAGE_KIND.MULTI_LESSON,
    typeof q.body?.requestId === 'string' ? q.body.requestId : null, () => service.create(q.user, q.body)), 202),
);
r.get(
  '/:id',
  action((q) => service.get(q.user, q.params.id)),
);
// 3.4: save the integrated questions as a question list and the cards as a personal set.
// Idempotent (requestId) and at most once per record and kind; nothing is generated again.
const exportLimit = limitPerAccount({ name: 'multi-lesson-export', max: 60, windowMs: 3600000 });
r.get(
  '/:id/exports',
  action((q) => exportsService.list(q.user, q.params.id)),
);
r.post(
  '/:id/question-list',
  exportLimit,
  action((q) => exportsService.questions(q.user, q.params.id, q.body)),
);
// The personal set lives in Flashcards › Conjuntos (FEATURE_FLASHCARD_SETS).
if (isFeatureEnabled('flashcard_sets'))
  r.post(
    '/:id/flashcard-set',
    exportLimit,
    action((q) => exportsService.flashcards(q.user, q.params.id, q.body)),
  );
r.delete(
  '/:id',
  action((q) => service.remove(q.user, q.params.id)),
);
