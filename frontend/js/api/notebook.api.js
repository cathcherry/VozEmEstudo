import { apiFetch } from './http.js';

// Lesson notebook (Notes 3.0, FEATURE_NOTEBOOKS). Private to the account.
export const getNotebook = (materialId) => apiFetch(`/api/notebooks/${encodeURIComponent(materialId)}`);
export const saveNotebook = (materialId, body) =>
  apiFetch(`/api/notebooks/${encodeURIComponent(materialId)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
