import { apiFetch } from './http.js';

export const getCatalog = () => apiFetch('/api/catalog');
export const getLibraryResources = () => apiFetch('/api/catalog/resources');
export const createSubject = (name) =>
  apiFetch('/api/catalog/subjects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
export const updateSubject = (subjectId, name) =>
  apiFetch(`/api/catalog/subjects/${encodeURIComponent(subjectId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
/** Removes the subject and its units; its lessons move to "Sem disciplina" (never deleted). */
export const deleteSubject = (subjectId) =>
  apiFetch(`/api/catalog/subjects/${encodeURIComponent(subjectId)}`, { method: 'DELETE' });
export const createUnit = (subjectId, title, description = null) =>
  apiFetch(`/api/catalog/subjects/${encodeURIComponent(subjectId)}/units`, {
    method: 'POST',
    body: JSON.stringify({ title, description }),
  });
export const assignMaterial = (materialId, subjectId, unitId = null) =>
  apiFetch(`/api/catalog/materials/${encodeURIComponent(materialId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ subjectId, unitId }),
  });
