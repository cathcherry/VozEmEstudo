/**
 * Finds the transcript passage a model quote came from, tolerating the small edits models make
 * when "copying" spoken language: dropped fillers (né, tá, aí…), "..." ellipses, fixed casing or
 * punctuation, a word or two changed. Invented text has almost no word sequences in common with
 * the transcript and is still rejected. The returned text is the transcript's own wording, so
 * stored evidence stays literal.
 */
const FILLERS = new Set(
  'ne ta ai entao tipo assim bom gente pessoal ok beleza hein ahn eh hum uhum'.split(' '),
);
export const MIN_QUOTE_WORDS = 5;
export const MIN_MATCH_RATIO = 0.75;
const SPAN_SLACK = 3;

const normalizeWord = (word) =>
  word.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');

function words(text) {
  const result = [];
  for (const match of String(text).matchAll(/[\p{L}\p{N}]+/gu)) {
    const norm = normalizeWord(match[0]);
    if (!FILLERS.has(norm))
      result.push({ norm, start: match.index, end: match.index + match[0].length });
  }
  return result;
}

const key = (list, index) => `${list[index].norm} ${list[index + 1].norm} ${list[index + 2].norm}`;

/** Longest common subsequence of two word lists, with the matched span in `b`. */
function alignment(a, b) {
  const rows = a.length + 1,
    cols = b.length + 1;
  const table = new Uint16Array(rows * cols);
  for (let i = 1; i < rows; i += 1)
    for (let j = 1; j < cols; j += 1)
      table[i * cols + j] =
        a[i - 1].norm === b[j - 1].norm
          ? table[(i - 1) * cols + j - 1] + 1
          : Math.max(table[(i - 1) * cols + j], table[i * cols + j - 1]);
  let i = a.length,
    j = b.length,
    first = -1,
    last = -1;
  while (i > 0 && j > 0) {
    if (a[i - 1].norm === b[j - 1].norm) {
      if (last < 0) last = j - 1;
      first = j - 1;
      i -= 1;
      j -= 1;
    } else if (table[(i - 1) * cols + j] >= table[i * cols + j - 1]) i -= 1;
    else j -= 1;
  }
  return { length: table[rows * cols - 1], first, last };
}

export function createEvidenceLocator(source = '') {
  const text = String(source);
  const sourceWords = words(text);
  const positions = new Map();
  for (let i = 0; i + 2 < sourceWords.length; i += 1) {
    const k = key(sourceWords, i);
    if (!positions.has(k)) positions.set(k, []);
    positions.get(k).push(i);
  }

  /** Returns { text, score } for a supported quote, or null. */
  return function locate(quote, { maxLength = 400 } = {}) {
    const quoteWords = words(quote);
    if (quoteWords.length < MIN_QUOTE_WORDS) return null;
    const total = quoteWords.length - 2;
    // Each quote word-trigram found in the transcript votes for where the quote starts there.
    const votes = new Map();
    for (let i = 0; i < total; i += 1)
      for (const at of positions.get(key(quoteWords, i)) || []) {
        const offset = at - i;
        if (!votes.has(offset)) votes.set(offset, []);
        votes.get(offset).push({ quoteIndex: i, at });
      }
    // Dropped or added words shift the alignment a little: merge nearby starting points and
    // take the area of the transcript where most of the quote's word triples were found.
    let anchor = null;
    const offsets = [...votes.keys()].sort((a, b) => a - b);
    for (const offset of offsets) {
      const hits = offsets
        .filter((other) => other >= offset && other <= offset + SPAN_SLACK * 2)
        .flatMap((other) => votes.get(other));
      const matched = new Set(hits.map((hit) => hit.quoteIndex)).size;
      if (!anchor || matched > anchor.matched) anchor = { matched, hits };
    }
    if (!anchor || anchor.matched < Math.min(2, total)) return null;
    // Score that area word by word (longest common subsequence), so a changed or dropped word
    // costs one word, not three triples.
    const from = Math.max(
      0,
      Math.min(...anchor.hits.map((hit) => hit.at - hit.quoteIndex)) - SPAN_SLACK,
    );
    const to = Math.min(
      sourceWords.length,
      Math.max(...anchor.hits.map((hit) => hit.at - hit.quoteIndex)) +
        quoteWords.length +
        SPAN_SLACK,
    );
    const { length, first, last } = alignment(quoteWords, sourceWords.slice(from, to));
    const score = length / quoteWords.length;
    if (score < MIN_MATCH_RATIO) return null;
    let passage = text.slice(sourceWords[from + first].start, sourceWords[from + last].end).trim();
    if (passage.length > maxLength) passage = passage.slice(0, maxLength).replace(/\s+\S*$/, '');
    return { text: passage, score: Number(score.toFixed(3)) };
  };
}
