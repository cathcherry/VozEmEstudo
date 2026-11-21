import { apiFetch } from './http.js';

// Integrated material of several confirmed lessons (FEATURE_MULTI_LESSON). Private to the account.
const json = (method, body) => ({ method, body: JSON.stringify(body) });

/** selection = { kind: 'lessons'|'unit'|'units'|'subject', ids: string[] } */
export const previewMultiLesson = (selection) =>
  apiFetch('/api/multi-lesson/preview', json('POST', { selection }));
export const createMultiLesson = (body) => apiFetch('/api/multi-lesson', json('POST', body));
export const listMultiLessons = () => apiFetch('/api/multi-lesson');
export const getMultiLesson = (id) => apiFetch(`/api/multi-lesson/${encodeURIComponent(id)}`);
export const deleteMultiLesson = (id) =>
  apiFetch(`/api/multi-lesson/${encodeURIComponent(id)}`, { method: 'DELETE' });
