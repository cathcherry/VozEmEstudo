// The focus indicator (3.6). There is one focus engine for the account (focus-session.js, pumped
// by focus-host.js) and one place where it is run: the Focar page. Every other page only shows a
// small link in the top bar while a block is running or paused (the time left and the kind of
// block); it opens Focar. Nothing here starts, pauses or stops the session.
//
// It also keeps two behaviours that belong to the session rather than to a page: a lesson page
// links the next block to that lesson, and the ambient sounds follow focus blocks when the student
// asked for it ("Tocar junto com o foco").
import { getFocusSession } from './focus-host.js';
import { getSoundscape } from './soundscape-ui.js';
import { toast } from './toast.js';

export const FOCUS_MODE_LABEL = Object.freeze({
  pomodoro: 'Foco',
  short: 'Pausa curta',
  long: 'Pausa longa',
  reading: 'Estudo livre',
});
export function focusClock(seconds) {
  const value = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
/** What the indicator says, or null when there is nothing to show (no block running or paused). */
export function indicatorView(state) {
  if (!state || state.status === 'idle') return null;
  const time = focusClock(state.remaining ?? state.elapsed);
  const mode = FOCUS_MODE_LABEL[state.mode] || FOCUS_MODE_LABEL.pomodoro;
  const paused = state.status === 'paused';
  return {
    time,
    mode,
    paused,
    label: `${mode} ${paused ? 'pausado' : 'em andamento'}: ${time}${state.planned === null ? '' : ' restantes'}. Abrir Focar`,
  };
}

const NOTICES = {
  pomodoro_done: ['Foco concluído! Hora de uma pausa.', 'success'],
  short_done: ['Pausa concluída. Pronto para outro foco?', 'info'],
  long_done: ['Pausa longa concluída. Bom retorno!', 'info'],
  reading_done: ['Bloco concluído.', 'info'],
};
const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};

export async function initFocusIndicator({ materialId = null } = {}) {
  if (!document.body.classList.contains('app-page') || document.querySelector('[data-focus-indicator]')) return;
  const session = await getFocusSession();
  const onFocusPage = document.body.dataset.page === 'focus';
  // Outside a lesson, a new block is not linked to the last lesson visited. Focar keeps the link,
  // so "open a lesson, then Focar" studies that lesson.
  if (!materialId && !onFocusPage) session.setMaterial(null);
  if (materialId) {
    // The lesson's title arrives when the page has loaded it.
    const titleNode = document.querySelector('[data-material-title]');
    const link = () => {
      const text = titleNode?.getAttribute('aria-busy') === 'true' ? '' : titleNode?.textContent || '';
      session.setMaterial(materialId, text);
    };
    link();
    if (titleNode)
      new MutationObserver(link).observe(titleNode, { childList: true, characterData: true, subtree: true, attributes: true });
  }

  // ---- the top-bar link --------------------------------------------------------------------
  const indicator = make('a', null, 'focus-indicator');
  indicator.href = './focar.html';
  indicator.dataset.focusIndicator = '';
  indicator.hidden = true;
  const dot = make('span', null, 'focus-indicator-dot');
  dot.setAttribute('aria-hidden', 'true');
  const time = make('span', '25:00', 'focus-indicator-time');
  time.setAttribute('aria-hidden', 'true');
  const mode = make('span', null, 'focus-indicator-mode');
  mode.setAttribute('aria-hidden', 'true');
  indicator.append(dot, time, mode);
  const nav = document.querySelector('.header-navigation');
  // The focus drawer's button already shows the time: no second control in the top bar.
  const drawer = document.querySelector('[data-utility-trigger]');
  if (nav && !onFocusPage && !drawer) nav.prepend(indicator);

  // ---- Início: "Iniciar foco" in the week card opens Focar (no second timer here) ----------
  const weekHead = document.querySelector('[data-week-widget] .dash-card-head');
  let shortcut = null;
  if (weekHead) {
    shortcut = make('a', 'Iniciar foco', 'text-action focus-shortcut');
    shortcut.dataset.focusShortcut = '';
    shortcut.href = './focar.html?iniciar=foco';
    weekHead.querySelector('h2')?.after(shortcut);
  }

  session.subscribe((state) => {
    const view = indicatorView(state);
    indicator.hidden = !view;
    if (view) {
      time.textContent = view.time;
      mode.textContent = view.mode;
      indicator.dataset.state = view.paused ? 'paused' : 'running';
      indicator.dataset.mode = state.mode;
      indicator.setAttribute('aria-label', view.label);
      indicator.title = view.label;
    }
    if (shortcut) {
      shortcut.textContent = view ? `${view.mode} · ${view.time}` : 'Iniciar foco';
      shortcut.href = view ? './focar.html' : './focar.html?iniciar=foco';
    }
  });

  // A block that ends while the student is on another page is announced here (Focar announces
  // it in its own panel).
  if (!onFocusPage)
    document.addEventListener('voz:focus-notice', (event) => {
      const [text, type] = NOTICES[event.detail?.kind] || [];
      if (text) toast(text, { type });
    });

  // "Tocar junto com o foco" (soundscape mixer): focus blocks start and pause the ambience.
  const soundscape = getSoundscape();
  if (soundscape) {
    soundscape.showFocusOption();
    const studying = (state) => state.status === 'running' && state.mode !== 'short' && state.mode !== 'long';
    let focusRunning = studying(session.state());
    session.subscribe((state) => {
      const now = studying(state);
      if (now === focusRunning) return;
      focusRunning = now;
      // Only the tab in front follows (each tab has its own player).
      if (document.hasFocus()) soundscape.controller.followFocus(now);
    });
  }
}
