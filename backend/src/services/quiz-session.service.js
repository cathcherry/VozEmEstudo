import * as repository from '../repositories/quiz-session.repository.js';
import { AppError } from '../domain/errors.js';
import { buildQuizDiagnostic } from './quiz-diagnostic.service.js';
import {
  quizId, validateQuizStart, validateQuizAnswer, validateReviewStart,
} from '../validators/quiz-session.validator.js';

export function buildQuizSessionService(store = repository) {
  return {
    list: (userId) => store.listOwnedSessions(userId),
    async create(userId, body) {
      const input = validateQuizStart(body);
      const batch = await store.findOwnedBatch(userId, input.materialId, input.batchId);
      if (batch.generated_count < 1)
        throw new AppError('QUIZ_EMPTY_BATCH', 'Este lote ainda não possui questões.', 409);
      return store.createOwnedSession(userId, input);
    },
    get: (userId, id) => store.readOwnedSession(userId, quizId(id)),
    async diagnostic(userId, id) {
      const data = await store.readOwnedSession(userId, quizId(id));
      return buildQuizDiagnostic(data);
    },
    async answer(userId, id, body) {
      const selected = validateQuizAnswer(body);
      return store.submitSessionAnswer(
        userId, quizId(id), selected.questionId, selected.selectedIndex,
      );
    },
    finish: (userId, id) => store.finishOwnedSession(userId, quizId(id)),
    createReview: async (userId, sessionId, body) => {
      const { feedbackMode } = validateReviewStart(body);
      return store.createOwnedReviewSession(userId, quizId(sessionId), feedbackMode);
    },
  };
}

export const quizSessionService = buildQuizSessionService();
