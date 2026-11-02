import { Router } from 'express';
import { answer } from '../controllers/question.controller.js';
export const questionRouter = Router();
questionRouter.post('/:questionId/answer', answer);
