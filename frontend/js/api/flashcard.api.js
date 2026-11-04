import { apiFetch } from './http.js';

export const listFlashcards = (filter = 'due') =>
  apiFetch(`/api/flashcards?filter=${encodeURIComponent(filter)}`);

export const createFlashcard = (data) =>
  apiFetch('/api/flashcards', { method: 'POST', body: JSON.stringify(data) });

export const updateFlashcard = (cardId, data) =>
  apiFetch(`/api/flashcards/${encodeURIComponent(cardId)}`, {
    method: 'PATCH', body: JSON.stringify(data),
  });

export const reviewFlashcard = (cardId, rating, requestId) =>
  apiFetch(`/api/flashcards/${encodeURIComponent(cardId)}/reviews`, {
    method: 'POST', body: JSON.stringify({ rating, requestId }),
  });

export const listFlashcardReviews = (cardId) =>
  apiFetch(`/api/flashcards/${encodeURIComponent(cardId)}/reviews`);
