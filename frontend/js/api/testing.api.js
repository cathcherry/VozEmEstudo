import { apiFetch } from './http.js';

// Public testing program (FEATURE_PUBLIC_TESTING). Role, limits and use come from the server for
// the signed-in account; the browser only shows them (the server enforces every limit).
export const getTestingMe = () => apiFetch('/api/testing/me');
/** Program-wide figures. Administrators only: everyone else gets 404. */
export const getTestingOverview = () => apiFetch('/api/testing/overview');
export const listDemoLessons = () => apiFetch('/api/demo-lessons');
/** Opens (and on first use, copies) a demo lesson. Returns { materialId, created }. No AI. */
export const openDemoLesson = (demoId) =>
  apiFetch(`/api/demo-lessons/${encodeURIComponent(demoId)}/open`, { method: 'POST' });
