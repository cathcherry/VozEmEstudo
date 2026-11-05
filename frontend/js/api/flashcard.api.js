import { apiFetch } from './http.js';

export const getFlashcardSource = (materialId) =>
  apiFetch(`/api/materials/${encodeURIComponent(materialId)}`);

export const previewFlashcards = (data) =>
  apiFetch('/api/flashcards/preview', { method: 'POST', body: JSON.stringify(data) });

export const listFlashcards = (filter = 'due', options = {}) => {
  const params = new URLSearchParams({ filter });
  if (options.materialId) params.set('materialId', options.materialId);
  if (options.status) params.set('status', options.status);
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  return apiFetch(`/api/flashcards?${params}`);
};

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

