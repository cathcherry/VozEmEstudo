import { apiFetch } from './http.js';

// Diário de estudo (FEATURE_JOURNAL). Private to the account. The server validates every page.
const json = (method, body) => ({ method, body: JSON.stringify(body) });
const id = (value) => encodeURIComponent(value);

export const listJournals = () => apiFetch('/api/journals');
export const getJournal = (journalId) => apiFetch(`/api/journals/${id(journalId)}`);
export const getLinkOptions = () => apiFetch('/api/journals/link-options');
/** body = { version, requestId, body: { title?, cover?, paper?, deleted? } } */
export const saveJournal = (journalId, body) => apiFetch(`/api/journals/${id(journalId)}`, json('PUT', body));
/** body = { version, requestId, body: { template?, title?, paper?, content?, decorations?, links?, deleted? } } */
export const savePage = (journalId, pageId, body) =>
  apiFetch(`/api/journals/${id(journalId)}/pages/${id(pageId)}`, json('PUT', body));
