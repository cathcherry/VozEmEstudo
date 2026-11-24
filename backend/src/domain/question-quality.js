// Mechanical checks on a generated multiple-choice question, applied before it is saved. They
// catch the two giveaways the model keeps producing despite the prompt:
// - an alternative copied word for word from the transcript (spoken register, "o negócio é que
//   eu amo polvo…"), which stands out from the written distractors;
// - a correct alternative much longer than the others.
// A rejected item goes back to the bounded replacement round like any other rejection.
import { normalizeText } from './question-redundancy.js';

/** Runs of this many consecutive words found verbatim in the transcript count as a copy. */
export const COPY_RUN_WORDS = 8;

const words = (text) => normalizeText(text).split(/\s+/u).filter(Boolean);

/** Whether `option` repeats COPY_RUN_WORDS or more consecutive words of the transcript. */
export function copiesTranscript(option, transcriptNormalized) {
  const tokens = words(option);
  if (tokens.length < COPY_RUN_WORDS) return false;
  const haystack = ` ${transcriptNormalized} `;
  for (let i = 0; i + COPY_RUN_WORDS <= tokens.length; i += 1) {
    if (haystack.includes(` ${tokens.slice(i, i + COPY_RUN_WORDS).join(' ')} `)) return true;
  }
  return false;
}

/** Whether the correct alternative is conspicuously longer than every distractor. */
export function lengthGiveaway(options, correctIndex) {
  const lengths = options.map((option) => String(option).trim().length);
  const correct = lengths[correctIndex];
  const others = lengths.filter((_, index) => index !== correctIndex);
  const longestOther = Math.max(...others);
  const average = others.reduce((sum, value) => sum + value, 0) / others.length;
  return correct > average * 1.6 && correct - longestOther >= 25;
}

/**
 * The reason to reject a question, or null when it passes. `transcriptNormalized` is the
 * transcript through normalizeText (computed once per generation).
 */
export function questionQualityIssue({ options, correctIndex }, transcriptNormalized) {
  if (options.some((option) => copiesTranscript(option, transcriptNormalized))) return 'copied_option';
  if (lengthGiveaway(options, correctIndex)) return 'length_giveaway';
  return null;
}
