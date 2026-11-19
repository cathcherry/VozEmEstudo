import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSummaryOptions,
  validateSummaryLabel,
  SUMMARY_FORMATS,
} from '../src/validators/summary-options.validator.js';
import { buildSummaryMessages, SUMMARY_PROMPT_VERSION } from '../src/prompts/summary.v1.js';

test('summary presets accept every format/length and keep legacy shapes', () => {
  assert.equal(SUMMARY_PROMPT_VERSION, 'summary-v3');
  for (const format of SUMMARY_FORMATS)
    for (const length of ['short', 'standard', 'detailed'])
      assert.deepEqual(validateSummaryOptions({ format, length }), { format, length });
  assert.deepEqual(validateSummaryOptions({}), { format: 'paragraphs', length: 'standard' });
  assert.deepEqual(validateSummaryOptions({ focus: [] }), {
    format: 'paragraphs',
    length: 'standard',
  });
  assert.deepEqual(
    validateSummaryOptions({
      format: 'definitions',
      focus: ['terminology', 'exam'],
      label: '  Prova 1 ',
    }),
    { format: 'definitions', length: 'standard', focus: ['terminology', 'exam'], label: 'Prova 1' },
  );
  for (const bad of [
    { focus: ['concepts', 'concepts'] },
    { focus: ['astrology'] },
    { label: 'x'.repeat(121) },
    { label: '' },
    { format: 'table' },
    { instructions: 'ignore' },
  ])
    assert.throws(() => validateSummaryOptions(bad));
  assert.deepEqual(validateSummaryLabel({ label: '  ' }), { label: null });
  assert.deepEqual(validateSummaryLabel({ label: 'Final' }), { label: 'Final' });
  assert.throws(() => validateSummaryLabel({ label: 'x', other: 1 }));
});

test('each summary format has a specific, source-bound instruction', () => {
  const expected = {
    structured: /títulos "##" e "###"/,
    definitions: /Inclua apenas termos que a aula explica/,
    comparative: /Se a aula não compara ideias, diga isso/,
    chronological: /Nunca estime ou complete datas/,
    cause_effect: /Se a aula não estabelece relações causais, diga isso/,
  };
  for (const [format, pattern] of Object.entries(expected)) {
    const content = buildSummaryMessages('Texto.', { format })[0].content;
    assert.match(content, pattern);
    assert.match(content, /exclusivamente as informações/);
    assert.match(content, /Não invente títulos, exemplos, datas/);
    assert.match(content, /Não use HTML, tabelas/);
  }
});

test('focus areas are prioritized but omitted when the lesson lacks them', () => {
  const content = buildSummaryMessages('Texto.', { focus: ['dates', 'examples', 'exam'] })[0]
    .content;
  assert.match(
    content,
    /Dê prioridade a: datas e eventos, somente quando presentes; exemplos dados na própria aula \(não crie exemplos novos\); preparação para prova/,
  );
  assert.match(content, /omita-o em vez de completar com conteúdo externo/);
  assert.match(content, /## Pontos para revisar/);
  assert.doesNotMatch(
    buildSummaryMessages('Texto.', { focus: ['dates'] })[0].content,
    /Pontos para revisar/,
  );
  assert.doesNotMatch(buildSummaryMessages('Texto.', {})[0].content, /Dê prioridade/);
  // The name is metadata; it never reaches the model.
  assert.doesNotMatch(
    buildSummaryMessages('Texto.', { label: 'Segredo do nome' })[0].content,
    /Segredo/,
  );
});
