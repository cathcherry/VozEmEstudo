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
 * Coverage plan: each slot pairs a distinct (concept, skill). A concept is used at most twice and
 * only with different skills, so a second question about it has a different cognitive purpose.
 * The plan is therefore capped by the content: fewer distinct concepts → fewer slots.
 */
export function planCoverage({ count, concepts, config, testedConcepts = [] }) {
  const tested = new Set(testedConcepts.map(conceptKey));
  const ordered =
    config.previousQuestions === 'prioritize_new'
      ? [...concepts.filter((c) => !tested.has(c.key)), ...concepts.filter((c) => tested.has(c.key))]
      : concepts;
  const skills = config.skills;
  const pairs = [];
  for (let round = 0; round < Math.min(2, skills.length); round += 1)
    ordered.forEach((concept, index) =>
      pairs.push({ concept, skill: skills[(index + round) % skills.length] }),
    );
  const target = Math.min(count, pairs.length);
  const levels = distributeLevels(target, config.difficulties);
  const slots = pairs.slice(0, target).map((pair, index) => ({ ...pair, difficulty: levels[index] }));
  if (config.distribution === 'progressive')
    slots.sort((a, b) => DIFFICULTIES.indexOf(a.difficulty) - DIFFICULTIES.indexOf(b.difficulty));
  else {
    // Balanced: interleave levels so a partial list still mixes them.
    const byLevel = DIFFICULTIES.map((level) => slots.filter((slot) => slot.difficulty === level));
    slots.length = 0;
    while (byLevel.some((group) => group.length))
      for (const group of byLevel) if (group.length) slots.push(group.shift());
  }
  return slots.map((slot, index) => ({ id: `s${index + 1}`, ...slot }));
}
