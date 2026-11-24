import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import {
  FLASHCARD_RATINGS,
  formatFlashcardDue,
  flashcardSummary,
} from '../js/utils/flashcard-view.js';
import { CARD_TEMPLATES, templateFor } from '../js/utils/card-templates.js';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(frontend, 'pages/flashcards.html'), 'utf8');
const code = readFileSync(resolve(frontend, 'js/pages/flashcards-panel.js'), 'utf8');
const dashboard = readFileSync(resolve(frontend, 'js/pages/flashcards.page.js'), 'utf8');
const css = readFileSync(resolve(frontend, 'css/flashcards.css'), 'utf8');

test('flashcards are hidden until the feature is explicitly enabled', () => {
  assert.match(html, /data-flashcards-panel hidden/);
  assert.match(code, /isFeatureEnabled\('flashcards'\)/);
  assert.match(dashboard, /initFlashcardsPanel/);
  assert.match(html, /\/css\/flashcards\.css/);
  assert.match(css, /data-page='flashcards'/);
});

test('create, reveal, rate, edit, and archive controls have labels and statuses', () => {
  for (const marker of [
    'data-flashcard-create-form',
    'data-flashcard-create-status role="status" aria-live="polite"',
    'data-flashcard-review-status role="status" aria-live="polite"',
    'data-flashcard-manage-form',
    'data-flashcard-manage-status role="status" aria-live="polite"',
    'data-flashcard-due-area',
  ])
    assert(html.includes(marker), marker);
  assert.match(code, /Virar cartão/);
  assert.match(code, /reviewFlashcard/);
  assert.match(code, /crypto\.randomUUID\(\)/);
  assert.match(code, /pendingReview/);
  assert.match(code, /updateFlashcard/);
  assert.doesNotMatch(code, /innerHTML/);
});

test('review choices and dates are grounded and formatting is deterministic', () => {
  assert.deepEqual(
    FLASHCARD_RATINGS.map((rating) => rating.value),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    FLASHCARD_RATINGS.map((rating) => rating.label),
    ['De novo', 'Difícil', 'Bom', 'Fácil'],
  );
  assert.equal(flashcardSummary(0), '0 cartões para revisar');
  assert.equal(flashcardSummary(1), '1 cartão para revisar');
  assert.equal(formatFlashcardDue('not a date'), 'Data indisponível');
  assert.match(formatFlashcardDue('2026-11-05T14:00:00Z'), /2026/);
});

const sampleCard = (id) => ({
  id,
  front_text: `Pergunta ${id}`,
  back_text: 'Resposta',
  status: 'active',
  due_at: '2026-11-05T12:00:00Z',
  material_id: 'lesson-a',
});

async function harness(overrides = {}) {
  const dom = new JSDOM(html);
  const dependencies = {
    // Existing scenarios run without the sets migration flag; set scenarios enable it explicitly.
    isFeatureEnabled: async (name) => name !== 'flashcard_sets',
    addFlashcardSetCards: async () => ({ added: 1 }),
    deleteFlashcard: async () => ({}),
    initFlashcardSetsPanel: () => ({ load: async () => [] }),
    confirm: () => true,
    ninoNote: (text) => {
      const note = new JSDOM('').window.document.createElement('p');
      note.textContent = text;
      return note;
    },
    setStatus: (element, message) => {
      element.textContent = message;
    },
    listFlashcards: async () => ({ cards: [], total: 0, limit: 100, offset: 0 }),
    createFlashcard: async () => ({}),
    updateFlashcard: async () => ({}),
    reviewFlashcard: async () => ({ dueAt: '2026-11-06T12:00:00Z' }),
    listFlashcardReviews: async () => [],
    getFlashcardSource: async () => ({
      review: { state: 'ready_to_generate', sourceRevisionId: 'source-a' },
    }),
    previewFlashcards: async () => ({ cards: [], revision: 1 }),
    FLASHCARD_RATINGS,
    formatFlashcardDue,
    flashcardSummary,
    CARD_TEMPLATES,
    templateFor,
    toast: () => {},
    ...overrides,
  };
  // Evaluate the real page module against an isolated DOM and controlled API responses.
  const source = code
    .replace(/import \{[\s\S]*?\} from '[^']+';/gu, '')
    .replace('export async function initFlashcardsPanel', 'async function initFlashcardsPanel');
  const init = new Function(
    'document',
    'Option',
    ...Object.keys(dependencies),
    `${source}\nreturn initFlashcardsPanel;`,
  )(dom.window.document, dom.window.Option, ...Object.values(dependencies));
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
    createFlashcard: async () => {
      writes++;
    },
    previewFlashcards: async (input) => {
      requested = input;
      return {
        revision: 3,
        cards: [
          {
            front: '<img src=x onerror=alert(1)>',
            back: 'Resposta para conferir',
            evidence: 'Trecho literal da aula.',
          },
        ],
      };
    },
  });
  try {
    const form = ui.document.querySelector('.flashcard-generator form');
    form.querySelector('select').value = 'lesson-a';
    form.dispatchEvent(
      new ui.document.defaultView.Event('submit', { bubbles: true, cancelable: true }),
    );
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
  } finally {
    ui.close();
  }
});

test('AI preview blocks an unconfirmed lesson and leaves a retryable error', async () => {
  let previews = 0;
  const ui = await harness({
    getFlashcardSource: async () => ({ review: { state: 'awaiting_review' } }),
    previewFlashcards: async () => {
      previews++;
    },
  });
  try {
    const form = ui.document.querySelector('.flashcard-generator form');
    form.querySelector('select').value = 'lesson-a';
    form.dispatchEvent(
      new ui.document.defaultView.Event('submit', { bubbles: true, cancelable: true }),
    );
    await until(() =>
      /confirme/.test(
        ui.document.querySelector('.flashcard-generator [role="status"]').textContent,
      ),
    );
    assert.equal(previews, 0);
    assert.equal(form.querySelector('button').disabled, false);
    assert.equal(ui.document.querySelector('.flashcard-draft'), null);
  } finally {
    ui.close();
  }
});

test('provider failure unlocks AI preview and preserves the manual creation form', async () => {
  const ui = await harness({
    previewFlashcards: async () => {
      throw new Error('Provedor indisponível');
    },
  });
  try {
    const createFront = ui.document.querySelector('[data-flashcard-create-form] [name="front"]');
    createFront.value = 'Meu cartão';
    const form = ui.document.querySelector('.flashcard-generator form');
    form.querySelector('select').value = 'lesson-a';
    form.dispatchEvent(
      new ui.document.defaultView.Event('submit', { bubbles: true, cancelable: true }),
    );
    await until(() =>
      /Provedor indisponível/.test(
        ui.document.querySelector('.flashcard-generator [role="status"]').textContent,
      ),
    );
    assert.equal(form.querySelector('button').disabled, false);
    assert.equal(createFront.value, 'Meu cartão');
  } finally {
    ui.close();
  }
});

test('manager reaches card 101 and resets pagination when filtering by lesson or archive status', async () => {
  const calls = [];
  const ui = await harness({
    async listFlashcards(filter, options) {
      calls.push({ filter, ...options });
      if (filter === 'due') return { cards: [], total: 0, limit: 100 };
      const total = options.materialId || options.status === 'archived' ? 1 : 101;
      const start = options.offset || 0;
      return {
        cards: Array.from({ length: Math.min(100, total - start) }, (_, i) =>
          sampleCard(`card-${start + i + 1}`),
        ),
        total,
        limit: 100,
        offset: start,
      };
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
    // The lesson filter sits above the review; which cards the manager lists sits in the manager.
    const lesson = ui.document.querySelector('.flashcard-filters select');
    const status = ui.document.querySelector('.flashcard-manage-status-filter select');
    assert(status.closest('[data-flashcard-manage-form]'), 'the archive filter belongs to the manager');
    ui.change(lesson, 'lesson-a');
    await until(() => !lesson.disabled);
    assert.equal(select.options[1].value, 'card-1');
    assert(calls.some((call) => call.filter === 'due' && call.materialId === 'lesson-a'));
    assert.equal(calls.at(-1).offset, 0);
    ui.change(status, 'archived');
    await until(() => !status.disabled);
    assert.equal(calls.at(-1).status, 'archived');
    assert.match(nav.textContent, /1–1 de 1/);
  } finally {
    ui.close();
  }
});

test('late history responses cannot replace the selected card', async () => {
  let resolveFirst;
  const ui = await harness({
    async listFlashcards(filter) {
      return {
        cards: filter === 'all' ? [sampleCard('one'), sampleCard('two')] : [],
        total: filter === 'all' ? 2 : 0,
        limit: 100,
      };
    },
    listFlashcardReviews(id) {
      if (id === 'one')
        return new Promise((done) => {
          resolveFirst = done;
        });
      return Promise.resolve([
        { reviewed_at: '2026-11-05T12:00:00Z', rating: 3, due_at: '2026-11-06T12:00:00Z' },
      ]);
    },
  });
  try {
    const select = ui.document.querySelector('[name="cardId"]');
    ui.change(select, 'one');
    ui.change(select, 'two');
    const history = ui.document.querySelector('.flashcard-history');
    await until(() => history.textContent.includes('Fácil'));
    resolveFirst([
      { reviewed_at: '2026-11-05T12:00:00Z', rating: 0, due_at: '2026-11-05T12:10:00Z' },
    ]);
    await new Promise((done) => setImmediate(done));
    assert.match(history.textContent, /Fácil/);
    assert.doesNotMatch(history.textContent, /De novo/);
    ui.change(select, '');
    assert.equal(history.textContent, '');
  } finally {
    ui.close();
  }
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
    area.querySelector('.flashcard-flip').click();
    area.querySelectorAll('.flashcard-rating-buttons button')[2].click();
    await until(() =>
      ui.document
        .querySelector('[data-flashcard-review-status]')
        .textContent.includes('lista não pôde'),
    );
    assert.equal(writes, 1);
    assert.equal(area.querySelector('button'), null);
    assert.doesNotMatch(
      ui.document.querySelector('[data-flashcard-review-status]').textContent,
      /Repita/,
    );
  } finally {
    ui.close();
  }
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
    area.querySelector('.flashcard-flip').click();
    area.querySelectorAll('.flashcard-rating-buttons button')[2].click();
    await until(() => status.textContent.includes('Repita'));
    assert(
      [...ui.document.querySelectorAll('.flashcard-filters select')].every(
        (select) => select.disabled,
      ),
    );
    assert(ui.document.querySelector('[data-flashcard-create-form] button').disabled);
    const buttons = area.querySelectorAll('.flashcard-rating-buttons button');
    assert(buttons[0].disabled);
    assert(!buttons[2].disabled);
    buttons[2].click();
    await until(() => status.textContent.includes('Revisão registrada.'));
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    await until(() => !ui.document.querySelector('.flashcard-filters select').disabled);
  } finally {
    ui.close();
  }
});

test('Flashcards 2.0: set filter, manual card into a set and confirmed card deletion', async () => {
  const listed = [],
    added = [],
    deleted = [];
  let confirmations = 0;
  const ui = await harness({
    isFeatureEnabled: async () => true,
    initFlashcardSetsPanel: () => ({ load: async () => [{ id: 'set-1', name: 'Conjunto A' }] }),
    listFlashcards: async (filter, options) => {
      listed.push({ filter, ...options });
      return { cards: [sampleCard('c1')], total: 1, limit: 100, offset: 0 };
    },
    addFlashcardSetCards: async (setId, cards) => {
      added.push({ setId, cards });
      return { added: 1 };
    },
    deleteFlashcard: async (id) => {
      deleted.push(id);
    },
    confirm: () => {
      confirmations++;
      return confirmations > 1;
    },
  });
  try {
    const setFilter = [...ui.document.querySelectorAll('.flashcard-filters select')].at(-1);
    assert.deepEqual(
      [...setFilter.options].map((o) => o.textContent),
      ['Todos os conjuntos', 'Conjunto A'],
    );
    ui.change(setFilter, 'set-1');
    await until(() => listed.some((call) => call.setId === 'set-1'));
    const create = ui.document.querySelector('[data-flashcard-create-form]');
    await until(() => !create.querySelector('[type="submit"]').disabled);
    create.querySelector('[name="front"]').value = 'Frente manual';
    create.querySelector('[name="back"]').value = 'Verso manual';
    create.querySelector('[name="setId"]').value = 'set-1';
    create.dispatchEvent(
      new ui.document.defaultView.Event('submit', { bubbles: true, cancelable: true }),
    );
    await until(() => added.length === 1);
    assert.deepEqual(added[0], {
      setId: 'set-1',
      cards: [{ front: 'Frente manual', back: 'Verso manual' }],
    });
    const manager = ui.document.querySelector('[data-flashcard-manage-form]');
    await until(
      () =>
        !manager.querySelector('[name="cardId"]').disabled &&
        manager.querySelector('[name="cardId"] option[value="c1"]'),
    );
    ui.change(manager.querySelector('[name="cardId"]'), 'c1');
    const remove = [...manager.querySelectorAll('button')].find(
      (b) => b.textContent === 'Excluir cartão',
    );
    remove.click();
    assert.equal(deleted.length, 0, 'cancelled confirmation deletes nothing');
    remove.click();
    await until(() => deleted.length === 1);
    assert.deepEqual(deleted, ['c1']);
  } finally {
    ui.close();
  }
});

test('card templates are appearance only: chosen per account and per set, never content', () => {
  assert.equal(templateFor({}), 'classic');
  assert.equal(templateFor({ preferences: { cardTemplate: 'notebook' } }), 'notebook');
  assert.equal(
    templateFor({
      setId: 's1',
      preferences: { cardTemplate: 'notebook', setTemplates: { s1: 'polaroid' } },
    }),
    'polaroid',
  );
  assert.equal(
    templateFor({ setId: 's2', preferences: { cardTemplate: 'bogus', setTemplates: { s2: 'x' } } }),
    'classic',
  );
  assert.equal(new Set(CARD_TEMPLATES.map(([key]) => key)).size, CARD_TEMPLATES.length);
  // The panel sets only a data attribute: no request, no change to the card's text.
  assert.match(code, /article\.dataset\.cardTemplate = templateFor/);
  assert.doesNotMatch(
    code.split('Aparência (Flashcards 3.0)')[1].split('fillSetOptions')[0],
    /createFlashcard|updateFlashcard|previewFlashcards/,
  );
});

test('the card turns over with a click or tap on it; ratings stay out of the way', async () => {
  const reviews = [];
  const ui = await harness({
    listFlashcards: async (filter) =>
      filter === 'due' ? { cards: [sampleCard('one')], total: 1, limit: 100 } : { cards: [], total: 0, limit: 100 },
    reviewFlashcard: async (id, rating) => {
      reviews.push({ id, rating });
      return { dueAt: '2026-11-06T12:00:00Z' };
    },
  });
  try {
    const area = ui.document.querySelector('[data-flashcard-due-area]');
    const side = ui.document.querySelector('[data-flashcard-side-status]');
    const card = () => area.querySelector('.flashcard-review-card');
    const face = () => area.querySelector('.flashcard-face');
    // Front: labelled, the question, a visible turn key, no ratings yet.
    assert.equal(card().dataset.side, 'front');
    assert.equal(face().getAttribute('aria-label'), 'Frente do cartão');
    assert.equal(face().querySelector('.flashcard-side-label').textContent, 'Frente');
    assert.match(face().textContent, /Pergunta one/);
    assert.doesNotMatch(face().textContent, /Resposta/);
    assert.equal(area.querySelector('.flashcard-flip').getAttribute('aria-pressed'), 'false');
    assert.equal(area.querySelector('.flashcard-rating-buttons'), null);
    // A click anywhere on the face turns it: the back is labelled and announced.
    face().querySelector('.flashcard-content').click();
    assert.equal(card().dataset.side, 'back');
    assert.equal(card().dataset.turning, 'true', 'the turn is animated (CSS drops it with reduced motion)');
    assert.equal(face().getAttribute('aria-label'), 'Verso do cartão');
    assert.equal(face().querySelector('.flashcard-side-label').textContent, 'Verso');
    assert.match(face().querySelector('.flashcard-answer').textContent, /Resposta/);
    assert.equal(area.querySelector('.flashcard-flip').getAttribute('aria-pressed'), 'true');
    assert.equal(side.textContent, 'Verso do cartão');
    // The ratings are not inside the part that turns: rating never turns the card.
    const rate = area.querySelector('.flashcard-rate');
    assert(rate && !face().contains(rate) && !card().contains(rate));
    assert.deepEqual(
      [...rate.querySelectorAll('button .flashcard-rating-label')].map((n) => n.textContent),
      ['De novo', 'Difícil', 'Bom', 'Fácil'],
    );
    // Turning back to the front keeps the ratings (the back was seen).
    face().click();
    assert.equal(card().dataset.side, 'front');
    assert.equal(side.textContent, 'Frente do cartão');
    assert(area.querySelector('.flashcard-rating-buttons'));
    area.querySelector('.flashcard-rating-buttons [data-rating="2"]').click();
    await until(() => reviews.length === 1);
    assert.deepEqual(reviews, [{ id: 'one', rating: 2 }]);
  } finally {
    ui.close();
  }
});

test('keyboard: Space or Enter on the focused card turns it; the button works too', async () => {
  const ui = await harness({
    listFlashcards: async (filter) =>
      filter === 'due' ? { cards: [sampleCard('one')], total: 1, limit: 100 } : { cards: [], total: 0, limit: 100 },
  });
  try {
    const view = ui.document.defaultView;
    const area = ui.document.querySelector('[data-flashcard-due-area]');
    const face = () => area.querySelector('.flashcard-face');
    assert.equal(face().tabIndex, 0, 'the card itself takes focus');
    assert.equal(face().getAttribute('aria-describedby'), 'flashcard-turn-hint');
    assert.match(ui.document.getElementById('flashcard-turn-hint').textContent, /Espaço ou Enter/);
    face().focus();
    const space = new view.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    face().dispatchEvent(space);
    assert.equal(space.defaultPrevented, true, 'Space does not scroll the page');
    assert.equal(area.querySelector('.flashcard-review-card').dataset.side, 'back');
    assert.equal(ui.document.activeElement, face(), 'focus stays on the card after it turns');
    face().dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(area.querySelector('.flashcard-review-card').dataset.side, 'front');
    // Other keys do nothing; the visible button turns it and keeps focus on itself.
    face().dispatchEvent(new view.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    assert.equal(area.querySelector('.flashcard-review-card').dataset.side, 'front');
    area.querySelector('.flashcard-flip').focus();
    area.querySelector('.flashcard-flip').click();
    assert.equal(area.querySelector('.flashcard-review-card').dataset.side, 'back');
    assert(ui.document.activeElement.classList.contains('flashcard-flip'));
  } finally {
    ui.close();
  }
});

test('saving a card shows a brief toast; nothing stays written in the form', async () => {
  const toasts = [];
  const created = [];
  const ui = await harness({
    createFlashcard: async (input) => {
      created.push(input);
    },
    toast: (text, options) => toasts.push({ text, type: options?.type, action: options?.action?.label }),
  });
  try {
    const form = ui.document.querySelector('[data-flashcard-create-form]');
    await until(() => !form.querySelector('[type="submit"]').disabled);
    form.querySelector('[name="front"]').value = 'Frente';
    form.querySelector('[name="back"]').value = 'Verso';
    form.querySelector('[name="materialId"]').value = 'lesson-a';
    form.dispatchEvent(new ui.document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => toasts.length === 1);
    assert.deepEqual(created, [{ front: 'Frente', back: 'Verso', materialId: 'lesson-a' }]);
    assert.deepEqual(toasts, [{ text: 'Cartão salvo. Ele já entra na revisão.', type: 'success', action: 'Revisar agora' }]);
    assert.equal(ui.document.querySelector('[data-flashcard-create-status]').textContent, '');
    assert.equal(form.querySelector('[name="front"]').value, '', 'ready for the next card');
    assert.equal(form.querySelector('[name="materialId"]').value, 'lesson-a', 'the lesson stays chosen');
  } finally {
    ui.close();
  }
});

test('the Flashcards page: six sections, the review first, no dialogs for creating', () => {
  const { document } = new JSDOM(html).window;
  assert.deepEqual(
    [...document.querySelectorAll('[data-tool-tabs] [role="tab"]')].map((tab) => tab.textContent.trim()),
    ['Revisar cartões', 'Conjuntos', 'Criar cartão', 'Gerar com IA', 'Importar e mesclar', 'Aparência'],
  );
  for (const tab of document.querySelectorAll('[data-tool-tabs] [role="tab"]'))
    assert(document.getElementById(tab.getAttribute('aria-controls')), tab.id);
  assert.equal(document.querySelectorAll('dialog').length, 0);
  assert.equal(document.querySelector('.primary-navigation a[aria-current="page"]').getAttribute('href'), './flashcards.html');
  assert.match(document.querySelector('.primary-navigation a[aria-current="page"]').textContent, /Flashcards/);
  assert.match(dashboard, /FLASHCARD_SECTIONS = \['revisar', 'conjuntos', 'criar', 'gerar', 'importar', 'aparencia'\]/);
});

test('old Revisar addresses land where each part lives now', async () => {
  const { reviewRedirectTarget } = await import('../js/utils/review-redirect.js');
  assert.equal(reviewRedirectTarget('', ''), './flashcards.html#revisar');
  assert.equal(reviewRedirectTarget('', '#flashcards'), './flashcards.html#revisar');
  assert.equal(reviewRedirectTarget('?acao=revisar', '#flashcards'), './flashcards.html#revisar');
  assert.equal(reviewRedirectTarget('?acao=criar', '#flashcards'), './flashcards.html#criar');
  // A lesson's "Revisar agora" and the multi-lesson export keep the set.
  assert.equal(reviewRedirectTarget('?conjunto=set-1', '#flashcards'), './flashcards.html?conjunto=set-1#revisar');
  assert.equal(reviewRedirectTarget('?conjunto=a%26b', ''), './flashcards.html?conjunto=a%26b#revisar');
  // Question attempts live with the questions; notes in the global search.
  assert.equal(reviewRedirectTarget('', '#questoes'), './questoes.html');
  assert.equal(reviewRedirectTarget('', '#anotacoes'), './painel.html?em=notes');
  assert.equal(reviewRedirectTarget('?busca=clorofila', '#anotacoes'), './painel.html?busca=clorofila&em=notes');
  assert.equal(reviewRedirectTarget('?busca=a', '#anotacoes'), './painel.html?em=notes', 'too short to search');
  assert.equal(reviewRedirectTarget('', '#inexistente'), './flashcards.html#revisar');
  const page = readFileSync(resolve(frontend, 'pages/revisar.html'), 'utf8');
  assert.match(page, /review-redirect\.page\.js/);
  assert.match(page, /<noscript><meta http-equiv="refresh" content="0; url=\.\/flashcards\.html"><\/noscript>/);
  assert.match(page, /data-review-redirect/);
});
