// One FocusSession per page for the signed-in account: it pumps once a second, hands the run over
// when the page unloads, follows other tabs through `storage` events and plays the end-of-block
// chime. Every view (Focar page, Planejar, side panel, capsule) uses `getFocusSession()`.
import { createFocusSession } from './focus-session.js';
import { startStudySession, tickStudySession } from '../api/study.api.js';
import { getUiPreferences, setUiPreference } from './preferences.js';

let session = null;
let resolveReady;
const ready = new Promise((resolve) => {
  resolveReady = resolve;
});

/** Resolves with the page's focus session once the account is known (or never, if tracking is off). */
export const getFocusSession = () => ready;
export const focusKey = (userId) => `voz-focus-v1:${userId}`;

function chime() {
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    const context = new Context();
    const notes = [659.25, 880];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      const start = context.currentTime + index * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.55);
    });
    setTimeout(() => void context.close(), 1500);
  } catch {
    /* sound is optional */
  }
}

export function initFocusHost(userId) {
  if (session || !userId) return session;
  session = createFocusSession({
    api: { start: startStudySession, tick: tickStudySession },
    storage: localStorage,
    key: focusKey(userId),
    uuid: () => crypto.randomUUID(),
    isVisible: () => document.visibilityState === 'visible',
  });
  const update = session.updateSettings;
  // Durations saved in the account (synced preferences) win over this browser's copy.
  const saved = getUiPreferences().focusSettings;
  const current = session.state().settings;
  if (saved && JSON.stringify(saved) !== JSON.stringify(current)) update(saved);
  // Preferences pulled from the account later (sign-in on a new device) also apply.
  window.addEventListener('voz-preferences-change', () => {
    queueMicrotask(() => {
      const remote = getUiPreferences().focusSettings;
      if (remote && JSON.stringify(remote) !== JSON.stringify(session.state().settings)) update(remote);
    });
  });
  // …and a change here is saved to the account.
  session.updateSettings = (partial) => {
    const state = update(partial);
    setUiPreference('focusSettings', state.settings);
    return state;
  };
  let lastNotice = session.state().notice?.at || 0;
  session.subscribe((state) => {
    // The leader announces a finished block once, for every view of this page.
    if (state.notice && state.notice.at > lastNotice) {
      lastNotice = state.notice.at;
      if (state.notice.kind.endsWith('_done') && state.settings.sound && state.isLeader !== false)
        chime();
      // System notification (opt-in) when the block ends while no page is in front.
      if (
        state.notice.kind.endsWith('_done') &&
        state.settings.notify &&
        state.isLeader !== false &&
        document.visibilityState !== 'visible' &&
        globalThis.Notification?.permission === 'granted'
      ) {
        const text = {
          pomodoro_done: 'Foco concluído! Hora de uma pausa.',
          short_done: 'Pausa concluída. Pronto para outro foco?',
          long_done: 'Pausa longa concluída. Bom retorno!',
          reading_done: 'Bloco concluído.',
        }[state.notice.kind];
        try {
          new Notification('Voz em Estudo', { body: text, tag: 'voz-focus', silent: !state.settings.sound });
        } catch {
          /* some browsers only allow notifications from a service worker */
        }
      }
      document.dispatchEvent(new CustomEvent('voz:focus-notice', { detail: state.notice }));
    }
  });
  const pump = () => void session.pump().catch(() => {});
  let timer = setInterval(pump, 1000);
  document.addEventListener('visibilitychange', pump);
  window.addEventListener('storage', (event) => session.onStorage(event));
  window.addEventListener('pagehide', () => {
    clearInterval(timer);
    session.handOff();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      clearInterval(timer);
      timer = setInterval(pump, 1000);
      pump();
    }
  });
  // Older controls (dashboard shortcuts) still ask through this event.
  document.addEventListener('voz:tracking-command', (event) => {
    const action = event.detail?.action;
    if (action === 'start') void session.start().catch(() => {});
    if (action === 'pause') void session.pause().catch(() => {});
  });
  pump();
  resolveReady(session);
  return session;
}
