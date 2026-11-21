import { conceptKey } from './question-plan.js';

// Lexical and concept-level redundancy checks. There are no embeddings: "semantic" redundancy is
// detected through the planned concept + skill and the shared correct answer, not true meaning.
const STOPWORDS = new Set(
  (
    'que qual quais como para por com sem uma umas uns dos das nos nas pelo pela pelos pelas ' +
    'segundo aula sobre entre esta este essa esse isso isto ele ela eles elas seu sua seus suas ' +
    'mais menos muito pode podem deve devem ser sao foi era sera tem ter the and alternativa ' +
    'correta afirmacao afirma indica descreve explica'
  ).split(' '),
);

export const normalizeText = (value = '') =>
  String(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const tokens = (value) =>
  new Set(
    normalizeText(value)
      .split(' ')
      .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
  );
const trigrams = (value) => {
  const text = ` ${normalizeText(value)} `,
    result = new Set();
  for (let i = 0; i < text.length - 2; i += 1) result.add(text.slice(i, i + 3));
  return result;
};
export function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export const PARAPHRASE_TRIGRAM = 0.72;
export const PARAPHRASE_TOKENS = 0.6;
export const SAME_ANSWER_TOKENS = 0.4;

/** Same answer, ignoring word order ("A, B e C" = "C, A e B") and connectors. */
function sameAnswer(a, b) {
  if (normalizeText(a) === normalizeText(b)) return true;
  const ta = tokens(a),
    tb = tokens(b);
  return ta.size >= 2 && jaccard(ta, tb) >= SAME_ANSWER_SET;
}
export const SAME_ANSWER_SET = 0.85;

const answerOf = (question) =>
  question.correctText ?? question.options?.[question.correctIndex] ?? null;

/** Classifies why `b` adds nothing over `a`, or returns null when both may coexist. */
export function compareQuestions(a, b) {
  const sa = normalizeText(a.statement),
    sb = normalizeText(b.statement);
  if (sa && sa === sb) return 'exact';
  const tokenScore = jaccard(tokens(a.statement), tokens(b.statement));
  if (
    jaccard(trigrams(a.statement), trigrams(b.statement)) >= PARAPHRASE_TRIGRAM ||
    tokenScore >= PARAPHRASE_TOKENS
  )
    return 'paraphrase';
  // Same planned concept, skill and facet: the same knowledge with the same cognitive purpose.
  // A different facet (what it is × how it works × its consequences…) is a different question.
  // Questions without a facet (older lists) are compared conservatively.
  const sameFacet = !a.facet || !b.facet || a.facet === b.facet;
  if (
    a.concept &&
    b.concept &&
    conceptKey(a.concept) === conceptKey(b.concept) &&
    a.skill &&
    a.skill === b.skill &&
    sameFacet
  )
    return 'same_knowledge';
  const answerA = answerOf(a),
    answerB = answerOf(b);
  if (answerA && answerB && sameAnswer(answerA, answerB)) {
    // A different skill on the same concept must test a different fact, so the same correct
    // answer about the same concept is the same knowledge whatever the skill label says.
    const sameConcept = a.concept && b.concept && conceptKey(a.concept) === conceptKey(b.concept);
    if (sameConcept || tokenScore >= SAME_ANSWER_TOKENS) return 'same_knowledge';
  }
  return null;
}

/**
 * Keeps candidates in order, rejecting those redundant with an earlier accepted one or, unless
 * the policy is "review", with questions from earlier lists of the same material.
 */
export function filterRedundant(
  candidates,
  { previous = [], policy = 'avoid', accepted: start = [] } = {},
) {
  const accepted = [...start],
    rejected = [];
  for (const item of candidates) {
    let reason = null;
    for (const other of accepted) if ((reason = compareQuestions(other, item))) break;
    if (!reason && policy !== 'review')
      for (const other of previous) {
        const kind = compareQuestions(other, item);
        if (kind) {
          reason = `previous_${kind}`;
          break;
        }
      }
    if (reason) rejected.push({ item, reason });
    else accepted.push(item);
  }
  return { accepted: accepted.slice(start.length), rejected };
}
