/**
 * Deterministic display segmentation from real word timings. Provider utterances can span
 * minutes; display segments target roughly 3–12 s, break at sentence ends, clause punctuation and
 * natural pauses, and always at speaker changes. Timings are copied from words, never estimated.
 */
export const SEGMENTATION_DEFAULTS = Object.freeze({
  minMs: 3000,
  maxMs: 12000,
  pauseMs: 600,
  longPauseMs: 1500,
});

const SENTENCE_END = /[.!?…]["'»”)\]]*$/u;
const CLAUSE_END = /[,;:—–]["'»”)\]]*$/u;

function breakScore(words, index) {
  const word = words[index];
  const next = words[index + 1];
  const gap = next ? Math.max(0, next.startMs - word.endMs) : 0;
  if (SENTENCE_END.test(word.text)) return 3 + gap / 10000;
  if (CLAUSE_END.test(word.text)) return 2 + gap / 10000;
  return gap / 1000;
}

/** Best place to cut words[start..end] once the segment would grow past maxMs. */
function bestBreak(words, start, end, minMs) {
  let best = end;
  let bestScore = -1;
  for (let k = start; k <= end; k += 1) {
    if (words[k].endMs - words[start].startMs < minMs && k !== end) continue;
    const score = breakScore(words, k);
    if (score >= bestScore) {
      best = k;
      bestScore = score;
    }
  }
  return best;
}

/**
 * @param {Array<{startMs:number,endMs:number,text:string,speaker:string|null}>} words ordered words
 * @returns {{ segments: Array<{startMs,endMs,text,speaker}>, words: Array }} words annotated with
 *   the index of the display segment that contains them.
 */
export function segmentWords(words, options = {}) {
  const { minMs, maxMs, pauseMs, longPauseMs } = { ...SEGMENTATION_DEFAULTS, ...options };
  const segments = [];
  const annotated = [];
  const flush = (from, to) => {
    const slice = words.slice(from, to + 1);
    const position = segments.length;
    segments.push({
      startMs: slice[0].startMs,
      endMs: slice.at(-1).endMs,
      text: slice.map((word) => word.text).join(' '),
      speaker: slice[0].speaker ?? null,
    });
    for (const word of slice) annotated.push({ ...word, segment: position });
  };
  let start = 0;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const next = words[i + 1];
    if (!next) {
      flush(start, i);
      break;
    }
    const gap = next.startMs - word.endMs;
    const duration = word.endMs - words[start].startMs;
    if (
      (next.speaker ?? null) !== (word.speaker ?? null) ||
      gap >= longPauseMs ||
      (duration >= minMs && SENTENCE_END.test(word.text)) ||
      (duration >= maxMs * 0.75 && (CLAUSE_END.test(word.text) || gap >= pauseMs))
    ) {
      flush(start, i);
      start = i + 1;
      continue;
    }
    // Adding the next word would exceed the maximum: cut at the most natural earlier point.
    while (start <= i && next.endMs - words[start].startMs > maxMs) {
      const cut = bestBreak(words, start, i, minMs);
      flush(start, cut);
      start = cut + 1;
    }
  }
  return { segments, words: annotated };
}
