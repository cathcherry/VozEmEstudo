import { limitPerAccount } from '../middleware/rate-limit.middleware.js';
import { env } from '../config/env.js';
import express, { Router } from 'express';
import * as cards from '../controllers/flashcard.controller.js';
import { preview } from '../controllers/flashcard-generation.controller.js';
import { isFeatureEnabled } from '../config/feature-flags.js';
import { flashcardSetService as sets } from '../services/flashcard-set.service.js';
import { flashcardsV3Service as v3 } from '../services/flashcards-v3.service.js';

// `status` may depend on the request (e.g. a read-only preview answers 200, a creation 201).
const action = (fn, status = 200) => async (req, res, next) => {
  try {
    const body = await fn(req);
    res.status(typeof status === 'function' ? status(req) : status).json(body);
  }
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
// Flashcards 3.0: typed notes, visual templates, merges and Anki packages.
if (isFeatureEnabled('flashcard_sets') && isFeatureEnabled('flashcards_v3')) {
  flashcardRouter.get('/templates', action((r) => v3.listTemplates(r.user.id)));
  flashcardRouter.put('/templates/:templateId', action((r) => v3.saveTemplate(r.user.id, r.params.templateId, r.body)));
  flashcardRouter.put('/sets/:setId/template', action((r) => v3.setTemplate(r.user.id, r.params.setId, r.body)));
  flashcardRouter.post('/sets/:setId/notes', action((r) => v3.addNote(r.user.id, r.params.setId, r.body), 201));
  flashcardRouter.post('/decks', action((r) => v3.createDeck(r.user.id, r.body), 201));
  flashcardRouter.post('/merge/preview', action((r) => v3.mergePreview(r.user.id, r.body)));
  flashcardRouter.post('/merge', action((r) => v3.merge(r.user.id, r.body), 201));
  flashcardRouter.post(
    '/import/apkg',
    limitPerAccount({ name: 'flashcard-apkg', max: 20, windowMs: 3600000 }),
    express.raw({ type: 'application/octet-stream', limit: '40mb' }),
    action((r) => v3.importApkg(r.user.id, r.query, Buffer.isBuffer(r.body) ? r.body : Buffer.alloc(0)), (r) => (r.query.mode === 'create' ? 201 : 200)),
  );
}
flashcardRouter.patch('/:cardId', cards.update);
flashcardRouter.get('/:cardId/reviews', cards.history);
flashcardRouter.post('/:cardId/reviews', cards.review);
