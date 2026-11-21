import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCardFile,
  mergeCards,
  chunk,
  htmlToText,
  clozeCard,
  cardKey,
  IMPORT_MAX,
  saveNewSet,
} from '../js/utils/deck-tools.js';
import { toFlashcardCsv } from '../js/utils/flashcard-csv.js';

test('Anki "Notes in Plain Text" with headers, HTML and a cloze note', () => {
  const file = [
    '#separator:tab',
    '#html:true',
    'O que é <b>ATP</b>?\tMoeda de energia<br>da célula',
    'A {{c1::clorofila}} absorve {{c2::luz::radiação}}.\t',
    'Sem verso\t',
  ].join('\n');
  const { cards, skipped, format } = parseCardFile(file);
  assert.equal(format, 'anki');
  assert.deepEqual(cards[0], { front: 'O que é ATP?', back: 'Moeda de energia\nda célula' });
  assert.deepEqual(cards[1], {
    front: 'A […] absorve [radiação].',
    back: 'A clorofila absorve luz.',
    clozeText: 'A {{c1::clorofila}} absorve {{c2::luz::radiação}}.',
  });
  assert.deepEqual(skipped, [{ line: 3, reason: 'empty' }]);
});

test('our own CSV export comes back intact, formula guard removed', () => {
  const csv = toFlashcardCsv(
    [
      {
        name: 'Bio',
        cards: [
          { front_text: 'Qual é a fórmula, afinal?', back_text: '=6CO2 + "6H2O"\nlinha 2' },
          { front_text: '-1 é negativo?', back_text: 'Sim' },
        ],
      },
    ],
    { lesson: 'Aula' },
  );
  const { cards, format } = parseCardFile(csv);
  assert.equal(format, 'csv');
  assert.deepEqual(cards, [
    { front: 'Qual é a fórmula, afinal?', back: '=6CO2 + "6H2O"\nlinha 2' },
    { front: '-1 é negativo?', back: 'Sim' },
  ]);
});

test('plain two-column files: tab or semicolon; scripts never survive; limits are reported', () => {
  assert.deepEqual(parseCardFile('a;b\nc;d\n').cards, [
    { front: 'a', back: 'b' },
    { front: 'c', back: 'd' },
  ]);
  assert.equal(htmlToText('<script>alert(1)</script>Oi &amp; tchau&#33;'), 'Oi & tchau!');
  const long = parseCardFile(`x\t${'y'.repeat(2001)}`);
  assert.deepEqual(long.skipped, [{ line: 1, reason: 'too_long' }]);
  const many = parseCardFile(Array.from({ length: IMPORT_MAX + 3 }, (_, i) => `q${i}\ta${i}`).join('\n'));
  assert.equal(many.cards.length, IMPORT_MAX);
  assert.equal(many.skipped.filter((s) => s.reason === 'limit').length, 3);
  assert.equal(clozeCard('sem lacuna'), null);
});

test('merging keeps one copy of exact duplicates and reports same question, different answer', () => {
  const a = {
    name: 'Ana',
    cards: [
      { front_text: 'O que é ATP?', back_text: 'Moeda de energia', difficulty: 'easy' },
      { front_text: 'Onde ocorre a fotossíntese?', back_text: 'No cloroplasto' },
    ],
  };
  const b = {
    name: 'Bruno',
    cards: [
      { front_text: 'o que é ATP', back_text: 'moeda de energia.' }, // same card, other spelling
      { front_text: 'Onde ocorre a fotossíntese?', back_text: 'Nos cloroplastos das folhas' },
    ],
  };
  const merged = mergeCards([a, b]);
  assert.equal(merged.cards.length, 3);
  assert.equal(merged.duplicates, 1);
  assert.deepEqual(merged.sameQuestion, [{ front: 'Onde ocorre a fotossíntese?', sources: ['Ana', 'Bruno'] }]);
  assert.equal(merged.cards[0].difficulty, 'easy');
  assert.equal(cardKey('Fotossíntese!'), cardKey('fotossintese'));
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(mergeCards([a, b], { limit: 2 }).overLimit, 1);
});

/** A stand-in for the 3.2 set API with the database's rules (replay by id, one front per set). */
function fakeSetApi({ dropAfterCommit = {} } = {}) {
  const sets = new Map();
  const calls = [];
  const key = (text) => text.trim().toLowerCase();
  const add = (set, cards) => {
    let added = 0;
    for (const card of cards)
      if (!set.cards.some((c) => key(c.front_text) === key(card.front))) {
        set.cards.push({ front_text: card.front, back_text: card.back });
        added += 1;
      }
    return added;
  };
  const answer = (kind, body) => {
    if (dropAfterCommit[kind] > 0) {
      dropAfterCommit[kind] -= 1;
      throw new TypeError('Failed to fetch'); // saved, but the answer never arrived
    }
    return body;
  };
  return {
    sets,
    calls,
    async createFlashcardSet({ id, name, cards }) {
      calls.push('create');
      if (sets.has(id)) return answer('create', { id, added: 0, replayed: true });
      const set = { id, name, cards: [] };
      sets.set(id, set);
      return answer('create', { id, added: add(set, cards), replayed: false });
    },
    async addFlashcardSetCards(id, cards) {
      calls.push('add');
      return answer('cards', { added: add(sets.get(id), cards) });
    },
    async getFlashcardSet(id) {
      calls.push('get');
      return structuredClone(sets.get(id));
    },
  };
}
const manyCards = (n) => Array.from({ length: n }, (_, i) => ({ front: `Pergunta ${i}?`, back: `Resposta ${i}` }));

test('saveNewSet (3.2 path): a retry after a dropped answer resumes the same set', async () => {
  const api = fakeSetApi({ dropAfterCommit: { cards: 1 } });
  const input = { id: 'set-1', name: 'Mesclado', cards: manyCards(250), origin: { kind: 'merge' } };
  await assert.rejects(saveNewSet(input, api), (error) => error.saved === 100 && error.setId === 'set-1');
  assert.equal(api.sets.get('set-1').cards.length, 200, 'the dropped part did reach the server');
  const done = await saveNewSet(input, api);
  assert.deepEqual(done, { id: 'set-1', saved: 250 });
  assert.equal(api.sets.size, 1, 'never a second set');
  assert.equal(api.sets.get('set-1').cards.length, 250, 'no card twice');
  assert.deepEqual(api.calls, ['create', 'add', 'create', 'get', 'add'], 'only the 50 missing cards are sent again');
});

test('saveNewSet: a dropped create is replayed, not duplicated; a first try sends every part', async () => {
  const api = fakeSetApi({ dropAfterCommit: { create: 1 } });
  const input = { id: 'set-2', name: 'Importado', cards: manyCards(120), origin: { kind: 'import' } };
  await assert.rejects(saveNewSet(input, api), (error) => !error.saved);
  assert.deepEqual(await saveNewSet(input, api), { id: 'set-2', saved: 120 });
  assert.equal(api.sets.size, 1);
  assert.equal(api.sets.get('set-2').cards.length, 120);
  const fresh = fakeSetApi();
  assert.deepEqual(await saveNewSet({ ...input, id: 'set-3' }, fresh), { id: 'set-3', saved: 120 });
  assert.deepEqual(fresh.calls, ['create', 'add'], 'no extra read when nothing was replayed');
});
