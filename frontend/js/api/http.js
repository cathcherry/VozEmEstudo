import { getSession } from './auth.api.js';

export const QUOTA_CODES = new Set([
  'TRANSCRIPTION_QUOTA_EXCEEDED',
  'GENERATION_QUOTA_EXCEEDED',
  'RECORDING_QUOTA_EXCEEDED',
  'TESTER_REQUEST_TOO_LARGE',
  'TESTING_CAPACITY_REACHED',
]);

export async function apiFetch(path, options = {}) {
  const session = await getSession();
  const headers = new Headers(options.headers || {});
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Erro HTTP ${response.status}`);
    error.code = payload?.error?.code;
    error.status = response.status;
    if (payload?.error?.details) error.details = payload.error.details;
    // Public testing: a refused AI action (limit or program capacity). Pages that listen offer
    // "Ver meus limites"; the message itself is already a friendly sentence from the server.
    if (QUOTA_CODES.has(error.code) && typeof window !== 'undefined')
      window.dispatchEvent(new CustomEvent('voz:quota-error', { detail: { code: error.code, message: error.message, details: error.details || null } }));
    throw error;
  }
  return payload;
}
