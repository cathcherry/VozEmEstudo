import { apiFetch } from './http.js';

// Investigations, the Arquivo de Descobertas and the Gabinete (FEATURE_DISCOVERIES). Private to
// the account. The server verifies every quote and owns every unlock; nothing here grants one.
const json = (method, body) => ({ method, body: JSON.stringify(body) });
const id = (value) => encodeURIComponent(value);

export const getInvestigationSource = (materialId) => apiFetch(`/api/investigations/source/${id(materialId)}`);
export const getInvestigation = (investigationId) => apiFetch(`/api/investigations/${id(investigationId)}`);
/** body = { version, requestId, body: { materialId, sourceRevisionId, question, … } } */
export const saveInvestigation = (investigationId, body) =>
  apiFetch(`/api/investigations/${id(investigationId)}`, json('PUT', body));
/** evidence = { id, segmentPosition, endSegmentPosition?, startOffset, endOffset, quote, note? } */
export const addEvidence = (investigationId, evidence) =>
  apiFetch(`/api/investigations/${id(investigationId)}/evidence`, json('POST', evidence));
export const removeEvidence = (investigationId, evidenceId) =>
  apiFetch(`/api/investigations/${id(investigationId)}/evidence/${id(evidenceId)}`, { method: 'DELETE' });
export const getLinkOptions = (investigationId) => apiFetch(`/api/investigations/${id(investigationId)}/link-options`);
export const addLink = (investigationId, kind, refId) =>
  apiFetch(`/api/investigations/${id(investigationId)}/links`, json('PUT', { kind, refId }));
export const removeLink = (investigationId, kind, refId) =>
  apiFetch(`/api/investigations/${id(investigationId)}/links/${id(kind)}/${id(refId)}`, { method: 'DELETE' });
export const completeInvestigation = (investigationId, requestId) =>
  apiFetch(`/api/investigations/${id(investigationId)}/complete`, json('POST', { requestId }));

export const listDiscoveries = () => apiFetch('/api/discoveries');
export const getDiscovery = (discoveryId) => apiFetch(`/api/discoveries/${id(discoveryId)}`);
/** body = { version, requestId, title?, explanation? } */
export const updateDiscovery = (discoveryId, body) => apiFetch(`/api/discoveries/${id(discoveryId)}`, json('PUT', body));
export const addReflection = (discoveryId, body) =>
  apiFetch(`/api/discoveries/${id(discoveryId)}/reflections`, json('POST', body));
export const connectDiscoveries = (discoveryId, body) =>
  apiFetch(`/api/discoveries/${id(discoveryId)}/connections`, json('POST', body));

export const getCollection = () => apiFetch('/api/collection');
/** body = { version, requestId, items: [{ slot, objectId }] } */
export const saveDeskLayout = (body) => apiFetch('/api/collection/layout', json('PUT', body));
