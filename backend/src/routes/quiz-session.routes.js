import { Router } from 'express';
import * as quiz from '../controllers/quiz-session.controller.js';
import { isFeatureEnabled } from '../config/feature-flags.js';

export const quizSessionRouter = Router();
quizSessionRouter.get('/', quiz.list);
quizSessionRouter.post('/', quiz.create);
quizSessionRouter.get('/:sessionId', quiz.get);
quizSessionRouter.get('/:sessionId/diagnostic', quiz.diagnostic);
quizSessionRouter.post('/:sessionId/answers', quiz.answer);
quizSessionRouter.post('/:sessionId/finish', quiz.finish);

if (isFeatureEnabled('quiz_review'))
  quizSessionRouter.post('/:sessionId/review', quiz.createReview);
