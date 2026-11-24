import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOUR_STEPS,
  TOUR_KEY,
  TOUR_VERSION,
  availableSteps,
  shouldOfferTour,
  tourRecord,
  createTourStore,
  placePopover,
} from '../js/utils/guided-tour.js';
import { filterTopics, normalizeSearch } from '../js/utils/help-filter.js';
import { accessMethods, passwordErrorMessage } from '../js/pages/password-dialog.js';

// A fake page: selector → element (or absent = hidden / missing).
const finder = (present) => (selector) =>
  present.includes(selector) ? { selector, textContent: ' Flashcards ' } : null;
const sidebar = (href) => `.side-navigation a[href="${href}"]`;
const desktop = [
  sidebar('./nova-transcricao.html'),
  sidebar('./painel.html'),
  sidebar('./historico.html'),
  sidebar('./revisar.html'),
  sidebar('./planejar.html'),
  sidebar('./focar.html'),
  '.menu-toggle',
  '.topbar-search',
  '[data-dashboard-customize]',
  '.sidebar-settings a[href="./configuracoes.html"]',
];

test('steps: desktop shows every target and skips the phone-only menu step', () => {
  const ids = availableSteps(TOUR_STEPS, finder(desktop)).map((step) => step.id);
  assert.deepEqual(ids, [
    'create',
    'home',
    'library',
    'review',
    'plan',
    'focus',
    'search',
    'customize',
    'settings',
  ]);
});

test('steps: a missing or hidden target (feature off) is skipped', () => {
  const present = desktop.filter(
    (s) => !s.includes('planejar') && !s.includes('focar') && s !== '[data-dashboard-customize]',
  );
  const ids = availableSteps(TOUR_STEPS, finder(present)).map((step) => step.id);
  assert(!ids.includes('plan') && !ids.includes('focus') && !ids.includes('customize'), ids.join());
  assert.equal(ids[0], 'create');
});

test('steps: phone layout (drawer closed) uses the menu button instead of the sidebar', () => {
  const ids = availableSteps(TOUR_STEPS, finder(['.menu-toggle', '.topbar-search'])).map(
    (s) => s.id,
  );
  assert.deepEqual(ids, ['menu', 'search']);
});

test('steps: the review title follows the menu label (Revisar may become Flashcards)', () => {
  const present = [sidebar('./flashcards.html')];
  const [step] = availableSteps(TOUR_STEPS, finder(present));
  assert.equal(step.id, 'review');
  assert.equal(step.title, 'Flashcards');
  assert.equal(step.target.selector, sidebar('./flashcards.html'));
});

test('steps: nothing to show gives an empty list', () => {
  assert.deepEqual(
    availableSteps(TOUR_STEPS, () => null),
    [],
  );
});

test('offer: only new accounts, never after done or dismissed', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  const fresh = { created_at: '2026-11-20T12:00:00Z' };
  assert.equal(shouldOfferTour({ record: null, user: fresh, now }), true);
  assert.equal(shouldOfferTour({ record: { status: 'dismissed' }, user: fresh, now }), false);
  assert.equal(shouldOfferTour({ record: { status: 'done' }, user: fresh, now }), false);
  assert.equal(
    shouldOfferTour({ record: null, user: { created_at: '2026-01-01T00:00:00Z' }, now }),
    false,
  );
  assert.equal(
    shouldOfferTour({ record: null, user: {}, now }),
    false,
    'no creation date: not new',
  );
  assert.equal(shouldOfferTour({ record: null, user: null, now }), false);
});

test('persistence: records go to the account key and are read back', async () => {
  const saved = new Map();
  const cloud = {
    cachedCloudState: (owner, key) => saved.get(`${owner}:${key}`) ?? null,
    loadCloudState: async (owner, key) => saved.get(`${owner}:${key}`) ?? null,
    saveCloudState: async (owner, key, data) => {
      saved.set(`${owner}:${key}`, data);
      return true;
    },
  };
  const store = createTourStore('user-1', cloud);
  assert.equal(store.cached(), null);
  await store.save('dismissed');
  const record = saved.get(`user-1:${TOUR_KEY}`);
  assert.equal(record.status, 'dismissed');
  assert.equal(record.version, TOUR_VERSION);
  assert.ok(Date.parse(record.at));
  assert.deepEqual(await store.load(), record);
  assert.deepEqual(createTourStore('user-2', cloud).cached(), null, 'per account');
  // A failing network never throws out of the store.
  const broken = createTourStore('user-3', {
    ...cloud,
    loadCloudState: async () => {
      throw new Error('offline');
    },
    saveCloudState: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(await broken.load(), null);
  assert.equal(await broken.save('done'), false);
  assert.equal(createTourStore(null, cloud).cached(), null, 'no account, nothing stored');
});

test('tourRecord has a stable shape', () => {
  assert.deepEqual(tourRecord('done', new Date('2026-11-23T00:00:00Z')), {
    status: 'done',
    version: TOUR_VERSION,
    at: '2026-11-23T00:00:00.000Z',
  });
});

test('popover placement: beside on desktop, below or above on phones, inside the screen', () => {
  const size = { width: 340, height: 220 };
  const side = placePopover(
    { left: 10, right: 230, top: 80, bottom: 120, width: 220, height: 40 },
    size,
    { width: 1440, height: 900 },
  );
  assert.equal(side.side, 'right');
  assert.equal(side.left, 244);
  const below = placePopover(
    { left: 10, right: 50, top: 10, bottom: 50, width: 40, height: 40 },
    size,
    { width: 390, height: 844 },
  );
  assert.equal(below.side, 'below');
  assert(below.left >= 12 && below.left + 340 <= 390 - 12 + 0.5);
  const above = placePopover(
    { left: 300, right: 380, top: 780, bottom: 830, width: 80, height: 50 },
    size,
    { width: 390, height: 844 },
  );
  assert.equal(above.side, 'above');
  assert(above.top >= 12);
});

test('help filter: accents and case ignored, every word must match', () => {
  const topics = [
    { id: 'a', text: 'Conferir e confirmar a transcrição' },
    { id: 'b', text: 'Flashcards e revisão' },
  ];
  assert.equal(normalizeSearch('  Sessão  ÚNICA '), 'sessao unica');
  assert.deepEqual(filterTopics(topics, 'transcricao'), ['a']);
  assert.deepEqual(filterTopics(topics, 'REVISAO flash'), ['b']);
  assert.deepEqual(filterTopics(topics, 'flash transcricao'), []);
  assert.deepEqual(filterTopics(topics, '   '), ['a', 'b']);
});

test('password dialog helpers: access methods and readable errors', () => {
  assert.deepEqual(accessMethods({}), ['email']);
  assert.deepEqual(
    accessMethods({ identities: [{ provider: 'google' }, { provider: 'google' }] }),
    ['google'],
  );
  assert.deepEqual(accessMethods({ app_metadata: { provider: 'github' } }), ['github']);
  assert.match(passwordErrorMessage({ status: 429, message: 'x' }, 'link'), /Aguarde um minuto/);
  assert.match(passwordErrorMessage({ code: 'same_password' }, 'update'), /diferente da atual/);
  assert.match(
    passwordErrorMessage({ code: 'reauthentication_needed' }, 'update'),
    /link por e-mail/,
  );
  assert.match(
    passwordErrorMessage({ code: 'weak_password' }, 'update'),
    /requisitos de segurança/,
  );
  assert.match(passwordErrorMessage(new TypeError('Failed to fetch'), 'link'), /Sem conexão/);
  assert.match(passwordErrorMessage({ message: 'boom' }, 'link'), /enviar o link/);
});
