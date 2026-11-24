// "Sinalizar para revisar" on generated questions, without new tables: the student's own marks.
// Nobody else receives them (there is no moderation queue); the flags
// (wrong answer, unclear statement, not in the lesson, repeated, other) live in the account's
// `profile_state` under `question-reports`, merged per question across devices (newest wins;
// removing a flag is kept as a dated tombstone so another device cannot bring it back).
import { loadCloudState, saveCloudState, registerCloudMerge } from './profile-cloud.js';

export const REPORT_REASONS = Object.freeze([
  ['wrong_answer', 'A resposta marcada como certa está errada'],
  ['unclear', 'O enunciado ou as alternativas estão confusos'],
  ['not_in_lesson', 'Não está na aula'],
  ['repeated', 'Repete outra questão'],
  ['other', 'Outro problema'],
]);
const REASONS = REPORT_REASONS.map(([key]) => key);
const LIMIT = 500;
const KEY = 'question-reports';

export const reasonLabel = (reason) => REPORT_REASONS.find(([key]) => key === reason)?.[1] || 'Problema';

/** Newest entry per question; at most LIMIT entries (oldest tombstones go first). */
export function mergeReports(remote, local) {
  const merged = { ...(remote && typeof remote === 'object' ? remote : {}) };
  for (const [id, entry] of Object.entries(local && typeof local === 'object' ? local : {})) {
    if (!entry || typeof entry.at !== 'number') continue;
    if (!merged[id] || (merged[id].at || 0) < entry.at) merged[id] = entry;
  }
  const entries = Object.entries(merged).sort(([, a], [, b]) => {
    if (Boolean(a.removed) !== Boolean(b.removed)) return a.removed ? 1 : -1;
    return (b.at || 0) - (a.at || 0);
  });
  return Object.fromEntries(entries.slice(0, LIMIT));
}
registerCloudMerge(KEY, mergeReports);

export function normalizeReport(input = {}) {
  if (!REASONS.includes(input.reason)) throw new Error('Escolha o motivo do problema.');
  return {
    reason: input.reason,
    note: String(input.note || '').trim().slice(0, 500),
    materialId: input.materialId ? String(input.materialId).slice(0, 64) : null,
    batchId: input.batchId ? String(input.batchId).slice(0, 64) : null,
    // A short copy of the statement, so Revisar can list flagged questions without refetching.
    statement: String(input.statement || '').trim().slice(0, 300),
  };
}

let owner = '';
let reports = {};
let ready = Promise.resolve();
const listeners = new Set();
const emit = () => {
  for (const listener of listeners) listener();
};

/** Loads the account copy once per page (called by the authenticated shell). */
export function initQuestionReports(userId) {
  if (!userId || owner === userId) return ready;
  owner = userId;
  ready = loadCloudState(userId, KEY, null)
    .then((remote) => {
      reports = mergeReports(remote, reports);
      emit();
    })
    .catch(() => {});
  return ready;
}
export const questionReportsReady = () => ready;
export function onReportsChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The active report of a question, or null. */
export function reportFor(questionId) {
  const entry = reports[questionId];
  return entry && !entry.removed ? entry : null;
}
export const activeReports = () =>
  Object.entries(reports).filter(([, entry]) => !entry.removed).map(([id, entry]) => ({ id, ...entry }));

async function persist() {
  emit();
  if (owner) await saveCloudState(owner, KEY, reports);
}
export async function saveReport(questionId, input, now = Date.now()) {
  reports = mergeReports(reports, { [questionId]: { ...normalizeReport(input), at: now } });
  await persist();
  return reportFor(questionId);
}
export async function clearReport(questionId, now = Date.now()) {
  if (!reports[questionId]) return;
  reports = mergeReports(reports, { [questionId]: { removed: true, at: now } });
  await persist();
}
