import test from 'node:test';
import assert from 'node:assert/strict';
import { copiesTranscript, lengthGiveaway, questionQualityIssue } from '../src/domain/question-quality.js';
import { normalizeText } from '../src/domain/question-redundancy.js';

// The two giveaways seen in production (24/11/2026, a food vlog): the correct alternative was the
// speaker's own sentence, copied from the transcript and much longer than the distractors.
const transcript = normalizeText(
  'No shoyu, dou 5 de 10, porque o salgado caseiro não combinou. O negócio é que eu amo polvo, mas parece que eu tô comendo uma fruta com muito limão. E parece chiclete, demorei 10 horas pra mastigar.',
);

test('an alternative copied from the transcript is rejected', () => {
  const copied = 'o negócio é que eu amo polvo, mas parece que eu tô comendo uma fruta com muito limão';
  assert.equal(copiesTranscript(copied, transcript), true);
  assert.equal(copiesTranscript('Ácido como limão e elástico como chiclete', transcript), false);
  assert.equal(
    questionQualityIssue(
      { options: [copied, 'Doce e macio', 'Salgado e crocante', 'Neutro e firme'], correctIndex: 0 },
      transcript,
    ),
    'copied_option',
  );
});

test('a correct alternative much longer than the others is rejected', () => {
  const options = [
    'Lembrou uma fruta muito ácida e ficou borrachudo, difícil de mastigar por muito tempo',
    'Doce e macio',
    'Salgado e crocante',
    'Neutro e firme',
  ];
  assert.equal(lengthGiveaway(options, 0), true);
  assert.equal(questionQualityIssue({ options, correctIndex: 0 }, transcript), 'length_giveaway');
});

test('a balanced, paraphrased question passes', () => {
  const options = ['Ácido e elástico', 'Doce e macio', 'Salgado e crocante', 'Neutro e firme'];
  assert.equal(questionQualityIssue({ options, correctIndex: 0 }, transcript), null);
  assert.equal(lengthGiveaway(['Ácido e elástico, como chiclete', 'Doce e macio', 'Salgado e crocante', 'Neutro e firme'], 0), false);
});
