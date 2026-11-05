import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import {
  FLASHCARD_RATINGS, formatFlashcardDue, flashcardSummary,
} from '../js/utils/flashcard-view.js';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(frontend, 'pages/painel.html'), 'utf8');
const code = readFileSync(resolve(frontend, 'js/pages/flashcards-panel.js'), 'utf8');
const dashboard = readFileSync(resolve(frontend, 'js/pages/dashboard.page.js'), 'utf8');
const css = readFileSync(resolve(frontend, 'css/flashcards.css'), 'utf8');

test('flashcards are hidden until the feature is explicitly enabled', () => {
  assert.match(html, /data-flashcards-panel hidden/);
  assert.match(code, /isFeatureEnabled\('flashcards'\)/);
  assert.match(dashboard, /initFlashcardsPanel/);
  assert.match(html, /\/css\/flashcards\.css/);
  assert.match(css, /body\[data-page='dashboard'\]/);
});

test('create, reveal, rate, edit, and archive controls have labels and statuses', () => {
  for (const marker of [
    'data-flashcard-create-form',
    'data-flashcard-create-status role="status" aria-live="polite"',
    'data-flashcard-review-status role="status" aria-live="polite"',
    'data-flashcard-manage-form',
    'data-flashcard-manage-status role="status" aria-live="polite"',
    'data-flashcard-due-area',
  ]) assert(html.includes(marker), marker);
  assert.match(code, /Revelar resposta/);
  assert.match(code, /reviewFlashcard/);
  assert.match(code, /crypto\.randomUUID\(\)/);
  assert.match(code, /pendingReview/);
  assert.match(code, /updateFlashcard/);
  assert.doesNotMatch(code, /innerHTML/);
});

test('review choices and dates are grounded and formatting is deterministic', () => {
  assert.deepEqual(FLASHCARD_RATINGS.map((rating) => rating.value), [0, 1, 2, 3]);
  assert.deepEqual(FLASHCARD_RATINGS.map((rating) => rating.label),
    ['De novo', 'Difícil', 'Bom', 'Fácil']);
  assert.equal(flashcardSummary(0), '0 cartões para revisar');
  assert.equal(flashcardSummary(1), '1 cartão para revisar');
  assert.equal(formatFlashcardDue('not a date'), 'Data indisponível');
  assert.match(formatFlashcardDue('2026-11-05T14:00:00Z'), /2026/);
});

const sampleCard = (id) => ({
  id, front_text: `Pergunta ${id}`, back_text: 'Resposta', status: 'active',
  due_at: '2026-11-05T12:00:00Z', material_id: 'lesson-a',
});

async function harness(overrides = {}) {
  const dom = new JSDOM(html);
  const dependencies = {
    isFeatureEnabled: async () => true,
    setStatus: (element, message) => { element.textContent = message; },
    listFlashcards: async () => ({ cards: [], total: 0, limit: 100, offset: 0 }),
    createFlashcard: async () => ({}),
    updateFlashcard: async () => ({}),
    reviewFlashcard: async () => ({ dueAt: '2026-11-06T12:00:00Z' }),
    listFlashcardReviews: async () => [],
    getFlashcardSource: async () => ({ review: { state: 'ready_to_generate', sourceRevisionId: 'source-a' } }),
    previewFlashcards: async () => ({ cards: [], revision: 1 }),
    FLASHCARD_RATINGS, formatFlashcardDue, flashcardSummary,
    ...overrides,
  };
  // Evaluate the real page module against an isolated DOM and controlled API responses.
  const source = code.replace(/import \{[\s\S]*?\} from '[^']+';/gu, '')
    .replace('export async function initFlashcardsPanel', 'async function initFlashcardsPanel');
  const init = new Function('document', 'Option', ...Object.keys(dependencies),
    `${source}\nreturn initFlashcardsPanel;`)(dom.window.document, dom.window.Option,
    ...Object.values(dependencies));
  await init({ materials: [{ id: 'lesson-a', title: 'Aula A' }] });
  const document = dom.window.document;
  return {
    document,
    change(select, value) {
      select.value = value;
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    },
    close: () => dom.window.close(),
  };
}

async function until(check) {
  for (let i = 0; i < 30; i++) {
    if (check()) return;
    await new Promise((done) => setImmediate(done));
  }
  assert(check(), 'the expected UI state was not reached');
}

test('AI preview shows evidence, does not save automatically, and copies a suggestion for editing', async () => {
  let writes = 0;
  let requested;
  const ui = await harness({
    createFlashcard: async () => { writes++; },
    previewFlashcards: async (input) => {
      requested = input;
      return { revision: 3, cards: [{ front: '<img src=x onerror=alert(1)>', back: 'Resposta para conferir', evidence: 'Trecho literal da aula.' }] };
    },
  });
  try {
    const form = ui.document.querySelector('.flashcard-generator form');
    form.querySelector('select').value = 'lesson-a';
    form.dispatchEvent(new ui.document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => ui.document.querySelector('.flashcard-draft'));
    assert.deepEqual(requested, { materialId: 'lesson-a', sourceRevisionId: 'source-a', count: 5 });
    assert.equal(writes, 0);
    assert.equal(ui.document.querySelector('.flashcard-draft img'), null);
    assert.match(ui.document.querySelector('.flashcard-draft').textContent, /Trecho literal/);
    ui.document.querySelector('.flashcard-draft button').click();
    const create = ui.document.querySelector('[data-flashcard-create-form]');
    assert.equal(create.querySelector('[name="front"]').value, '<img src=x onerror=alert(1)>');
    assert.equal(create.querySelector('[name="back"]').value, 'Resposta para conferir');
    assert.equal(create.querySelector('[name="materialId"]').value, 'lesson-a');
    assert.equal(writes, 0);
  } finally { ui.close(); }
});

test('AI preview blocks an unconfirmed lesson and leaves a retryable error', async () => {
  let previews = 0;
  const ui = await harness({
    getFlashcardSource: async () => ({ review: { state: 'awaiting_review' } }),
    previewFlashcards: async () => { previews++; },
  });
  try {
    const form = ui.document.querySelector('.flashcard-generator form');
    form.querySelector('select').value = 'lesson-a';
    form.dispatchEvent(new ui.document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => /confirme/.test(ui.document.querySelector('.flashcard-generator [role="status"]').textContent));
    assert.equal(previews, 0);
    assert.equal(form.querySelector('button').disabled, false);
    assert.equal(ui.document.querySelector('.flashcard-draft'), null);
  } finally { ui.close(); }
});

test('provider failure unlocks AI preview and preserves the manual creation form', async () => {
  const ui = await harness({ previewFlashcards: async () => { throw new Error('Provedor indisponível'); } });
  try {
    const createFront = ui.document.querySelector('[data-flashcard-create-form] [name="front"]');
    createFront.value = 'Meu cartão';
    const form = ui.document.querySelector('.flashcard-generator form');
    form.querySelector('select').value = 'lesson-a';
    form.dispatchEvent(new ui.document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => /Provedor indisponível/.test(ui.document.querySelector('.flashcard-generator [role="status"]').textContent));
    assert.equal(form.querySelector('button').disabled, false);
    assert.equal(createFront.value, 'Meu cartão');
  } finally { ui.close(); }
});

test('manager reaches card 101 and resets pagination when filtering by lesson or archive status', async () => {
  const calls = [];
  const ui = await harness({
    async listFlashcards(filter, options) {
      calls.push({ filter, ...options });
      if (filter === 'due') return { cards: [], total: 0, limit: 100 };
      const total = options.materialId || options.status === 'archived' ? 1 : 101;
      const start = options.offset || 0;
      return { cards: Array.from({ length: Math.min(100, total - start) }, (_, i) => sampleCard(`card-${start + i + 1}`)),
        total, limit: 100, offset: start };
    },
  });
  try {
    const nav = ui.document.querySelector('.flashcard-pagination');
    const [previous, next] = nav.querySelectorAll('button');
    const select = ui.document.querySelector('[name="cardId"]');
    assert(previous.disabled);
    next.click();
    await until(() => select.options[1]?.value === 'card-101');
    assert(next.disabled);
    assert(!previous.disabled);
    assert.match(nav.textContent, /101–101 de 101/);
    const [lesson, status] = ui.document.querySelectorAll('.flashcard-filters select');
    ui.change(lesson, 'lesson-a');
    await until(() => !lesson.disabled);
    assert.equal(select.options[1].value, 'card-1');
    assert(calls.some((call) => call.filter === 'due' && call.materialId === 'lesson-a'));
    assert.equal(calls.at(-1).offset, 0);
    ui.change(status, 'archived');
    await until(() => !status.disabled);
    assert.equal(calls.at(-1).status, 'archived');
    assert.match(nav.textContent, /1–1 de 1/);
  } finally { ui.close(); }
});

test('late history responses cannot replace the selected card', async () => {
  let resolveFirst;
  const ui = await harness({
    async listFlashcards(filter) {
      return { cards: filter === 'all' ? [sampleCard('one'), sampleCard('two')] : [], total: filter === 'all' ? 2 : 0, limit: 100 };
    },
    listFlashcardReviews(id) {
      if (id === 'one') return new Promise((done) => { resolveFirst = done; });
      return Promise.resolve([{ reviewed_at: '2026-11-05T12:00:00Z', rating: 3, due_at: '2026-11-06T12:00:00Z' }]);
    },
  });
  try {
    const select = ui.document.querySelector('[name="cardId"]');
    ui.change(select, 'one');
    ui.change(select, 'two');
    const history = ui.document.querySelector('.flashcard-history');
    await until(() => history.textContent.includes('Fácil'));
    resolveFirst([{ reviewed_at: '2026-11-05T12:00:00Z', rating: 0, due_at: '2026-11-05T12:10:00Z' }]);
    await new Promise((done) => setImmediate(done));
    assert.match(history.textContent, /Fácil/);
    assert.doesNotMatch(history.textContent, /De novo/);
    ui.change(select, '');
    assert.equal(history.textContent, '');
  } finally { ui.close(); }
});

test('a confirmed review is removed even if refreshing the queue fails', async () => {
  let reviewed = false;
  let writes = 0;
  const ui = await harness({
    async listFlashcards() {
      if (reviewed) throw new Error('Sem conexão');
      return { cards: [sampleCard('one')], total: 1, limit: 100 };
    },
    async reviewFlashcard() {
      writes++;
      reviewed = true;
      return { dueAt: '2026-11-06T12:00:00Z' };
    },
  });
  try {
    const area = ui.document.querySelector('[data-flashcard-due-area]');
    area.querySelector('button').click();
    area.querySelectorAll('button')[2].click();
    await until(() => ui.document.querySelector('[data-flashcard-review-status]').textContent.includes('lista não pôde'));
    assert.equal(writes, 1);
    assert.equal(area.querySelector('button'), null);
    assert.doesNotMatch(ui.document.querySelector('[data-flashcard-review-status]').textContent, /Repita/);
  } finally { ui.close(); }
});

test('an uncertain review locks filters and retries the same request ID and rating', async () => {
  const requests = [];
  let confirmed = false;
  const ui = await harness({
    async listFlashcards() {
      return { cards: confirmed ? [] : [sampleCard('one')], total: confirmed ? 0 : 1, limit: 100 };
    },
    async reviewFlashcard(id, rating, requestId) {
      requests.push({ id, rating, requestId });
      if (requests.length === 1) throw new Error('Resposta interrompida');
      confirmed = true;
      return { dueAt: '2026-11-06T12:00:00Z' };
    },
  });
  try {
    const area = ui.document.querySelector('[data-flashcard-due-area]');
    const status = ui.document.querySelector('[data-flashcard-review-status]');
    area.querySelector('button').click();
    area.querySelectorAll('button')[2].click();
    await until(() => status.textContent.includes('Repita'));
    assert([...ui.document.querySelectorAll('.flashcard-filters select')].every((select) => select.disabled));
    assert(ui.document.querySelector('[data-flashcard-create-form] button').disabled);
    const buttons = area.querySelectorAll('button');
    assert(buttons[0].disabled);
    assert(!buttons[2].disabled);
    buttons[2].click();
    await until(() => status.textContent.includes('Revisão registrada.'));
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    await until(() => !ui.document.querySelector('.flashcard-filters select').disabled);
  } finally { ui.close(); }
});

