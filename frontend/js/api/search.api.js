import { apiFetch } from './http.js';

/** Search in the signed-in person's lessons, question statements and transcripts. */
export const searchLibrary = (q, scope = 'all') =>
  apiFetch(`/api/search?${new URLSearchParams({ q, scope })}`);
