import * as repository from '../repositories/transcription.repository.js';
import { getOwnedMaterial } from '../repositories/material.repository.js';
import { errors } from '../domain/errors.js';

const squash = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Validates stored word timings against the segments the user actually sees. Words are only
 * returned when every displayed segment is exactly the concatenation of its words, timings are
 * ordered and inside the segment. Anything else (edited text, legacy data, partial alignment)
 * yields no words, so the client shows segment captions instead of misplaced highlights.
 */
export function alignedWords(segments, words) {
  if (!Array.isArray(words) || !words.length || !segments.length) return [];
  const byPosition = new Map();
  for (const word of words) {
    const position = Number(word?.segment);
    const startMs = Number(word?.startMs);
    const endMs = Number(word?.endMs);
    const text = squash(word?.text);
    if (!Number.isInteger(position) || !Number.isFinite(startMs) || !(endMs >= startMs) || !text)
      return [];
    if (!byPosition.has(position)) byPosition.set(position, []);
    byPosition
      .get(position)
      .push({ startMs, endMs, text, speaker: word.speaker ?? null, segment: position });
  }
  const result = [];
  for (const [index, segment] of segments.entries()) {
    const position = segment.position ?? index;
    const list = byPosition.get(position) || [];
    if (!list.length || list.map((w) => w.text).join(' ') !== squash(segment.current_text))
      return [];
    for (let i = 0; i < list.length; i += 1) {
      const word = list[i];
      if (i && word.startMs < list[i - 1].startMs) return [];
      if (word.startMs < segment.start_ms - 50 || word.endMs > segment.end_ms + 50) return [];
      result.push(word);
    }
  }
  return result.length === words.length ? result : [];
}

export function buildCaptionService(store = repository, getMaterial = getOwnedMaterial) {
  return {
    async captions(userId, materialId) {
      await getMaterial(userId, materialId);
      const transcription = await store.getByMaterial(materialId);
      if (!transcription) throw errors.notFound('Transcrição');
      const segments = transcription.transcription_segments || [];
      const words = alignedWords(segments, await store.getCurrentAlignment(transcription));
      return {
        revision: transcription.current_revision,
        // Captions always come from the recognized/edited transcript text, never a cleaned copy.
        granularity: words.length ? 'word' : 'segment',
        words,
      };
    },
  };
}
export const captionService = buildCaptionService();
