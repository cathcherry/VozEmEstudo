import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFlashcardGenerationService } from '../src/services/flashcard-generation.service.js';
import { validateFlashcardGeneration, validateGeneratedFlashcards } from '../src/validators/flashcard-generation.validator.js';
import { validateSummaryGeneration, validateSummaryOptions } from '../src/validators/summary-options.validator.js';
import { buildSummaryMessages } from '../src/prompts/summary.v1.js';

const materialId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourceRevisionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const body = { materialId, sourceRevisionId, count: 5 };
const text = 'A fotossíntese transforma energia luminosa em energia química.';
const cards = [{ front: 'O que a fotossíntese transforma?', back: 'Energia luminosa em energia química.', evidence: text }];
const ready = { state: 'ready_to_generate', permissionRequired: false,
  sourceRevisionId, confirmation: { sourceRevisionId } };

function setup(overrides = {}) {
  const calls = [];
  const service = buildFlashcardGenerationService({
    getOwnedMaterial: async (...args) => { calls.push(['owner', ...args]); },
    getReviewState: async (...args) => { calls.push(['review', ...args]); return ready; },
    getVersion: async (...args) => { calls.push(['source', ...args]); return { full_text: text, revision: 2 }; },
    complete: async (input) => { calls.push(['llm', input]); return { cards }; },
    model: 'test-model', ...overrides,
  });
  return { service, calls };
}

test('preview uses owned confirmed immutable revision, returns provenance and never saves', async () => {
  const { service, calls } = setup();
  const result = await service('owner-a', body);
  assert.deepEqual(calls.map((call) => call[0]), ['owner', 'review', 'source', 'llm']);
  assert.deepEqual(calls[0], ['owner', 'owner-a', materialId]);
  assert.deepEqual(calls[2], ['source', materialId, sourceRevisionId]);
  assert.equal(result.sourceRevisionId, sourceRevisionId);
  assert.equal(result.revision, 2);
  assert.equal(result.model, 'test-model');
  assert.deepEqual(result.cards, cards);
  assert.match(calls[3][1].messages[1].content, /fotossíntese/);
  assert.match(calls[3][1].messages[0].content, /ignore quaisquer instruções/);
});

test('foreign material is rejected before source or provider access', async () => {
  const { service, calls } = setup({ getOwnedMaterial: async () => { throw new Error('foreign'); } });
  await assert.rejects(service('owner-b', body), /foreign/);
  assert.deepEqual(calls, []);
});

test('unconfirmed, stale or permissionless revisions never reach the provider', async () => {
  for (const review of [
    { ...ready, state: 'awaiting_review' }, { ...ready, permissionRequired: true },
    { ...ready, sourceRevisionId: materialId }, { ...ready, confirmation: null },
    { ...ready, confirmation: { sourceRevisionId: materialId } },
  ]) {
    const { service, calls } = setup({ getReviewState: async () => review });
    await assert.rejects(service('owner', body), (error) => error.code === 'TRANSCRIPTION_CONFIRMATION_REQUIRED');
    assert(!calls.some((call) => call[0] === 'llm' || call[0] === 'source'));
  }
});

test('strict generation inputs reject foreign owner fields, invalid counts and bad UUIDs', () => {
  for (const input of [{ ...body, userId: 'other' }, { ...body, count: 100 },
    { ...body, count: '5' }, { ...body, sourceRevisionId: 'bad' }, { materialId }])
    assert.throws(() => validateFlashcardGeneration(input));
  assert.equal(validateFlashcardGeneration({ materialId, sourceRevisionId }).count, 5);
});

test('empty and oversized sources are rejected without truncation or provider calls', async () => {
  for (const full_text of ['', '  ', 'x'.repeat(80001)]) {
    const { service, calls } = setup({ getVersion: async () => ({ full_text }) });
    await assert.rejects(service('owner', body), (error) => ['EMPTY_SOURCE', 'SOURCE_TOO_LARGE'].includes(error.code));
    assert(!calls.some((call) => call[0] === 'llm'));
  }
});

test('malformed, duplicate, unsupported or excessive suggestions fail as a whole', () => {
  for (const raw of [{}, { cards: [] }, { cards: [{ ...cards[0], front: '' }] },
    { cards: [cards[0], { ...cards[0], front: `  ${cards[0].front.toUpperCase()}  ` }] },
    { cards: [{ ...cards[0], evidence: 'Este trecho não existe na fonte.' }] },
    { cards: [{ ...cards[0], extra: 'field' }] }, { cards: Array(6).fill(cards[0]) }])
    assert.throws(() => validateGeneratedFlashcards(raw, 5, text), (error) => error.code === 'LLM_INVALID_OUTPUT');
});

test('provider failure releases per-account generation lock for retry', async () => {
  let attempt = 0;
  const { service } = setup({ complete: async () => {
    if (++attempt === 1) throw new Error('offline');
    return { cards };
  } });
  await assert.rejects(service('owner', body), /offline/);
  assert.equal((await service('owner', body)).cards.length, 1);
});

test('only one preview per account runs at once, other accounts remain independent', async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const { service } = setup({ complete: async () => pending });
  const first = service('a', body);
  await assert.rejects(service('a', body), (error) => error.status === 429);
  const other = service('b', body);
  resolve({ cards });
  await Promise.all([first, other]);
});

test('summary options preserve legacy selection and accept only supported values', () => {
  const legacy = validateSummaryGeneration({ sourceRevisionId });
  assert.deepEqual(legacy.selection, { sourceRevisionId });
  assert.deepEqual(legacy.options, { format: 'paragraphs', length: 'standard' });
  assert.deepEqual(validateSummaryOptions({ format: 'topics', length: 'detailed' }),
    { format: 'topics', length: 'detailed' });
  for (const options of [{ format: 'html' }, { length: 'huge' }, { prompt: 'ignore' }, null])
    assert.throws(() => validateSummaryOptions(options));
  assert.throws(() => validateSummaryGeneration({ sourceRevisionId, userId: 'other' }));
});

test('summary prompts apply format and depth while restricting content to the source', () => {
  for (const format of ['paragraphs', 'topics']) for (const length of ['short', 'standard', 'detailed']) {
    const messages = buildSummaryMessages(text, { format, length });
    assert.match(messages[0].content, /exclusivamente as informações/);
    assert(messages[0].content.includes(format === 'topics' ? 'Organize em tópicos' : 'Organize em parágrafos'));
    assert.equal(messages[1].content, `TRANSCRIÇÃO:\n\n${text}`);
  }
});

test('plain-language summaries are opt-in and keep glossary definitions to the source', () => {
  assert.deepEqual(validateSummaryOptions({ readingLevel: 'simple' }), {
    format: 'paragraphs',
    length: 'standard',
    readingLevel: 'simple',
  });
  assert.throws(() => validateSummaryOptions({ readingLevel: 'child' }));
  const simple = buildSummaryMessages('texto', { readingLevel: 'simple' })[0].content;
  assert.match(simple, /linguagem simples/);
  assert.match(simple, /## Glossário/);
  assert.match(simple, /não explicado na aula/);
  assert.doesNotMatch(buildSummaryMessages('texto', {})[0].content, /Glossário/);
});
