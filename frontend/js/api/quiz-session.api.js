import { apiFetch } from './http.js';

export const listQuizSessions = () => apiFetch('/api/quiz-sessions');
export const createQuizSession = (materialId, batchId, feedbackMode) =>
  apiFetch('/api/quiz-sessions', {
    method: 'POST', body: JSON.stringify({ materialId, batchId, feedbackMode }),
  });
export const getQuizSession = (sessionId) =>
  apiFetch(`/api/quiz-sessions/${encodeURIComponent(sessionId)}`);
export const submitQuizAnswer = (sessionId, questionId, selectedIndex) =>
  apiFetch(`/api/quiz-sessions/${encodeURIComponent(sessionId)}/answers`, {
    method: 'POST', body: JSON.stringify({ questionId, selectedIndex }),
  });
export const finishQuizSession = (sessionId) =>
  apiFetch(`/api/quiz-sessions/${encodeURIComponent(sessionId)}/finish`, {
    method: 'POST', body: JSON.stringify({}),
  });

export const getQuizDiagnostic = (sessionId) =>
  apiFetch(`/api/quiz-sessions/${encodeURIComponent(sessionId)}/diagnostic`);
export const createQuizReviewSession = (sourceSessionId, feedbackMode) =>
  apiFetch(`/api/quiz-sessions/${encodeURIComponent(sourceSessionId)}/review`, {
    method: 'POST', body: JSON.stringify({ feedbackMode }),
  });
