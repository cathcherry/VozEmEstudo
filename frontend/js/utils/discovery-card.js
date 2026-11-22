// Evolving discovery cards (3.6, Milestone E). A card's look is DERIVED from what the discovery
// already stores (evidence, the student's explanation, reflections, connections, revisits), so it
// persists without any new state and can always say why it changed. No points, no streaks, no
// decay: a trait, once reached, is reached; nothing is taken away for a pause.
//
// Stages, in the order they usually happen (they are independent marks on the card):
//   sketch   pencil: an investigation still open (a question, not yet evidence + explanation)
//   inked    ink: own explanation + at least one verified quote (every registered discovery)
//   stamped  postmark: evidence and at least one reflection
//   bound    thread: connected to at least one other discovery
//   pressed  pressed flower: a meaningful revisit (a change at least one day after recording)
// Pure: no DOM, no network. Used by the archive, the discovery page, the cabinet and investigar.

export const CARD_TRAITS = Object.freeze(['inked', 'stamped', 'bound', 'pressed']);

export const TRAIT_NAMES = Object.freeze({
  sketch: 'Esboço a lápis',
  inked: 'Passado a tinta',
  stamped: 'Carimbado',
  bound: 'Costurado com linha',
  pressed: 'Flor prensada',
});

const MIN_EXPLANATION = 20;
const count = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);
const plural = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
const firstDate = (rows = []) =>
  rows
    .map((row) => row?.createdAt)
    .filter(Boolean)
    .sort()[0] || null;

/**
 * Normalizes the three shapes the app has into the facts a card needs:
 *  - a list row of GET /api/discoveries (counts; with 20261124090000 also question,
 *    reflectionCount, connections[] and firstRevisitAt),
 *  - a discovery page view of GET /api/discoveries/:id (full arrays),
 *  - an investigation view of GET /api/investigations/:id (open: a sketch).
 * Missing facts stay unknown (null) instead of being guessed, except the documented fallback:
 * before the archive migration a list row has no reflectionCount, so the first-reflection stamp
 * of that discovery stands for "has a reflection".
 */
export function cardFacts(input = {}) {
  if (input.investigation && !input.discovery) {
    const inv = input.investigation;
    const evidence = (input.evidence || []).length;
    const explained = [...String(inv.explanation || '').trim()].length >= MIN_EXPLANATION;
    return {
      open: inv.status !== 'completed',
      question: inv.question || '',
      evidence,
      explained,
      reflections: String(inv.reflection || '').trim() ? 1 : 0,
      connections: 0,
      acrossSubjects: 0,
      revisits: 0,
      createdAt: inv.createdAt || null,
      dates: {},
    };
  }
  if (input.discovery) {
    const view = input;
    const connections = view.connections || [];
    const reflections = view.reflections || [];
    const revisits = view.revisits || [];
    return {
      open: false,
      question: view.investigation?.question || '',
      evidence: (view.evidence || []).length,
      explained: true,
      reflections: reflections.length,
      connections: connections.length,
      acrossSubjects: connections.filter((c) => c.acrossSubjects).length,
      revisits: revisits.length,
      createdAt: view.discovery.createdAt || null,
      dates: {
        inked: view.discovery.createdAt || null,
        stamped: firstDate(reflections),
        bound: firstDate(connections),
        pressed: firstDate(revisits),
      },
    };
  }
  const row = input;
  const connections = Array.isArray(row.connections) ? row.connections : null;
  const reflections = Number.isFinite(Number(row.reflectionCount))
    ? count(row.reflectionCount)
    : (row.stamps || []).includes('stamp.first-reflection')
      ? 1
      : 0;
  return {
    open: false,
    question: row.question || '',
    evidence: count(row.evidenceCount),
    explained: true,
    reflections,
    connections: connections ? connections.length : count(row.connectionCount),
    acrossSubjects: connections ? connections.filter((c) => c.acrossSubjects).length : null,
    revisits: count(row.revisitCount),
    createdAt: row.createdAt || null,
    dates: {
      inked: row.createdAt || null,
      bound: firstDate(connections || []),
      pressed: row.firstRevisitAt || null,
    },
  };
}

/**
 * The card state: `traits` (reached, in order), `stage` (the latest reached, for the overall
 * look), and one line per trait saying why it is there, or what would add it (`hint`). The
 * hints describe the student's own next step; they are never a requirement or a score.
 */
export function cardState(input = {}) {
  const f = cardFacts(input);
  if (f.open || !f.explained || f.evidence < 1) {
    const missing = [];
    if (f.evidence < 1) missing.push('guardar um trecho conferido da aula como evidência');
    if (!f.explained) missing.push('explicar com as suas palavras');
    return {
      stage: 'sketch',
      traits: [],
      facts: f,
      lines: [
        {
          trait: 'sketch',
          reached: true,
          at: f.createdAt,
          text: f.question
            ? 'A pergunta já está no cartão, a lápis.'
            : 'O cartão ainda está em branco.',
          hint: missing.length ? `Ele passa a tinta quando você ${missing.join(' e ')}.` : '',
        },
      ],
    };
  }
  const reached = {
    inked: true,
    stamped: f.reflections > 0,
    bound: f.connections > 0,
    pressed: f.revisits > 0,
  };
  let across = '';
  if (f.acrossSubjects > 0 && f.acrossSubjects === f.connections)
    across = f.connections === 1 ? 'A outra é de uma disciplina diferente.' : 'Todas são de outras disciplinas.';
  else if (f.acrossSubjects === 1) across = 'Uma delas é de outra disciplina.';
  else if (f.acrossSubjects > 1) across = `${f.acrossSubjects} delas são de outras disciplinas.`;
  const lines = [
    {
      trait: 'inked',
      reached: true,
      at: f.dates.inked || null,
      text: `Você explicou com as suas palavras e guardou ${plural(f.evidence, 'evidência conferida', 'evidências conferidas')} da aula.`,
      hint: '',
    },
    {
      trait: 'stamped',
      reached: reached.stamped,
      at: f.dates.stamped || null,
      text: reached.stamped
        ? `Você escreveu ${plural(f.reflections, 'reflexão', 'reflexões')} sobre o que investigou.`
        : '',
      hint: reached.stamped ? '' : 'Recebe o carimbo quando você escreve uma reflexão sobre ela.',
    },
    {
      trait: 'bound',
      reached: reached.bound,
      at: f.dates.bound || null,
      text: reached.bound
        ? `Você a ligou a ${plural(f.connections, 'outra descoberta', 'outras descobertas')}.`
        : '',
      note: reached.bound ? across : '',
      hint: reached.bound ? '' : 'Ganha a linha quando você a liga a outra descoberta.',
    },
    {
      trait: 'pressed',
      reached: reached.pressed,
      at: f.dates.pressed || null,
      text: reached.pressed
        ? `Você voltou a ela ${f.revisits === 1 ? 'num outro dia' : `em ${f.revisits} dias diferentes`} e acrescentou algo.`
        : '',
      hint: reached.pressed
        ? ''
        : 'Ganha a flor prensada quando você volta, pelo menos um dia depois, e muda algo nela.',
    },
  ];
  const traits = CARD_TRAITS.filter((trait) => reached[trait]);
  return { stage: traits.at(-1), traits, facts: f, lines };
}

/** One short sentence for screen readers and the card's summary ("Carimbado e costurado"). */
export function describeState(state) {
  if (state.stage === 'sketch') return TRAIT_NAMES.sketch;
  const names = state.traits.map((trait) => TRAIT_NAMES[trait].toLocaleLowerCase('pt-BR'));
  const text = names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}` : names[0];
  return text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
}

/**
 * Pairs of connected discoveries from list rows (each connection appears on both rows): one
 * entry per pair, only between discoveries present in the list, oldest first.
 */
export function connectionPairs(rows = []) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const pairs = new Map();
  for (const row of rows)
    for (const c of Array.isArray(row.connections) ? row.connections : []) {
      if (!byId.has(c.otherId) || c.otherId === row.id) continue;
      const [x, y] = [row.id, c.otherId].sort();
      if (!pairs.has(`${x}:${y}`))
        pairs.set(`${x}:${y}`, { a: byId.get(x), b: byId.get(y), acrossSubjects: Boolean(c.acrossSubjects), createdAt: c.createdAt || null });
    }
  return [...pairs.values()].sort((p, q) => String(p.createdAt).localeCompare(String(q.createdAt)));
}

/** Discoveries grouped by subject (as the lesson's subject was when recorded), A→Z; none last. */
export function groupBySubject(rows = [], locale = 'pt-BR') {
  const groups = new Map();
  for (const row of rows) {
    const label = String(row.subject || '').trim();
    const key = label.toLocaleLowerCase(locale);
    if (!groups.has(key)) groups.set(key, { key, label, items: [] });
    groups.get(key).items.push(row);
  }
  return [...groups.values()].sort((a, b) =>
    !a.key ? 1 : !b.key ? -1 : a.label.localeCompare(b.label, locale),
  );
}

// Milestones: the first time the student did something that matters, read from the server's
// unlock rows (each keeps its date, lesson and discovery). Nothing here is computed client-side.
export const MILESTONES = Object.freeze({
  'stamp.first-evidence': 'Primeira evidência conferida',
  'stamp.own-explanation': 'Primeira explicação com as suas palavras',
  'stamp.first-investigation': 'Primeira descoberta registrada',
  'stamp.first-reflection': 'Primeira reflexão',
  'stamp.connection': 'Primeira ponte entre disciplinas',
  'stamp.revisit': 'Primeira revisita',
});

export function milestonesOf(unlocks = []) {
  return unlocks
    .filter((unlock) => Object.hasOwn(MILESTONES, unlock?.id))
    .map((unlock) => ({ ...unlock, label: MILESTONES[unlock.id] }))
    .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
}
