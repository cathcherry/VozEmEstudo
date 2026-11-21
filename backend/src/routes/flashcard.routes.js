import { limitPerAccount } from '../middleware/rate-limit.middleware.js';
import { env } from '../config/env.js';
import { Router } from 'express';
import * as cards from '../controllers/flashcard.controller.js';
import { preview } from '../controllers/flashcard-generation.controller.js';
import { isFeatureEnabled } from '../config/feature-flags.js';
import { flashcardSetService as sets } from '../services/flashcard-set.service.js';

const action = (fn, status = 200) => async (req, res, next) => {
  try { res.status(status).json(await fn(req)); }
  catch (error) { next(error); }
};

export const flashcardRouter = Router();

flashcardRouter.get('/', cards.list);
flashcardRouter.post('/', cards.create);
flashcardRouter.post('/preview', limitPerAccount({ name: 'flashcard-preview', max: env.rateLimitGenerationsPerHour, windowMs: 3600000 }), preview);
if (isFeatureEnabled('flashcard_sets')) {
  flashcardRouter.get('/sets', action((r) => sets.list(r.user.id, r.query)));
  flashcardRouter.post('/sets', action((r) => sets.create(r.user.id, r.body), 201));
  flashcardRouter.get('/sets/:setId', action((r) => sets.get(r.user.id, r.params.setId)));
  flashcardRouter.patch('/sets/:setId', action((r) => sets.update(r.user.id, r.params.setId, r.body)));
  flashcardRouter.delete('/sets/:setId', action((r) => sets.remove(r.user.id, r.params.setId)));
  flashcardRouter.post('/sets/:setId/cards', action((r) => sets.addCards(r.user.id, r.params.setId, r.body), 201));
  flashcardRouter.delete('/:cardId', action((r) => sets.removeCard(r.user.id, r.params.cardId)));
}
flashcardRouter.patch('/:cardId', cards.update);
flashcardRouter.get('/:cardId/reviews', cards.history);
flashcardRouter.post('/:cardId/reviews', cards.review);
