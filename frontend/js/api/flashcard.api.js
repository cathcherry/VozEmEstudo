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


// Flashcards 2.0: named sets (FEATURE_FLASHCARD_SETS).
export const listFlashcardSets = (materialId) =>
  apiFetch(`/api/flashcards/sets${materialId ? `?materialId=${encodeURIComponent(materialId)}` : ''}`);
export const getFlashcardSet = (setId) => apiFetch(`/api/flashcards/sets/${encodeURIComponent(setId)}`);
export const createFlashcardSet = (data) =>
  apiFetch('/api/flashcards/sets', { method: 'POST', body: JSON.stringify(data) });
export const addFlashcardSetCards = (setId, cards) =>
  apiFetch(`/api/flashcards/sets/${encodeURIComponent(setId)}/cards`, {
    method: 'POST', body: JSON.stringify({ cards }),
  });
export const updateFlashcardSet = (setId, data) =>
  apiFetch(`/api/flashcards/sets/${encodeURIComponent(setId)}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteFlashcardSet = (setId) =>
  apiFetch(`/api/flashcards/sets/${encodeURIComponent(setId)}`, { method: 'DELETE' });
export const deleteFlashcard = (cardId) =>
  apiFetch(`/api/flashcards/${encodeURIComponent(cardId)}`, { method: 'DELETE' });

// Flashcards 3.0 (FEATURE_FLASHCARDS_V3): typed notes, visual templates, merges and Anki packages.
export const listCardTemplates = () => apiFetch('/api/flashcards/templates');
export const saveCardTemplate = (id, data) =>
  apiFetch(`/api/flashcards/templates/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
export const setFlashcardSetTemplate = (setId, data) =>
  apiFetch(`/api/flashcards/sets/${encodeURIComponent(setId)}/template`, { method: 'PUT', body: JSON.stringify(data) });
export const addFlashcardNote = (setId, note) =>
  apiFetch(`/api/flashcards/sets/${encodeURIComponent(setId)}/notes`, { method: 'POST', body: JSON.stringify(note) });
export const createFlashcardDeck = (data) =>
  apiFetch('/api/flashcards/decks', { method: 'POST', body: JSON.stringify(data) });
export const previewFlashcardMerge = (sources) =>
  apiFetch('/api/flashcards/merge/preview', { method: 'POST', body: JSON.stringify({ sources }) });
export const mergeFlashcardSets = (data) =>
  apiFetch('/api/flashcards/merge', { method: 'POST', body: JSON.stringify(data) });
export function importApkg(file, { mode = 'preview', id, name, templateId, templateBase } = {}) {
  const params = new URLSearchParams({ mode });
  if (id) params.set('id', id);
  if (name) params.set('name', name);
  if (templateId) params.set('templateId', templateId);
  if (templateBase) params.set('templateBase', templateBase);
  return apiFetch(`/api/flashcards/import/apkg?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
}
