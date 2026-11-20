import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser globals used by profile-cloud.js.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  key: (index) => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  },
};
// Object.keys(localStorage) in retryCloudState: expose stored keys as own properties.
globalThis.localStorage = new Proxy(globalThis.localStorage, {
  ownKeys: () => [...store.keys()],
  getOwnPropertyDescriptor: (target, key) =>
    store.has(key) ? { enumerable: true, configurable: true, value: store.get(key) } : undefined,
});
const events = [];
globalThis.window = {
  dispatchEvent: (event) => events.push(event.detail),
  addEventListener() {},
  removeEventListener() {},
};
globalThis.CustomEvent ??= class {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};

const cloud = await import('../js/utils/profile-cloud.js');
const { mergeStudyHistory } = await import('../js/utils/profile-study-sync.js');
const { mergeMilestoneStates } = await import('../js/utils/gamification.js');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * In-memory profile_state with the production RLS rule (user_id = auth.uid()) and PostgREST-like
 * builders for the calls profile-cloud.js makes.
 */
function fakeServer() {
  const rows = new Map();
  const state = { offline: false, writes: 0, beforeUpdate: null };
  const id = (user, key) => `${user}:${key}`;
  function clientFor(uid) {
    const from = () => {
      const filters = {};
      const guard = () => {
        if (state.offline) throw new TypeError('NetworkError when attempting to fetch resource.');
      };
      const visible = () =>
        [...rows.entries()]
          .filter(([, row]) => row.user_id === uid)
          .filter(([, row]) =>
            Object.entries(filters).every(([col, val]) => String(row[col]) === String(val)),
          );
      const builder = {
        select() {
          return builder;
        },
        eq(col, val) {
          filters[col] = val;
          return builder;
        },
        async maybeSingle() {
          guard();
          const found = visible();
          return {
            data: found[0]
              ? { data: structuredClone(found[0][1].data), updated_at: found[0][1].updated_at }
              : null,
            error: null,
          };
        },
        async insert(row) {
          guard();
          if (row.user_id !== uid) return { error: { code: '42501', message: 'RLS' } };
          if (rows.has(id(row.user_id, row.key))) return { error: { code: '23505' } };
          rows.set(id(row.user_id, row.key), { ...structuredClone(row) });
          state.writes += 1;
          return { error: null };
        },
        update(patch) {
          const chain = {
            eq(col, val) {
              filters[col] = val;
              return chain;
            },
            async select() {
              guard();
              await state.beforeUpdate?.();
              state.beforeUpdate = null;
              const hit = visible();
              for (const [, row] of hit) Object.assign(row, structuredClone(patch));
              state.writes += hit.length;
              return { data: hit.map(([, row]) => ({ updated_at: row.updated_at })), error: null };
            },
          };
          return chain;
        },
      };
      return builder;
    };
    return { from };
  }
  return { rows, state, clientFor, id };
}

function useServer(server, uid) {
  cloud.configureProfileCloud({ getClient: async () => server.clientFor(uid) });
}

test.beforeEach(() => {
  store.clear();
  events.length = 0;
});

test('cross-account: a signed-in user cannot read or write another account', async () => {
  const server = fakeServer();
  server.rows.set(server.id(B, 'preferences'), {
    user_id: B,
    key: 'preferences',
    data: { theme: 'b' },
    updated_at: '2026-11-20T10:00:00.000Z',
  });
  useServer(server, A);
  // Asking for B's key while signed in as A sees nothing and cannot create it under B.
  assert.equal(await cloud.loadCloudState(B, 'preferences', null), null);
  assert.equal(await cloud.saveCloudState(B, 'preferences', { theme: 'evil' }), false);
  assert.deepEqual(server.rows.get(server.id(B, 'preferences')).data, { theme: 'b' });
  assert.equal(
    JSON.parse(store.get(`voz-cloud-v1:${B}:preferences`)).pending,
    true,
    'kept only locally, never sent as B',
  );
});

test('an older offline edit does not overwrite a newer edit from another device', async () => {
  const server = fakeServer();
  useServer(server, A);
  // Device 1 edits while offline at 10:00.
  server.state.offline = true;
  assert.equal(await cloud.saveCloudState(A, 'profile-blocks', ['old']), false);
  const pending = JSON.parse(store.get(`voz-cloud-v1:${A}:profile-blocks`));
  pending.editedAt = '2026-11-20T10:00:00.000Z';
  store.set(`voz-cloud-v1:${A}:profile-blocks`, JSON.stringify(pending));
  // Device 2 saved a newer version at 11:00.
  server.rows.set(server.id(A, 'profile-blocks'), {
    user_id: A,
    key: 'profile-blocks',
    data: ['new'],
    updated_at: '2026-11-20T11:00:00.000Z',
  });
  server.state.offline = false;
  assert.deepEqual(await cloud.loadCloudState(A, 'profile-blocks', []), ['new']);
  assert.deepEqual(server.rows.get(server.id(A, 'profile-blocks')).data, ['new']);
  assert.equal(JSON.parse(store.get(`voz-cloud-v1:${A}:profile-blocks`)).pending, false);
});

test('a newer local edit replaces an older account copy', async () => {
  const server = fakeServer();
  server.rows.set(server.id(A, 'profile-blocks'), {
    user_id: A,
    key: 'profile-blocks',
    data: ['old'],
    updated_at: '2020-01-01T00:00:00.000Z',
  });
  useServer(server, A);
  assert.equal(await cloud.saveCloudState(A, 'profile-blocks', ['mine']), true);
  assert.deepEqual(server.rows.get(server.id(A, 'profile-blocks')).data, ['mine']);
});

test('a concurrent write between read and update is detected and retried (compare-and-set)', async () => {
  const server = fakeServer();
  server.rows.set(server.id(A, 'study-history'), {
    user_id: A,
    key: 'study-history',
    data: { lessonX: { openedAt: 1 } },
    updated_at: '2026-11-20T09:00:00.000Z',
  });
  cloud.registerCloudMerge('study-history', mergeStudyHistory);
  useServer(server, A);
  // Another device adds lessonY right before our update lands.
  server.state.beforeUpdate = async () => {
    const row = server.rows.get(server.id(A, 'study-history'));
    row.data = { ...row.data, lessonY: { openedAt: 5 } };
    row.updated_at = '2026-11-20T09:30:00.000Z';
  };
  assert.equal(await cloud.saveCloudState(A, 'study-history', { lessonZ: { openedAt: 9 } }), true);
  assert.deepEqual(Object.keys(server.rows.get(server.id(A, 'study-history')).data).sort(), [
    'lessonX',
    'lessonY',
    'lessonZ',
  ]);
});

test('study history merge keeps lessons from both devices and the newer record per lesson', () => {
  const merged = mergeStudyHistory(
    { l1: { stateUpdatedAt: 5, position: 50, answers: { q1: 0 } }, l2: { openedAt: 3 } },
    { l1: { stateUpdatedAt: 9, position: 90, answers: { q2: 1 } }, l3: { openedAt: 4 } },
  );
  assert.deepEqual(Object.keys(merged).sort(), ['l1', 'l2', 'l3']);
  assert.equal(merged.l1.position, 90);
  assert.deepEqual(merged.l1.answers, { q1: 0, q2: 1 });
});

test('milestone merge: earliest unlock, highest metric, unknown ids ignored, XP recomputed', () => {
  const merged = mergeMilestoneStates(
    {
      best: { aulas: 3 },
      unlocked: {
        'first-class': '2026-11-02T00:00:00.000Z',
        'fake-badge': '2026-01-01T00:00:00.000Z',
      },
      xp: 99999,
    },
    {
      best: { aulas: 1, questoes: 12 },
      unlocked: {
        'first-class': '2026-11-01T00:00:00.000Z',
        'answer-1': '2026-11-03T00:00:00.000Z',
        'answer-10': 'not-a-date',
      },
    },
  );
  assert.equal(merged.best.aulas, 3);
  assert.equal(merged.best.questoes, 12);
  assert.deepEqual(Object.keys(merged.unlocked).sort(), ['answer-1', 'first-class']);
  assert.equal(merged.unlocked['first-class'], '2026-11-01T00:00:00.000Z');
  assert.equal(merged.xp, 35, 'XP comes from known milestones only, never from the stored number');
  assert.equal(merged.level, 1);
});

test('pending local edits survive failures and are retried when back online', async () => {
  const server = fakeServer();
  useServer(server, A);
  server.state.offline = true;
  assert.equal(await cloud.saveCloudState(A, 'preferences', { theme: 'night' }), false);
  assert.match(events.at(-1), /sincronização pendente/);
  server.state.offline = false;
  await cloud.retryCloudState(A);
  assert.deepEqual(server.rows.get(server.id(A, 'preferences')).data, { theme: 'night' });
  assert.equal(JSON.parse(store.get(`voz-cloud-v1:${A}:preferences`)).pending, false);
});

test('legacy pending caches without an edit time are still pushed, not lost', async () => {
  const server = fakeServer();
  useServer(server, A);
  store.set(
    `voz-cloud-v1:${A}:profile-blocks`,
    JSON.stringify({ data: ['legacy'], pending: true, token: 't' }),
  );
  assert.deepEqual(await cloud.loadCloudState(A, 'profile-blocks', []), ['legacy']);
  assert.deepEqual(server.rows.get(server.id(A, 'profile-blocks')).data, ['legacy']);
});

test("account switch on a shared browser: A's unsynced theme is parked for A, never written to B", async () => {
  const server = fakeServer();
  server.rows.set(server.id(B, 'preferences'), {
    user_id: B,
    key: 'preferences',
    data: { 'audioestudo-theme': 'forest' },
    updated_at: '2026-11-20T08:00:00.000Z',
  });
  const { initPreferenceCloud, PREFERENCES_OWNER_KEY } =
    await import('../js/utils/preference-cloud.js');
  const prefs = new Map([['audioestudo-theme', 'night']]);
  globalThis.window.VozAppearance = {
    syncedKeys: ['audioestudo-theme'],
    storage: { set: (key, value) => localStorage.setItem(key, value) },
  };
  // A changed the theme (dirty) and signed out; B signs in on the same browser.
  localStorage.setItem('audioestudo-theme', prefs.get('audioestudo-theme'));
  localStorage.setItem('voz-preferences-dirty', 'true');
  localStorage.setItem(PREFERENCES_OWNER_KEY, A);
  useServer(server, B);
  await initPreferenceCloud(B);
  assert.deepEqual(
    server.rows.get(server.id(B, 'preferences')).data,
    { 'audioestudo-theme': 'forest' },
    "B's account untouched",
  );
  assert.equal(localStorage.getItem('audioestudo-theme'), 'forest', "B sees B's theme");
  const parked = JSON.parse(store.get(`voz-cloud-v1:${A}:preferences`));
  assert.equal(parked.pending, true);
  assert.equal(parked.data['audioestudo-theme'], 'night', "A's change waits for A");
  assert.equal(localStorage.getItem(PREFERENCES_OWNER_KEY), B);
  // When A signs in again, the parked change reaches A's account.
  useServer(server, A);
  assert.equal((await cloud.loadCloudState(A, 'preferences', null))['audioestudo-theme'], 'night');
  assert.equal(server.rows.get(server.id(A, 'preferences')).data['audioestudo-theme'], 'night');
});

test("account switch: a new account with no saved preferences is not seeded with the previous account's", async () => {
  const server = fakeServer();
  const { initPreferenceCloud, PREFERENCES_OWNER_KEY } =
    await import('../js/utils/preference-cloud.js');
  globalThis.window.VozAppearance = {
    syncedKeys: ['audioestudo-theme'],
    storage: { set: (k, v) => localStorage.setItem(k, v) },
  };
  localStorage.setItem('audioestudo-theme', 'night');
  localStorage.setItem(PREFERENCES_OWNER_KEY, A);
  useServer(server, B);
  await initPreferenceCloud(B);
  assert.equal(server.rows.has(server.id(B, 'preferences')), false);
});
