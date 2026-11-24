// Public testing program, browser side (FEATURE_PUBLIC_TESTING). Everything here only *shows*
// what the server says: role, limits and use come from GET /api/testing/me and the server
// enforces every limit. With the flag off nothing is fetched and nothing new is rendered.
import { getFeatureFlags } from './feature-flags.js';
import { getTestingMe, listDemoLessons } from '../api/testing.api.js';
import { QUOTA_CODES } from '../api/http.js';

export const LIMITS_HREF = './conta.html#limites';
export const DEMO_HREF = './historico.html#aulas-de-demonstracao';

/** Kinds in the order the account page lists them, with their labels. */
export const USAGE_KINDS = Object.freeze([
  ['transcription_seconds', 'Transcrição'],
  ['processing_llm', 'Gravações processadas'],
  ['summary', 'Resumos'],
  ['questions', 'Listas de questões'],
  ['flashcards', 'Gerações de flashcards'],
  ['flashcard_replace', 'Novas sugestões de cartão'],
  ['warnings', 'Novas análises de avisos'],
  ['multi_lesson', 'Material integrado'],
]);

let enabledPromise;
/** Whether the program is on for this deployment (the public config flag). */
export function publicTestingEnabled() {
  enabledPromise ??= getFeatureFlags()
    .then((flags) => flags.public_testing === true)
    .catch(() => false);
  return enabledPromise;
}

let mePromise;
/** The account's role, limits and use, or null (flag off, program off or unavailable). */
export function getTestingStatus({ refresh = false } = {}) {
  if (refresh) mePromise = null;
  mePromise ??= publicTestingEnabled().then((on) =>
    on ? getTestingMe().then(normalizeStatus).catch(() => null) : null,
  );
  return mePromise;
}

let demosPromise;
/** The demo lessons this account may open ([] when none, flag off or unavailable). */
export function getDemoLessons({ refresh = false } = {}) {
  if (refresh) demosPromise = null;
  demosPromise ??= publicTestingEnabled().then((on) =>
    on ? listDemoLessons().then((list) => (Array.isArray(list) ? list : [])).catch(() => []) : [],
  );
  return demosPromise;
}

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

/** Numbers may arrive as strings (Postgres bigint); unknown policies count as 'off'. */
export function normalizeStatus(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const policy = ['tester', 'admin', 'legacy', 'off'].includes(raw.policy) ? raw.policy : 'off';
  const limits = {};
  const used = {};
  for (const [kind] of USAGE_KINDS) {
    const limit = raw.limits?.[kind];
    if (limit !== undefined && limit !== null && limit !== '') limits[kind] = toNumber(limit);
    used[kind] = toNumber(raw.used?.[kind]);
  }
  return {
    policy,
    admin: raw.admin === true || policy === 'admin',
    programEnabled: raw.programEnabled === true,
    registrationEndsAt: raw.registrationEndsAt || null,
    limits,
    used,
    demoAccess: raw.demoAccess === true,
  };
}

/** Whether the account works under program limits (participant or administrator). */
export const isLimited = (status) => Boolean(status && ['tester', 'admin'].includes(status.policy));

/** { limit, used, remaining } of one kind, or null when the account has no limit for it. */
export function allowance(status, kind) {
  if (!isLimited(status) || !Object.hasOwn(status.limits, kind)) return null;
  const limit = status.limits[kind];
  const used = status.used[kind] || 0;
  return { limit, used, remaining: Math.max(0, limit - used) };
}

/** Seconds as the server words them: "45 s", "5 min", "4 min 30 s". */
export function formatSeconds(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  if (value < 60) return `${value} s`;
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** Whether a participant cannot start this kind of generation (limit 0 or used up). */
export async function generationBlocked(kind) {
  const status = await getTestingStatus();
  if (status?.policy !== 'tester') return null;
  const left = allowance(status, kind);
  if (!left) return null;
  if (left.limit === 0) return 'unavailable';
  return left.remaining <= 0 ? 'used' : null;
}

export const isQuotaError = (error) => Boolean(error && QUOTA_CODES.has(error.code));

/** A "Ver meus limites" link (for status lines next to an AI action). */
export function limitsLink(doc = document) {
  const link = doc.createElement('a');
  link.className = 'testing-limits-link';
  link.href = LIMITS_HREF;
  link.textContent = 'Ver meus limites';
  return link;
}

/** Adds "Ver meus limites" after a status message when the error is a program limit. */
export function appendLimitsLink(element, error) {
  if (!element || !isQuotaError(error) || element.querySelector('.testing-limits-link')) return;
  element.append(' ', limitsLink(element.ownerDocument));
}

let stylesPromise;
/** The program's stylesheet, added on first use (pages without the flag never load it). */
export function ensureTestingStyles(doc = document) {
  if (stylesPromise) return stylesPromise;
  const existing = doc.querySelector('link[href$="/css/public-testing.css"]');
  if (existing) return (stylesPromise = Promise.resolve());
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/public-testing.css';
  stylesPromise = new Promise((resolve) => {
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 1500);
  });
  doc.head.append(link);
  return stylesPromise;
}
