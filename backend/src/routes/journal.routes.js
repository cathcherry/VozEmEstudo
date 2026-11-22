import { Router } from 'express';
import { journalService as service } from '../services/journal.service.js';

// Diário de estudo (FEATURE_JOURNAL). Private to the account; never cached or indexed.
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

export const journalRouter = Router();
journalRouter.get('/', action((r) => service.list(r.user.id)));
journalRouter.get('/link-options', action((r) => service.linkOptions(r.user.id)));
journalRouter.get('/:id', action((r) => service.get(r.user.id, r.params.id)));
journalRouter.put('/:id', action((r) => service.save(r.user.id, r.params.id, r.body)));
journalRouter.put(
  '/:id/pages/:pageId',
  action((r) => service.savePage(r.user.id, r.params.id, r.params.pageId, r.body)),
);
