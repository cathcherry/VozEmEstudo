import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSummaryOptions,
  summaryName,
  summaryDetails,
  recommendQuestionCount,
  distinctTerms,
  listName,
  listDetails,
} from '../js/utils/authoring.js';

test('summary form values keep the legacy API shape and add only chosen extras', () => {
  assert.deepEqual(
    normalizeSummaryOptions({ format: 'bullets', length: 'brief', readingLevel: '' }),
    {
      format: 'topics',
      length: 'short',
    },
  );
  assert.deepEqual(
    normalizeSummaryOptions({
      format: 'chronological',
      length: 'intermediate',
      focus: ['dates', 'dates', 'bogus', 'exam'],
      label: '  Linha do tempo ',
    }),
    {
      format: 'chronological',
      length: 'standard',
      focus: ['dates', 'exam'],
      label: 'Linha do tempo',
    },
  );
});

test('summary versions are distinguishable by name, options and source revision', () => {
  assert.equal(summaryName({ version: 3 }), 'Versão 3');
  assert.equal(summaryName({ version: 3, label: 'Para a prova' }), 'Para a prova');
  assert.deepEqual(
    summaryDetails({
      version: 3,
      label: 'Para a prova',
      options: { format: 'definitions', length: 'short', readingLevel: 'simple' },
      source_transcription_revision: 2,
    }),
    ['Versão 3', 'Definições e conceitos-chave', 'Breve', 'Linguagem simples', 'revisão 2'],
  );
  assert.deepEqual(summaryDetails({ version: 1, options: {}, source_transcription_revision: 1 }), [
    'revisão 1',
  ]);
});

test('question-count guidance follows duration bands and is tempered by content density', () => {
  const word = (i) =>
    'termo' + [...i.toString(26)].map((c) => String.fromCharCode(97 + parseInt(c, 26))).join('');
  const rich = Array.from({ length: 400 }, (_, i) => word(i)).join(' ');
  assert.deepEqual(
    [
      recommendQuestionCount({ durationMs: 3 * 60000, text: rich }).min,
      recommendQuestionCount({ durationMs: 3 * 60000, text: rich }).max,
    ],
    [3, 5],
  );
  assert.equal(recommendQuestionCount({ durationMs: 10 * 60000, text: rich }).max, 10);
  assert.equal(recommendQuestionCount({ durationMs: 20 * 60000, text: rich }).max, 20);
  const long = recommendQuestionCount({ durationMs: 50 * 60000, text: rich, max: 40 });
  assert.equal(long.max, 30);
  assert.match(long.notes.join(' '), /densidade e da cobertura/);
  // A long but repetitive recording does not justify many questions.
  const thin = recommendQuestionCount({
    durationMs: 25 * 60000,
    text: 'energia energia conservada '.repeat(300),
  });
  assert.deepEqual([thin.min, thin.max], [3, 3]);
  assert.match(thin.notes.join(' '), /poucos termos distintos/);
  // More cognitive skills allow testing the same concept with a different purpose.
  const medium = Array.from({ length: 48 }, (_, i) => word(i)).join(' ');
  assert(
    recommendQuestionCount({ durationMs: 25 * 60000, text: medium, skills: 4 }).max >
      recommendQuestionCount({ durationMs: 25 * 60000, text: medium, skills: 1 }).max,
  );
  assert.equal(recommendQuestionCount({ durationMs: 50 * 60000, text: rich, max: 12 }).max, 12);
  assert.equal(distinctTerms('Energia, energia; ENERGIA e potencial.'), 2);
});

test('lists are named or numbered and expose skills/difficulty labels', () => {
  assert.equal(listName({ title: 'História — Básico' }, 0, 3), 'História — Básico');
  assert.equal(listName({}, 0, 3), 'Conjunto 3');
  assert.deepEqual(
    listDetails({ config: { difficulties: ['basic', 'advanced'], skills: ['recall', 'x'] } }),
    {
      levels: ['Básico', 'Avançado'],
      skills: ['Recordação'],
    },
  );
  assert.deepEqual(listDetails({}), { levels: [], skills: [] });
});

test('question presets map to valid settings and are recognised back', async () => {
  const { QUESTION_GOALS, presetFor } = await import('../js/utils/authoring.js');
  const skills = [
    'recall',
    'understanding',
    'interpretation',
    'application',
    'analysis',
    'cause_effect',
    'evaluation',
    'synthesis',
  ];
  for (const [key, preset] of Object.entries(QUESTION_GOALS)) {
    assert(preset.difficulties.length && preset.skills.length, key);
    assert(
      preset.skills.every((skill) => skills.includes(skill)),
      key,
    );
    assert.equal(presetFor(preset), key, `${key} round-trips`);
  }
  assert.equal(
    presetFor({ difficulties: ['basic'], skills: ['recall'], distribution: 'balanced' }),
    'custom',
  );
  assert.equal(
    presetFor({ ...QUESTION_GOALS.exam, distribution: 'balanced' }),
    'custom',
    'order matters',
  );
});
