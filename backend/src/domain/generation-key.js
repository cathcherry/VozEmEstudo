import { createHash } from 'node:crypto';

// Voz em Estudo 3.0 — identity of an AI generation, so an equivalent authorised result can be
// reused (and two simultaneous equivalent requests can wait for one job) instead of paying for
// the same output twice. Only what changes the educational content enters the key: sources
// (confirmed revision ids), kind, content settings, prompt version and model family. Appearance
// (card template, theme), interface language and request ids never do.

/** Settings that change the generated content, per kind. Anything else is ignored. */
export const CONTENT_SETTINGS = Object.freeze({
  questions: [
    'count',
    'difficulties',
    'skills',
    'distribution',
    'topicFocus',
    'format',
    'previousQuestions',
  ],
  summary: ['style', 'length', 'focus', 'audience', 'format'],
  flashcards: ['count', 'style', 'types', 'focus'],
  // Milestone C: integrated material of several lessons (sources = all revision ids).
  multi_lesson: ['outputs', 'questionCount', 'flashcardCount', 'length', 'focus'],
});
// Order does not matter for these (they are sets).
const SET_LIKE = new Set(['difficulties', 'skills', 'types', 'outputs']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  if (typeof value === 'string') return value.normalize('NFC').trim().replace(/\s+/g, ' ');
  return value;
}

/**
 * @param {{scope:string, sources:string[], kind:'questions'|'summary'|'flashcards',
 *   settings?:object, promptVersion:string, modelFamily?:string}} input
 */
export function generationIdentity({
  scope,
  sources,
  kind,
  settings = {},
  promptVersion,
  modelFamily = 'default',
}) {
  if (!scope || !Array.isArray(sources) || !sources.length)
    throw new TypeError('scope and sources are required');
  const allowed = CONTENT_SETTINGS[kind];
  if (!allowed) throw new TypeError(`unknown kind: ${kind}`);
  if (!promptVersion) throw new TypeError('promptVersion is required');
  const content = {};
  for (const key of allowed) {
    const value = settings[key];
    if (value === undefined || value === null || value === '') continue;
    content[key] = SET_LIKE.has(key) && Array.isArray(value) ? [...new Set(value)].sort() : value;
  }
  return canonical({
    scope,
    sources: [...new Set(sources)].sort(),
    kind,
    settings: content,
    promptVersion,
    modelFamily,
  });
}

export function generationKey(input) {
  return createHash('sha256')
    .update(JSON.stringify(generationIdentity(input)))
    .digest('hex');
}

/**
 * In-process single flight: concurrent calls with the same key share one promise. The
 * persistent version (one queued/running job per key) needs the generation_jobs table in
 * docs/PLANO_DIRETOR_VOZ_EM_ESTUDO_3_0.md §10.
 */
export function createSingleFlight() {
  const inFlight = new Map();
  return function run(key, task) {
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = Promise.resolve()
      .then(task)
      .finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };
}
