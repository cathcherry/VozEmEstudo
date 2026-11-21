// Question prompts for an investigation, derived from the lesson itself (no AI call): a few
// interface templates around the lesson title, a term the lesson defines ("X é …") and the
// statements of questions the lesson already has. The student can always write their own.

const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();

/** A short term the transcript defines ("A fotossíntese é …" → "fotossíntese"), if any. */
export function definedTerm(segments = []) {
  for (const segment of segments) {
    const match = clean(segment.text).match(/(?:^|[.!?]\s+)(?:(?:o|a|os|as)\s+)?([\p{L}][\p{L}\p{N}-]*(?:\s+[\p{L}\p{N}-]+){0,3})\s+(?:é|são)\s+/iu);
    if (match && match[1].length >= 3 && match[1].length <= 40) return match[1];
  }
  return '';
}

/**
 * @returns {{ text: string, origin: 'prompt', own?: boolean }[]} at most five prompts; `own`
 * marks text that comes from the lesson (shown as content, never translated).
 */
export function suggestQuestions({ lesson = {}, segments = [], lessonQuestions = [] } = {}) {
  const title = clean(lesson.title);
  const out = [];
  if (title) out.push({ text: `Qual é a ideia central de “${title}”?`, origin: 'prompt' });
  const term = definedTerm(segments);
  if (term) out.push({ text: `Por que “${term}” importa nesta aula?`, origin: 'prompt' });
  if (title) out.push({ text: `Como eu explicaria “${title}” para quem faltou à aula?`, origin: 'prompt' });
  for (const statement of lessonQuestions.map(clean).filter((s) => s.length >= 3 && s.length <= 300).slice(0, 2))
    out.push({ text: statement, origin: 'prompt', own: true });
  const seen = new Set();
  return out.filter((item) => !seen.has(item.text) && seen.add(item.text)).slice(0, 5);
}

/** What is still missing to register a discovery (in the order the steps ask for it). */
export function missingForDiscovery(view) {
  if (!view) return ['question', 'evidence', 'explanation'];
  const missing = [];
  if (!view.evidence?.length) missing.push('evidence');
  if ([...String(view.investigation?.explanation || '').trim()].length < 20) missing.push('explanation');
  return missing;
}
