import { contentHash, questionKey } from './flashcard-notes.js';

// Flashcards 3.0 — personal merge of several decks (own or shared with a class) into a NEW deck.
// The sources are never modified. Exact repeats (same question and answer, ignoring case, accents
// and punctuation) are kept once. The same question with different answers is a conflict the
// student decides: keep one answer, or combine them in one card. Every copy keeps its origin.

export const MERGE_LIMIT = 500; // cards in one set (database rule)

const hashOf = (card) => card.content_hash || contentHash(card.front_text, card.back_text);

/**
 * @param {Array<{setId:string, name:string, kind:'own'|'classroom', author:{id:string,label:string}, cards:object[]}>} sources
 * @returns {{cards:object[], duplicates:number, conflicts:object[], total:number}}
 */
export function planMerge(sources) {
  const seen = new Set();
  const byQuestion = new Map();
  let duplicates = 0;
  let total = 0;
  for (const source of sources)
    for (const card of source.cards || []) {
      if (card.status && card.status !== 'active') continue;
      total += 1;
      const hash = hashOf(card);
      if (seen.has(hash)) {
        duplicates += 1;
        continue;
      }
      seen.add(hash);
      const key = questionKey(card.front_text);
      const entry = { card, source, hash };
      if (!byQuestion.has(key)) byQuestion.set(key, []);
      byQuestion.get(key).push(entry);
    }
  const conflicts = [];
  const cards = [];
  for (const [key, entries] of byQuestion) {
    if (entries.length === 1) {
      cards.push(entries[0]);
      continue;
    }
    conflicts.push({
      key,
      front: entries[0].card.front_text,
      options: entries.map(({ card, source }) => ({
        cardId: card.id,
        back: card.back_text,
        label: source.author?.label || source.name,
        setName: source.name,
      })),
      entries,
    });
  }
  return { cards, duplicates, conflicts, total };
}

/** Preview for the client (no internal entries). */
export function previewMerge(plan) {
  const count = plan.cards.length + plan.conflicts.length;
  return {
    total: plan.total,
    duplicates: plan.duplicates,
    resulting: Math.min(count, MERGE_LIMIT),
    overLimit: Math.max(0, count - MERGE_LIMIT),
    conflicts: plan.conflicts.map(({ key, front, options }) => ({ key, front, options })),
  };
}

const originOf = ({ card, source }) => ({
  originKind: source.kind === 'classroom' ? 'classroom' : 'merge',
  originCardId: card.id,
  originSetId: source.setId,
  originUserId: source.author?.id || null,
  originLabel: (source.author?.label || source.name || '').slice(0, 160) || null,
});
const copyOf = (entry) => ({
  front: entry.card.front_text,
  back: entry.card.back_text,
  noteType: entry.card.note_type || 'basic',
  fields: entry.card.note_fields || {},
  contentHash: entry.hash,
  evidence: entry.card.evidence || undefined,
  // Images are only carried over from the student's own decks (their storage folder).
  media: entry.source.kind === 'own' ? entry.card.media || [] : [],
  ...originOf(entry),
});

/**
 * Cards for the new deck after the student's decisions: {[conflictKey]: 'combine' | 'keep:<cardId>'}.
 * Undecided conflicts are combined, so no answer is lost silently.
 */
export function resolveMerge(plan, decisions = {}) {
  const out = plan.cards.map(copyOf);
  for (const conflict of plan.conflicts) {
    const choice = decisions[conflict.key] || 'combine';
    const kept = choice.startsWith('keep:')
      ? conflict.entries.find((entry) => entry.card.id === choice.slice(5))
      : null;
    if (kept) {
      out.push(copyOf(kept));
      continue;
    }
    const back = conflict.entries
      .map(({ card, source }) => `${source.author?.label || source.name}: ${card.back_text}`)
      .join('\n\n')
      .slice(0, 2000);
    const first = conflict.entries[0];
    out.push({
      front: first.card.front_text,
      back,
      noteType: 'basic',
      fields: { front: first.card.front_text, back },
      contentHash: contentHash(first.card.front_text, back),
      media: [],
      ...originOf(first),
      originLabel: [...new Set(conflict.entries.map((e) => e.source.author?.label || e.source.name))]
        .join(' + ')
        .slice(0, 160),
    });
  }
  return out.slice(0, MERGE_LIMIT);
}
