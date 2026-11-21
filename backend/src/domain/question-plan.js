import { DIFFICULTIES } from '../validators/question-config.validator.js';

/**
 * Splits `count` across the selected levels as evenly as possible; leftovers go to the easier
 * levels first. Example: 10 questions over basic/intermediate/advanced → 4/3/3.
 */
export function distributeLevels(count, levels) {
  const ordered = DIFFICULTIES.filter((level) => levels.includes(level));
  const base = Math.floor(count / ordered.length),
    extra = count % ordered.length;
  return ordered.flatMap((level, index) => Array(base + (index < extra ? 1 : 0)).fill(level));
}

export const conceptKey = (label = '') =>
  String(label)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Aspects of one concept that make different, meaningful questions. A broad concept of a lesson
 * (e.g. "Fotossíntese") supports a question about what it is, how it works, how it relates to
 * other ideas, its causes and consequences, how it applies and what follows from it — so two
 * questions on the same concept differ in purpose, not only in wording.
 */
export const FACETS = [
  'definition',
  'mechanism',
  'relation',
  'cause_effect',
  'application',
  'implication',
];

/**
 * About one meaningful question per this many words of transcript. A 10-minute lesson
 * (~1,300 words) supports ~20; a three-sentence transcript supports one or two. This bounds
 * the plan by the source instead of by how many concepts the model happened to list.
 */
export const WORDS_PER_QUESTION = 60;

/** Every distinct concept supports at least one question; longer transcripts support more. */
export function sourceCapacity({ words = 0, concepts = 0 }) {
  return Math.max(concepts, Math.floor(words / WORDS_PER_QUESTION), 1);
}

/**
 * Coverage plan: slots pair a concept with a skill and a facet. Concepts are visited round-robin,
 * so every concept is covered before any is revisited; a revisit always changes the facet (and,
 * when several skills are selected, the skill). There is no fixed limit per concept: a lesson with
 * few broad concepts still gets as many distinct questions as its content supports. The plan is
 * bounded by `capacity` (from the transcript size) and returns up to `spare` extra lower-priority
 * slots, used to replace items rejected later (invalid, unsupported or redundant).
 */
export function planCoverage({ count, concepts, config, testedConcepts = [], words, spare = 0 }) {
  const tested = new Set(testedConcepts.map(conceptKey));
  const ordered =
    config.previousQuestions === 'prioritize_new'
      ? [
          ...concepts.filter((c) => !tested.has(c.key)),
          ...concepts.filter((c) => tested.has(c.key)),
        ]
      : concepts;
  if (!ordered.length) return [];
  const skills = config.skills;
  const capacity =
    words === undefined ? ordered.length * 2 : sourceCapacity({ words, concepts: ordered.length });
  const target = Math.min(count, capacity);
  const perConcept = Math.min(
    FACETS.length,
    Math.max(1, Math.ceil((target + spare) / ordered.length)),
  );
  const pairs = [];
  for (let round = 0; round < perConcept; round += 1)
    ordered.forEach((concept, index) =>
      pairs.push({
        concept,
        skill: skills[(index + round) % skills.length],
        facet: FACETS[round % FACETS.length],
      }),
    );
  const planned = Math.min(target, pairs.length);
  const levels = distributeLevels(planned, config.difficulties);
  const slots = pairs
    .slice(0, planned)
    .map((pair, index) => ({ ...pair, difficulty: levels[index] }));
  if (config.distribution === 'progressive')
    slots.sort((a, b) => DIFFICULTIES.indexOf(a.difficulty) - DIFFICULTIES.indexOf(b.difficulty));
  else {
    // Balanced: interleave levels so a partial list still mixes them.
    const byLevel = DIFFICULTIES.map((level) => slots.filter((slot) => slot.difficulty === level));
    slots.length = 0;
    while (byLevel.some((group) => group.length))
      for (const group of byLevel) if (group.length) slots.push(group.shift());
  }
  // Spares continue the round-robin; their difficulty follows the same mix.
  // Spares only exist when the source supports more than was asked: never pad a short lesson.
  const allowed = Math.max(0, Math.min(spare, capacity - planned));
  const spares = pairs.slice(planned, planned + allowed).map((pair, index) => ({
    ...pair,
    difficulty: config.difficulties[index % config.difficulties.length],
    spare: true,
  }));
  return [...slots, ...spares].map((slot, index) => ({ id: `s${index + 1}`, ...slot }));
}
