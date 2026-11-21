import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFocusSession,
  STALE_MS,
  HEARTBEAT_MS,
  normalizeSettings,
} from '../js/utils/focus-session.js';

/** One browser: shared storage and clock; each page/tab is a separate session object. */
function browser() {
  const map = new Map();
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  const clock = { t: 1_700_000_000_000 };
  const server = { sessions: [], ticks: [], fail: false };
  let n = 0;
  const api = {
    start: async (body) => {
      if (server.fail) throw Object.assign(new Error('offline'), { code: 'NETWORK' });
      if (server.sessions.some((s) => !s.ended))
        throw Object.assign(new Error('active'), { code: 'STUDY_SESSION_ACTIVE' });
      server.sessions.push({
        id: body.sessionId,
        kind: body.kind,
        materialId: body.materialId,
        ended: false,
        seq: 0,
      });
      return { id: body.sessionId, last_sequence: 0 };
    },
    tick: async (id, wire) => {
      if (server.fail) throw Object.assign(new Error('offline'), { code: 'NETWORK' });
      const s = server.sessions.find((x) => x.id === id);
      server.ticks.push({ id, ...wire });
      if (wire.sequence === s.seq)
        return { id, last_sequence: s.seq, ended_at: s.ended ? 'x' : null }; // idempotent repeat
      assert.equal(wire.sequence, s.seq + 1, 'sequences are consecutive');
      s.seq = wire.sequence;
      if (wire.close) s.ended = true;
      return { id, last_sequence: s.seq, ended_at: s.ended ? 'x' : null };
    },
  };
  const page = (opts = {}) =>
    createFocusSession({
      api,
      storage,
      key: 'voz-focus-v1:user-a',
      now: () => clock.t,
      uuid: () => `id-${++n}`,
      isVisible: opts.visible || (() => true),
    });
  const advance = async (ms, pages, step = 1000) => {
    for (let done = 0; done < ms; done += step) {
      clock.t += step;
      for (const p of pages) await p.pump();
    }
  };
  return { storage, clock, server, page, advance };
}

test('settings are clamped and defaults fill the gaps', () => {
  assert.deepEqual(normalizeSettings({ focus: 500, short: 0, longEvery: 'x' }), {
    focus: 120,
    short: 1,
    long: 15,
    longEvery: 4,
    autoStart: false,
    sound: true,
  });
});

test('one session survives navigation and reload: the next page continues the same countdown', async () => {
  const b = browser();
  const planejar = b.page();
  await planejar.start({ mode: 'pomodoro' });
  await b.advance(60_000, [planejar]);
  assert.equal(Math.round(planejar.state().remaining), 1500 - 60);
  planejar.handOff(); // pagehide
  b.clock.t += 1500; // the next page loads
  const biblioteca = b.page();
  assert.equal(biblioteca.state().status, 'running');
  await b.advance(30_000, [biblioteca]);
  assert(
    Math.abs(biblioteca.state().remaining - (1500 - 60 - 1.5 - 30)) < 0.01,
    'the countdown continues, including the load gap',
  );
  // One server session across both pages, with consecutive heartbeats.
  assert.equal(b.server.sessions.length, 1);
  assert(b.server.ticks.length >= 5);
  assert(b.server.ticks.every((t) => t.active && !t.close));
});

test('a tick lost when the page unloads is resent by the next page, not duplicated', async () => {
  const b = browser();
  const first = b.page();
  await first.start({ mode: 'pomodoro' });
  b.server.fail = true;
  await b.advance(HEARTBEAT_MS + 1000, [first]); // heartbeat queued but not confirmed
  const pending = JSON.parse(b.storage.getItem('voz-focus-v1:user-a')).server.pending;
  assert.equal(pending.sequence, 1);
  assert.match(first.state().error, /offline/);
  b.server.fail = false;
  first.handOff();
  const second = b.page();
  await b.advance(1000, [second]);
  const state = JSON.parse(b.storage.getItem('voz-focus-v1:user-a'));
  assert.equal(state.server.pending, null);
  assert.equal(b.server.sessions[0].seq, 1, 'the same tick, delivered once');
});

test('two tabs: only the visible leader sends heartbeats; the other takes over when it leaves', async () => {
  const b = browser();
  let aVisible = true;
  const a = b.page({ visible: () => aVisible });
  const c = b.page();
  await a.start({ mode: 'reading' });
  await b.advance(40_000, [a, c]);
  const leaders = new Set(
    b.server.ticks.map(() => JSON.parse(b.storage.getItem('voz-focus-v1:user-a')).leader),
  );
  assert.equal(leaders.size, 1);
  assert.equal(a.state().isLeader, true);
  aVisible = false;
  await b.advance(10_000, [a, c]);
  assert.equal(c.state().isLeader, true, 'the visible tab continues the session');
  assert.equal(c.state().status, 'running');
  assert.equal(b.server.sessions.length, 1);
  assert(Math.round(c.state().elapsed) >= 49, 'free study counts up');
});

test('when every page is hidden or closed, the run stops near the last confirmation; no minutes are invented', async () => {
  const b = browser();
  let visible = true;
  const p = b.page({ visible: () => visible });
  await p.start({ mode: 'pomodoro' });
  await b.advance(120_000, [p]);
  visible = false;
  await b.advance(5 * 60_000, [p], 5000);
  const state = p.state();
  assert.equal(state.status, 'paused');
  assert.equal(state.notice.kind, 'stopped_away');
  assert(state.elapsed <= 120 + STALE_MS / 1000 + 1, `elapsed ${state.elapsed}`);
  const last = b.server.ticks.at(-1);
  assert.equal(last.close, true);
  assert.equal(last.active, false, 'the hidden gap is not credited');
  // Resuming opens a new server session.
  visible = true;
  await p.resume();
  assert.equal(b.server.sessions.length, 2);
});

test('a finished focus block counts a cycle, credits the end and suggests the right break', async () => {
  const b = browser();
  const p = b.page();
  p.updateSettings({ focus: 5, short: 1, long: 5, longEvery: 2 });
  await p.start({ mode: 'pomodoro' });
  await b.advance(5 * 60_000 + 1000, [p]);
  let s = p.state();
  assert.equal(s.status, 'idle');
  assert.equal(s.mode, 'short');
  assert.equal(s.cycle, 1);
  assert.equal(s.history[0].mode, 'pomodoro');
  assert.equal(s.notice.kind, 'pomodoro_done');
  assert.equal(b.server.ticks.at(-1).close, true);
  assert.equal(b.server.ticks.at(-1).active, true);
  await p.start(); // short break: never sent to the server
  const sessions = b.server.sessions.length;
  await b.advance(60_000 + 1000, [p]);
  assert.equal(b.server.sessions.length, sessions);
  await p.start({ mode: 'pomodoro' });
  await b.advance(5 * 60_000 + 1000, [p]);
  s = p.state();
  assert.equal(s.mode, 'long', 'a long break after longEvery focus blocks');
  assert.equal(s.completedToday, 2);
});

test('auto-start chains the next block; pause and stop close the server session once', async () => {
  const b = browser();
  const p = b.page();
  p.updateSettings({ focus: 5, short: 1, autoStart: true });
  await p.start({ mode: 'pomodoro', materialId: 'lesson-1' });
  assert.equal(b.server.sessions[0].materialId, 'lesson-1');
  await b.advance(5 * 60_000 + 1000, [p]);
  assert.equal(p.state().status, 'running');
  assert.equal(p.state().mode, 'short');
  await p.stop();
  await p.start({ mode: 'pomodoro' });
  await b.advance(20_000, [p]);
  await p.pause();
  assert.equal(p.state().status, 'paused');
  const closes = b.server.ticks.filter((t) => t.close);
  assert.equal(closes.length, 2);
  assert(b.server.sessions.every((s) => s.ended));
});

test('another device holding the account session: the timer runs but says time is not credited', async () => {
  const b = browser();
  b.server.sessions.push({ id: 'elsewhere', ended: false, seq: 0 });
  const p = b.page();
  await p.start({ mode: 'pomodoro' });
  assert.equal(p.state().status, 'running');
  assert.match(p.state().error, /outro aparelho/);
});
