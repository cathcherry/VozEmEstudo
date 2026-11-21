// Soundscape controller: the mix of one account, its persistence and who actually plays it.
//
// Pages of the app are separate HTML documents, so a page's sound ends on navigation. What
// persists is the mix and "it was playing": the next page offers a one-tap resume (browsers
// block audio that starts without a click). For sound without interruption the student can open
// the mini-player (a small window of its own); while it is open, pages do not play and their
// mixer controls the mini-player instead (mix through localStorage, commands through a
// BroadcastChannel).
import {
  normalizeMix,
  applyPreset,
  setLayer,
  hasSound,
  parseMusicUrl,
  storageKey,
  miniPlayerKey,
  legacyKey,
  migrateLegacy,
  PRESETS,
} from './soundscape-mix.js';
import { createSoundscapeEngine } from './soundscape-engine.js';

export const MINI_HEARTBEAT_MS = 2000;
const MINI_STALE_MS = 6000;

function safeStorage(storage) {
  return {
    read(key) {
      try {
        return JSON.parse(storage?.getItem(key) || 'null');
      } catch {
        return null;
      }
    },
    write(key, value) {
      try {
        storage?.setItem(key, JSON.stringify(value));
      } catch {
        /* per-device convenience */
      }
    },
    remove(key) {
      try {
        storage?.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

/** Reads the saved mix of an account (carrying over the 3.4 ambient-sound choice once). */
export function loadMix(userId, storage = globalThis.localStorage) {
  const store = safeStorage(storage);
  const saved = store.read(storageKey(userId));
  if (saved) return normalizeMix(saved);
  const legacy = migrateLegacy(store.read(legacyKey(userId)));
  if (legacy) return legacy;
  // A first visit starts from the first atmosphere's mix (silent until the student presses play).
  return applyPreset(normalizeMix(), PRESETS[0].id);
}

/**
 * @param {{ userId: string, role?: 'page'|'mini', storage?: Storage,
 *   engine?: ReturnType<typeof createSoundscapeEngine>, channel?: BroadcastChannel|null,
 *   now?: () => number }} options
 */
export function createSoundscapeController({
  userId,
  role = 'page',
  storage = globalThis.localStorage,
  engine = createSoundscapeEngine(),
  channel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel(`voz-soundscape-v1:${userId}`)
    : null,
  now = () => Date.now(),
} = {}) {
  const store = safeStorage(storage);
  const key = storageKey(userId);
  const miniKey = miniPlayerKey(userId);
  let mix = loadMix(userId, storage);
  // The saved flag means "was playing on the previous page". Here nothing plays yet.
  const resumable = mix.playing && hasSound(mix);
  let playing = false;
  let ducked = false;
  let error = '';
  const listeners = new Set();

  const miniInfo = () => store.read(miniKey);
  const miniActive = () => {
    if (role === 'mini') return false;
    const info = miniInfo();
    return Boolean(info && now() - Number(info.at || 0) < MINI_STALE_MS);
  };
  const snapshot = () => {
    const mini = miniActive();
    return {
      mix,
      // On a page while the mini-player is open, "playing" mirrors the mini-player.
      playing: mini ? miniInfo()?.playing === true : playing,
      local: playing,
      mini,
      ducked,
      resumable: resumable && !playing && !mini,
      error,
    };
  };
  const emit = () => {
    const state = snapshot();
    for (const listener of listeners) listener(state);
  };
  const save = () => store.write(key, { ...mix, playing: snapshot().playing });

  function setMix(next) {
    mix = normalizeMix({ ...next, playing: mix.playing });
    if (playing) engine.update(mix);
    // Nothing left to hear: stop instead of playing silence.
    if (playing && !hasSound(mix)) stopLocal();
    save();
    emit();
  }
  function stopLocal() {
    engine.stop();
    playing = false;
  }

  async function play() {
    error = '';
    if (!hasSound(mix)) mix = applyPreset(mix, mix.preset || PRESETS[0].id);
    if (miniActive()) {
      channel?.postMessage({ type: 'play' });
      mix = normalizeMix({ ...mix, playing: true });
      store.write(key, { ...mix, playing: true });
      emit();
      return;
    }
    try {
      await engine.start(mix);
      playing = true;
      mix = normalizeMix({ ...mix, playing: true });
      engine.setDucked(ducked);
      save();
    } catch (failure) {
      playing = false;
      error = failure?.message || 'Não foi possível tocar o som.';
    }
    emit();
  }
  function pause() {
    if (miniActive()) channel?.postMessage({ type: 'pause' });
    stopLocal();
    mix = normalizeMix({ ...mix, playing: false });
    store.write(key, { ...mix, playing: false });
    emit();
  }

  // Another page (or the mini-player) changed the mix: follow it.
  function onStorage(event) {
    if (event.key === key && event.newValue) {
      try {
        const next = normalizeMix(JSON.parse(event.newValue));
        mix = normalizeMix({ ...next, playing: next.playing });
        if (playing) engine.update(mix);
      } catch {
        /* ignore malformed values */
      }
      emit();
    } else if (event.key === miniKey) emit();
  }
  globalThis.addEventListener?.('storage', onStorage);

  // The mini-player obeys play/pause/duck from pages.
  if (channel && role === 'mini')
    channel.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === 'play') void play();
      else if (message.type === 'pause') pause();
      else if (message.type === 'duck') controller.setDucked(Boolean(message.on));
    };

  let heartbeat = null;
  const controller = {
    state: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    play,
    pause,
    toggle: () => (snapshot().playing ? pause() : play()),
    setPreset: (id) => setMix(applyPreset(mix, id)),
    setLayer: (id, patch) => setMix(setLayer(mix, id, patch)),
    setMaster: (value) => setMix({ ...mix, master: value }),
    setDuck: (on) => setMix({ ...mix, duck: Boolean(on) }),
    setWithFocus: (on) => setMix({ ...mix, withFocus: Boolean(on) }),
    /** Saves a validated music link (throws a readable error), or clears it with null. */
    setMusic(url) {
      const parsed = url ? parseMusicUrl(url) : null;
      setMix({ ...mix, music: parsed ? { url: parsed.url } : null });
      return parsed;
    },
    /** Lesson media on this page started or stopped. */
    setDucked(on) {
      ducked = Boolean(on);
      if (miniActive()) channel?.postMessage({ type: 'duck', on: ducked });
      engine.setDucked(ducked);
      emit();
    },
    /** A focus block started (true) or stopped/paused (false): follow it when asked to. */
    followFocus(studying) {
      if (!mix.withFocus) return;
      const current = snapshot().playing;
      if (studying && !current) void play();
      else if (!studying && current) pause();
    },
    /** Called when the tab becomes visible again or the system interrupted audio. */
    async wake() {
      try {
        await engine.ensureRunning();
      } catch {
        /* the next click resumes */
      }
      emit();
    },
    /** Pages hand the sound over to the mini-player (keeps "playing" for the mini-player). */
    handOver() {
      const was = snapshot().playing || playing;
      stopLocal();
      store.write(key, { ...mix, playing: was });
      emit();
      return was;
    },
    miniActive,
    /** Mini-player only: announces that it is open, every couple of seconds. */
    startHeartbeat(setTimer = setInterval) {
      const beat = () => store.write(miniKey, { at: now(), playing });
      beat();
      heartbeat = setTimer(beat, MINI_HEARTBEAT_MS);
      listeners.add(beat);
    },
    dispose() {
      globalThis.removeEventListener?.('storage', onStorage);
      if (heartbeat) clearInterval(heartbeat);
      if (role === 'mini') store.remove(miniKey);
      if (ducked && miniActive()) channel?.postMessage({ type: 'duck', on: false });
      channel?.close?.();
      engine.dispose();
    },
  };
  return controller;
}
