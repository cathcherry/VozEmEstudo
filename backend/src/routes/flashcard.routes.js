import { Router } from 'express';
import * as cards from '../controllers/flashcard.controller.js';
import { preview } from '../controllers/flashcard-generation.controller.js';

export const flashcardRouter = Router();

flashcardRouter.get('/', cards.list);
flashcardRouter.post('/', cards.create);
flashcardRouter.post('/preview', preview);
flashcardRouter.patch('/:cardId', cards.update);
flashcardRouter.get('/:cardId/reviews', cards.history);
flashcardRouter.post('/:cardId/reviews', cards.review);
