import { segmentWords } from './segmentation.js';

const ms = (value) => Math.max(0, Math.round(Number(value) || 0));
const nullable = (value) => (value === undefined || value === null || value === '' ? null : value);

/**
 * Builds the internal transcription representation. Word timings, when present, are canonical and
 * display segments are derived from them; provider utterances are kept separately. Without words,
 * the provider's segments are kept as-is (legacy behaviour) and no word timing is invented.
 */
export function normalizeTranscription({
  text,
  language,
  words = [],
  utterances = [],
  segments = [],
  durationMs = 0,
  metadata,
}) {
  const cleanWords = words
    .filter((word) => String(word.text ?? '').trim())
    .map((word) => ({
      startMs: ms(word.startMs),
      endMs: Math.max(ms(word.startMs), ms(word.endMs)),
      text: String(word.text).trim(),
      speaker: nullable(word.speaker),
      confidence:
        Number.isFinite(Number(word.confidence)) && word.confidence !== null
          ? Number(word.confidence)
          : null,
    }));
  // With words, the text is rebuilt from them so it matches the display segments exactly.
  const fullText = cleanWords.length
    ? cleanWords.map((word) => word.text).join(' ')
    : String(text ?? '').trim();
  let displaySegments;
  let alignedWords = [];
  if (cleanWords.length) {
    ({ segments: displaySegments, words: alignedWords } = segmentWords(cleanWords));
  } else {
    displaySegments = segments
      .map((segment) => ({
        startMs: ms(segment.startMs),
        endMs: Math.max(ms(segment.startMs), ms(segment.endMs)),
        text: String(segment.text ?? '').trim(),
        speaker: nullable(segment.speaker),
      }))
      .filter((segment) => segment.text);
    if (!displaySegments.length && fullText)
      displaySegments = [{ startMs: 0, endMs: ms(durationMs), text: fullText, speaker: null }];
  }
  return {
    text: fullText,
    language: nullable(language),
    segments: displaySegments,
    words: alignedWords,
    utterances: utterances.map((utterance) => ({
      startMs: ms(utterance.startMs),
      endMs: Math.max(ms(utterance.startMs), ms(utterance.endMs)),
      text: String(utterance.text ?? '').trim(),
      speaker: nullable(utterance.speaker),
    })),
    metadata,
  };
}
