import { Router } from 'express';
import * as cards from '../controllers/flashcard.controller.js';

export const flashcardRouter = Router();

flashcardRouter.get('/', cards.list);
flashcardRouter.post('/', cards.create);
flashcardRouter.patch('/:cardId', cards.update);
flashcardRouter.get('/:cardId/reviews', cards.history);
flashcardRouter.post('/:cardId/reviews', cards.review);
