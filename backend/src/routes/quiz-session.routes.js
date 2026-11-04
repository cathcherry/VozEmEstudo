import { Router } from 'express';
import * as quiz from '../controllers/quiz-session.controller.js';

export const quizSessionRouter = Router();
quizSessionRouter.get('/', quiz.list);
quizSessionRouter.post('/', quiz.create);
quizSessionRouter.get('/:sessionId', quiz.get);
quizSessionRouter.get('/:sessionId/diagnostic', quiz.diagnostic);
quizSessionRouter.post('/:sessionId/answers', quiz.answer);
quizSessionRouter.post('/:sessionId/finish', quiz.finish);
