import { apiFetch } from './http.js';

export const getCatalog = () => apiFetch('/api/catalog');
export const getLibraryResources = () => apiFetch('/api/catalog/resources');
export const createSubject = (name) =>
  apiFetch('/api/catalog/subjects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
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
