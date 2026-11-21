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
  assert.deepEqual(cards[1], { front: 'A […] absorve [radiação].', back: 'A clorofila absorve luz.' });
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
