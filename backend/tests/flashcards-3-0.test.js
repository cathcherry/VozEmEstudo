import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNote, NOTE_TYPE_KEYS, contentHash } from '../src/domain/flashcard-notes.js';
import { planMerge, previewMerge, resolveMerge } from '../src/domain/deck-merge.js';

test('every note type renders plain study text from its fields', () => {
  const cases = {
    basic: [{ front: 'O que é ATP?', back: 'Moeda de energia' }, 'O que é ATP?', 'Moeda de energia'],
    term: [{ term: 'Entropia', definition: 'Medida da desordem', example: 'Gelo derretendo' }, 'Entropia', 'Medida da desordem\n\nExemplo: Gelo derretendo'],
    cloze: [{ text: 'A {{c1::clorofila}} absorve {{c2::luz::radiação}}.' }, 'A […] absorve [radiação].', 'A clorofila absorve luz.'],
    cause_effect: [{ cause: 'Falta de luz', effect: 'A fotossíntese para' }, 'Qual é o efeito de: Falta de luz?', 'A fotossíntese para'],
    comparison: [{ a: 'Mitose', b: 'Meiose', criterion: 'número de divisões', answer: 'Uma × duas' }, 'Mitose × Meiose: número de divisões?', 'Uma × duas'],
    sequence: [{ title: 'Glicólise', steps: ['Investimento', 'Clivagem', 'Rendimento'] }, 'Quais são as etapas de: Glicólise?', '1. Investimento\n2. Clivagem\n3. Rendimento'],
    application: [{ situation: 'Uma planta no escuro por dias.', answer: 'Perde reservas.' }, 'Uma planta no escuro por dias.', 'Perde reservas.'],
    error_spotting: [{ statement: 'O ATP é uma proteína.', correction: 'É um nucleotídeo.' }, 'Onde está o erro? O ATP é uma proteína.', 'É um nucleotídeo.'],
  };
  assert.deepEqual(Object.keys(cases).sort(), [...NOTE_TYPE_KEYS].sort());
  for (const [type, [fields, front, back]] of Object.entries(cases)) {
    const note = buildNote({ noteType: type, fields });
    assert.deepEqual([note.front, note.back], [front, back], type);
    assert.match(note.contentHash, /^[0-9a-f]{64}$/);
  }
});

test('note fields are validated: required, unknown, limits, cloze needs a gap, markup stays text', () => {
  assert.throws(() => buildNote({ noteType: 'term', fields: { term: 'X' } }), /definition/);
  assert.throws(() => buildNote({ noteType: 'basic', fields: { front: 'a', back: 'b', html: '<b>' } }), /desconhecido/);
  assert.throws(() => buildNote({ noteType: 'cloze', fields: { text: 'sem lacuna' } }), /lacuna/);
  assert.throws(() => buildNote({ noteType: 'sequence', fields: { title: 'T', steps: ['só uma'] } }), /duas etapas/);
  assert.throws(() => buildNote({ noteType: 'poem', fields: {} }), /desconhecido/);
  const note = buildNote({ noteType: 'basic', fields: { front: '<script>x</script>?', back: 'ok' } });
  assert.equal(note.front, '<script>x</script>?', 'kept as plain text; clients render it with textContent');
  assert.equal(contentHash('Fotossíntese!', 'Luz'), contentHash('fotossintese', 'luz.'));
});

const card = (id, front, back, extra = {}) => ({ id, front_text: front, back_text: back, status: 'active', ...extra });
const classmate = (n, cards) => ({
  setId: `set-${n}`,
  name: `Baralho de ${n}`,
  kind: 'classroom',
  author: { id: `user-${n}`, label: n },
  cards,
});

test('merging 4 of 7 classmates: repeats once, conflicts decided, sources untouched, authorship kept', () => {
  const classmates = {
    Ana: classmate('Ana', [card('a1', 'O que é ATP?', 'Moeda de energia'), card('a2', 'Onde ocorre a fotossíntese?', 'No cloroplasto')]),
    Bruno: classmate('Bruno', [card('b1', 'o que é ATP', 'moeda de energia.'), card('b2', 'Onde ocorre a fotossíntese?', 'Nas folhas')]),
    Caio: classmate('Caio', [card('c1', 'O que é NADPH?', 'Transportador de elétrons')]),
    Duda: classmate('Duda', [card('d1', 'Onde ocorre a fotossíntese?', 'Nos cloroplastos das folhas'), card('d2', 'Arquivado', 'x', { status: 'archived' })]),
    Eva: classmate('Eva', [card('e1', 'Ignorada', 'não escolhida')]),
  };
  // The student picks 4 of the 7 classmates.
  const chosen = ['Ana', 'Bruno', 'Caio', 'Duda'].map((name) => classmates[name]);
  const snapshot = JSON.stringify(chosen);
  const plan = planMerge(chosen);
  const preview = previewMerge(plan);
  assert.equal(preview.total, 6, 'archived cards do not travel');
  assert.equal(preview.duplicates, 1, 'Ana and Bruno wrote the same ATP card');
  assert.equal(preview.conflicts.length, 1);
  assert.deepEqual(preview.conflicts[0].options.map((o) => o.label), ['Ana', 'Bruno', 'Duda']);
  assert.equal(preview.resulting, 3);

  const kept = resolveMerge(plan, { [preview.conflicts[0].key]: 'keep:d1' });
  assert.deepEqual(kept.map((c) => [c.front, c.back, c.originLabel]), [
    ['O que é ATP?', 'Moeda de energia', 'Ana'],
    ['O que é NADPH?', 'Transportador de elétrons', 'Caio'],
    ['Onde ocorre a fotossíntese?', 'Nos cloroplastos das folhas', 'Duda'],
  ]);
  assert(kept.every((c) => c.originKind === 'classroom' && c.originCardId && c.originSetId));
  assert.deepEqual(kept.map((c) => c.media), [[], [], []], 'images of other people are not copied');

  const combined = resolveMerge(plan, {});
  const merged = combined.find((c) => c.front === 'Onde ocorre a fotossíntese?');
  assert.equal(merged.back, 'Ana: No cloroplasto\n\nBruno: Nas folhas\n\nDuda: Nos cloroplastos das folhas');
  assert.equal(merged.originLabel, 'Ana + Bruno + Duda');
  assert.equal(JSON.stringify(chosen), snapshot, 'the sources are not modified');
});
