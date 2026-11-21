// Focar 3.0 — one authoritative focus session per account, shown by several views (Focar page,
// Planejar, the side panel and the floating capsule on every page).
//
// The app is a set of separate HTML pages, so no in-memory timer survives navigation. The session
// lives in localStorage under the account's key and is derived from wall-clock timestamps:
// remaining time = planned − (time accumulated before this run + now − run start). Any page or tab
// reads the same record; changes from other tabs arrive through `storage` events.
//
// Study minutes are still credited only by the server (`study_sessions` ticks, server
// timestamps, at most 30 s per tick, gaps over 45 s end the session). One tab — the visible one
// that last acted, the "leader" — sends the heartbeat. A tick is written to storage before it is
// sent, so a page that unloads mid-request lets the next page resend the same tick, which the
// server accepts idempotently. Nothing here invents minutes: when every tab is hidden or closed the
// run stops at most STALE_MS after the last moment a page was seen, and the server closes its
// session (no credit for that gap).

export const FOCUS_VERSION = 1;
export const DEFAULT_SETTINGS = Object.freeze({
  focus: 25, // minutes
  short: 5,
  long: 15,
  longEvery: 4, // a long break after this many focus blocks
  autoStart: false, // start the next block when one ends
  sound: true,
});
export const MODES = ['pomodoro', 'short', 'long', 'reading'];
/** A page not seen for longer than this is gone: the run stops at the last time it was seen. */
export const STALE_MS = 20000;
/** Another tab may take over the heartbeat when the leader has been silent this long. */
export const LEADER_MS = 4000;
export const HEARTBEAT_MS = 15000;
const HISTORY_LIMIT = 60;

const clampInt = (value, min, max, fallback) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
export function normalizeSettings(input = {}) {
  return {
    focus: clampInt(input.focus, 5, 120, DEFAULT_SETTINGS.focus),
    short: clampInt(input.short, 1, 30, DEFAULT_SETTINGS.short),
    long: clampInt(input.long, 5, 60, DEFAULT_SETTINGS.long),
    longEvery: clampInt(input.longEvery, 2, 8, DEFAULT_SETTINGS.longEvery),
    autoStart: Boolean(input.autoStart ?? DEFAULT_SETTINGS.autoStart),
    sound: Boolean(input.sound ?? DEFAULT_SETTINGS.sound),
  };
}
export const plannedSeconds = (mode, settings) =>
  mode === 'reading' ? null : 60 * settings[mode === 'pomodoro' ? 'focus' : mode];
/** Breaks are not study time: they are never sent to the server. */
export const countsAsStudy = (mode) => mode === 'pomodoro' || mode === 'reading';

export function emptyState(settings = DEFAULT_SETTINGS) {
  const normalized = normalizeSettings(settings);
  return {
    v: FOCUS_VERSION,
    status: 'idle', // idle | running | paused
    mode: 'pomodoro',
    planned: plannedSeconds('pomodoro', normalized),
    accumulated: 0, // seconds of the current block counted before the current run
    runStart: null, // epoch ms of the current run
    lastSeen: null, // epoch ms a page last confirmed the run (running only)
    leader: null,
    materialId: null,
    server: null, // { id, sequence, pending: {sequence, active, close} | null, lastTickAt, kind }
    cycle: 0, // focus blocks completed since the last long break
    completedToday: 0,
    day: null,
    settings: normalized,
    history: [],
    notice: null, // { kind, at }: what just happened (block finished, stopped while away…)
    updatedAt: 0,
  };
}

function parse(raw, settings) {
  try {
    const value = JSON.parse(raw);
    if (!value || value.v !== FOCUS_VERSION || !MODES.includes(value.mode))
      return emptyState(settings);
    return { ...emptyState(value.settings), ...value, settings: normalizeSettings(value.settings) };
  } catch {
    return emptyState(settings);
  }
}

/** Seconds elapsed in the current block at `at` (never beyond the last time a page saw it). */
export function elapsedAt(state, at) {
  if (state.status !== 'running' || state.runStart === null) return state.accumulated;
  const end = Math.min(at, (state.lastSeen ?? at) + STALE_MS);
  return state.accumulated + Math.max(0, end - state.runStart) / 1000;
}
export function remainingAt(state, at) {
  return state.planned === null ? null : Math.max(0, state.planned - elapsedAt(state, at));
}

/**
 * @param {{api:{start:Function,tick:Function}, storage:Storage, key:string, now?:()=>number,
 *   uuid:()=>string, tabId?:string, isVisible?:()=>boolean, dayKey?:(ms:number)=>string}} deps
 */
export function createFocusSession({
  api,
  storage,
  key,
  now = () => Date.now(),
  uuid,
  tabId = uuid(),
  isVisible = () => true,
  dayKey = (ms) => new Date(ms).toDateString(),
}) {
  const listeners = new Set();
  let busy = false;
  let inFlight = null;
  let lastError = null;

  const read = () => parse(storage.getItem(key));
  const write = (state) => {
    state.updatedAt = now();
    storage.setItem(key, JSON.stringify(state));
    emit(state);
    return state;
  };
  const emit = (state = read()) => {
    const snapshot = view(state);
    for (const listener of listeners) listener(snapshot);
  };
  const view = (state) => {
    const at = now();
    return {
      ...state,
      elapsed: elapsedAt(state, at),
      remaining: remainingAt(state, at),
      busy,
      error: lastError,
      isLeader: state.leader === tabId,
    };
  };

  /** Closes the current run into `accumulated` at `at`. */
  function settle(state, at) {
    if (state.status === 'running' && state.runStart !== null) {
      state.accumulated = elapsedAt(state, at);
      state.runStart = null;
    }
  }
  function rollDay(state, at) {
    const day = dayKey(at);
    if (state.day !== day) {
      state.day = day;
      state.completedToday = 0;
    }
  }

  // ---- server accounting ------------------------------------------------------------------
  async function sendPending(state) {
    const server = state.server;
    if (!server?.pending) return state;
    if (inFlight) return inFlight;
    const wire = { ...server.pending };
    inFlight = (async () => {
      try {
        const row = await api.tick(server.id, wire);
        const fresh = read();
        if (fresh.server?.id === server.id) {
          fresh.server.sequence = row.last_sequence ?? wire.sequence;
          fresh.server.pending = null;
          fresh.server.lastTickAt = now();
          // The server ended the session (closed by us, or a gap over 45 s): forget it; the next
          // heartbeat of a running focus block opens a new one.
          if (row.ended_at || wire.close) fresh.server = null;
          write(fresh);
        }
        lastError = null;
        return read();
      } catch (error) {
        lastError = error.message || 'Sem confirmação do servidor. Tentaremos de novo.';
        // A conflicting sequence means another device or an old page moved the session on: drop it.
        if (error.code === 'STUDY_REQUEST_CONFLICT' || error.code === 'STUDY_NOT_FOUND') {
          const fresh = read();
          if (fresh.server?.id === server.id) {
            fresh.server = null;
            write(fresh);
          }
        }
        emit();
        return read();
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }
  function queueTick(state, { active, close }) {
    if (!state.server) return state;
    if (!state.server.pending)
      state.server.pending = { sequence: state.server.sequence + 1, active, close };
    return state;
  }
  async function openServer(state) {
    if (!countsAsStudy(state.mode) || state.server) return state;
    const id = uuid();
    const kind = state.mode === 'reading' ? 'reading' : 'pomodoro';
    const row = await api.start({ sessionId: id, materialId: state.materialId, kind });
    const fresh = read();
    fresh.server = {
      id: row.id || id,
      sequence: row.last_sequence ?? 0,
      pending: null,
      lastTickAt: now(),
      kind,
    };
    return write(fresh);
  }
  /** Sends what is pending, then closes the server session (crediting the last part if `active`). */
  async function closeServer(active) {
    let state = read();
    if (state.server?.pending) state = await sendPending(state);
    if (!state.server) return state;
    write(queueTick(state, { active, close: true }));
    return sendPending(read());
  }

  // ---- transitions --------------------------------------------------------------------------
  async function guard(task) {
    if (busy) return read();
    busy = true;
    emit();
    try {
      return await task();
    } catch (error) {
      lastError = error.message || 'Não foi possível concluir a ação.';
      throw error;
    } finally {
      busy = false;
      emit();
    }
  }

  async function start({ mode, materialId } = {}) {
    return guard(async () => {
      const at = now();
      let state = read();
      if (state.status === 'running') return state;
      // Anything left from a previous run is reconciled first (idempotent).
      if (state.server?.pending) await sendPending(state);
      state = read();
      const nextMode = mode && MODES.includes(mode) ? mode : state.mode;
      if (nextMode !== state.mode || state.status === 'idle') {
        state.mode = nextMode;
        state.planned = plannedSeconds(nextMode, state.settings);
        state.accumulated = 0;
      }
      if (materialId !== undefined) state.materialId = materialId || null;
      rollDay(state, at);
      state.notice = null;
      lastError = null;
      write(state);
      if (countsAsStudy(state.mode)) {
        try {
          state = await openServer(read());
        } catch (error) {
          // Without the server the timer still runs, but no minutes are credited; say so.
          lastError =
            error.code === 'STUDY_SESSION_ACTIVE'
              ? 'Há uma sessão de estudo aberta em outro aparelho. Este cronômetro corre, mas o tempo só conta lá.'
              : `${error.message || 'Sem conexão.'} O tempo desta sessão não será registrado na conta.`;
          state = read();
        }
      }
      state.status = 'running';
      state.runStart = now();
      state.lastSeen = state.runStart;
      state.leader = tabId;
      return write(state);
    });
  }

  async function pause() {
    return guard(async () => {
      const state = read();
      if (state.status !== 'running') return state;
      settle(state, now());
      state.status = 'paused';
      state.lastSeen = null;
      write(state);
      return closeServer(isVisible());
    });
  }

  /** Ends the block without completing it (no cycle counted). */
  async function stop() {
    return guard(async () => {
      const state = read();
      settle(state, now());
      const wasRunning = state.status === 'running';
      state.status = 'idle';
      state.accumulated = 0;
      state.planned = plannedSeconds(state.mode, state.settings);
      state.lastSeen = null;
      write(state);
      return wasRunning || state.server ? closeServer(wasRunning && isVisible()) : read();
    });
  }

  async function setMode(mode) {
    if (!MODES.includes(mode)) return read();
    const state = read();
    if (state.status === 'running') return state;
    if (state.server) await closeServer(false);
    const fresh = read();
    fresh.mode = mode;
    fresh.status = 'idle';
    fresh.accumulated = 0;
    fresh.planned = plannedSeconds(mode, fresh.settings);
    return write(fresh);
  }

  function updateSettings(partial) {
    const state = read();
    state.settings = normalizeSettings({ ...state.settings, ...partial });
    // A block that has not started yet follows the new duration.
    if (state.status === 'idle') state.planned = plannedSeconds(state.mode, state.settings);
    return write(state);
  }

  function setMaterial(materialId) {
    const state = read();
    if (state.status !== 'idle') return state;
    state.materialId = materialId || null;
    return write(state);
  }

  function nextModeAfter(state) {
    if (state.mode !== 'pomodoro') return 'pomodoro';
    return state.cycle % state.settings.longEvery === 0 ? 'long' : 'short';
  }

  async function complete(state, at) {
    const finished = state.mode;
    const seconds = Math.round(state.planned ?? elapsedAt(state, at));
    state.accumulated = state.planned ?? state.accumulated;
    state.runStart = null;
    state.lastSeen = null;
    if (finished === 'pomodoro') {
      state.cycle += 1;
      rollDay(state, at);
      state.completedToday += 1;
    }
    if (finished === 'long') state.cycle = 0;
    state.history = [
      { mode: finished, seconds, endedAt: at, materialId: state.materialId },
      ...state.history,
    ].slice(0, HISTORY_LIMIT);
    const next = nextModeAfter(state);
    state.mode = next;
    state.planned = plannedSeconds(next, state.settings);
    state.accumulated = 0;
    state.status = 'idle';
    state.notice = { kind: `${finished}_done`, at };
    write(state);
    if (countsAsStudy(finished)) await closeServer(true);
    if (read().settings.autoStart) return start({ mode: next });
    return read();
  }

  /**
   * Called about once a second by every page. Only the visible leader acts: it confirms the run
   * (lastSeen), completes blocks and sends the heartbeat. A run nobody confirmed for STALE_MS
   * stops at the last confirmation, and its server session is closed without credit.
   */
  async function pump() {
    const at = now();
    const state = read();
    if (state.status !== 'running') {
      if (state.server?.pending && !inFlight) await sendPending(state);
      emit(state);
      return read();
    }
    if (state.lastSeen !== null && at - state.lastSeen > STALE_MS) {
      settle(state, at);
      state.status = 'paused';
      state.lastSeen = null;
      state.notice = { kind: 'stopped_away', at };
      write(state);
      await closeServer(false);
      return read();
    }
    if (!isVisible()) {
      emit(state);
      return state;
    }
    const leaderAlive = state.leader && state.lastSeen !== null && at - state.lastSeen < LEADER_MS;
    if (state.leader !== tabId && leaderAlive) {
      emit(state);
      return state;
    }
    state.leader = tabId;
    state.lastSeen = at;
    if (state.planned !== null && remainingAt(state, at) <= 0) return complete(state, at);
    if (countsAsStudy(state.mode)) {
      if (!state.server && !busy) {
        write(state);
        try {
          await openServer(read());
        } catch {
          /* retried on the next heartbeat */
        }
        return read();
      }
      if (
        state.server &&
        !state.server.pending &&
        at - (state.server.lastTickAt || 0) >= HEARTBEAT_MS
      )
        queueTick(state, { active: true, close: false });
    }
    write(state);
    if (state.server?.pending && !inFlight) await sendPending(read());
    return read();
  }

  /** A page is leaving: confirm the run up to now so the next page continues seamlessly. */
  function handOff() {
    const state = read();
    if (state.status === 'running' && state.leader === tabId) {
      state.lastSeen = now();
      state.leader = null; // the next page takes over the heartbeat at once
      storage.setItem(key, JSON.stringify(state));
    }
  }

  function onStorage(event) {
    if (event.key === key) emit();
  }

  return {
    state: () => view(read()),
    subscribe(listener) {
      listeners.add(listener);
      listener(view(read()));
      return () => listeners.delete(listener);
    },
    start,
    pause,
    resume: () => start(),
    stop,
    setMode,
    setMaterial,
    updateSettings,
    pump,
    handOff,
    onStorage,
    clearNotice() {
      const state = read();
      if (!state.notice) return state;
      state.notice = null;
      return write(state);
    },
    tabId,
  };
}
