// The focus drawer: the focus timer beside any page, opened and closed from a top-bar button.
// It is the same single focus session as the Focar page (focus-session.js via focus-host.js):
// starting, pausing or stopping it here is the same as doing it on Focar. Three presentations:
//   • panel   — right side panel on wide screens (the content narrows beside it) or a bottom sheet
//               on phones;
//   • capsule — a small floating pill with the time, pause/resume and expand;
//   • hidden  — nothing on screen; the session keeps running and the top-bar button shows the time.
// Closing or hiding never stops the session. Linking a block to the lesson that is open, the
// end-of-block toasts and the sounds that follow focus stay in focus-indicator.js.
import { getFocusSession } from './focus-host.js';
import { icon } from './icons.js';

const MODES = [
  ['pomodoro', 'Foco', 'Foco'],
  ['short', 'Pausa', 'Pausa curta'],
  ['long', 'Longa', 'Pausa longa'],
  ['reading', 'Livre', 'Estudo livre'],
];
const MODE_LABEL = Object.fromEntries(MODES.map(([value, , label]) => [value, label]));
const NOTICES = {
  pomodoro_done: 'Foco concluído! Hora de uma pausa.',
  short_done: 'Pausa concluída. Pronto para outro foco?',
  long_done: 'Pausa longa concluída. Bom retorno!',
  reading_done: 'Bloco concluído.',
  stopped_away: 'O cronômetro parou porque nenhuma página do Voz em Estudo ficou aberta e visível.',
};
const WIDE = '(min-width: 1280px)';

const clock = (seconds) => {
  const value = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const iconButton = (name, label, className) => {
  const button = make('button', null, `utility-icon ${className || ''}`.trim());
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(icon(name, { size: 18 }));
  return button;
};
function ensureStyles() {
  if (document.querySelector('link[href$="/css/focus-drawer.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/focus-drawer.css';
  document.head.append(link);
}

export async function initFocusDrawer({ userId } = {}) {
  if (!document.body.classList.contains('app-page') || document.querySelector('[data-utility-shell]')) return false;
  // On Focar the full timer is the page itself.
  if (document.body.dataset.page === 'focus') return false;
  const nav = document.querySelector('.header-navigation');
  if (!nav) return false;
  const session = await getFocusSession();
  ensureStyles();
  const prefKey = `voz-utility-v1:${userId}`;
  const readPref = () => {
    try {
      return { mode: 'auto', ...JSON.parse(localStorage.getItem(prefKey) || '{}') };
    } catch {
      return { mode: 'auto' };
    }
  };
  const savePref = (patch) => {
    try {
      localStorage.setItem(prefKey, JSON.stringify({ ...readPref(), ...patch }));
    } catch {
      /* per-device convenience */
    }
  };

  // ---- top-bar button ----------------------------------------------------------------------
  const trigger = make('button', null, 'utility-trigger');
  trigger.type = 'button';
  trigger.dataset.utilityTrigger = '';
  trigger.setAttribute('aria-controls', 'utility-panel');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', 'Cronômetro de foco');
  trigger.title = 'Cronômetro de foco';
  const triggerTime = make('span', null, 'utility-trigger-time');
  triggerTime.setAttribute('aria-hidden', 'true');
  trigger.append(icon('clock', { size: 20 }), make('span', null, 'utility-trigger-dot'), triggerTime);
  nav.prepend(trigger);

  // ---- panel ---------------------------------------------------------------------------------
  const panel = make('aside', null, 'utility-panel');
  panel.id = 'utility-panel';
  panel.dataset.utilityShell = '';
  panel.setAttribute('aria-labelledby', 'utility-panel-title');
  panel.hidden = true;
  const head = make('div', null, 'utility-panel-head');
  const title = make('h2', 'Foco');
  title.id = 'utility-panel-title';
  title.tabIndex = -1;
  const openPage = make('a', 'Abrir Focar', 'utility-link');
  openPage.href = './focar.html';
  const minimize = iconButton('minimize', 'Minimizar em cápsula');
  const close = iconButton('close', 'Fechar painel');
  head.append(title, openPage, minimize, close);
  const body = make('div', null, 'utility-panel-body');
  const modes = make('div', null, 'utility-modes');
  modes.setAttribute('role', 'radiogroup');
  modes.setAttribute('aria-label', 'Tipo de bloco');
  const modeButtons = new Map();
  for (const [value, short, label] of MODES) {
    const button = make('button', short, 'utility-mode');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.setAttribute('role', 'radio');
    button.dataset.mode = value;
    button.addEventListener('click', () => void session.setMode(value));
    modes.append(button);
    modeButtons.set(value, button);
  }
  modes.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const list = [...modeButtons.values()];
    const at = list.indexOf(document.activeElement);
    const next = list[(at + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + list.length) % list.length];
    next.focus();
    next.click();
  });
  const face = make('div', null, 'utility-face');
  const ring = make('div', null, 'utility-ring');
  ring.setAttribute('aria-hidden', 'true');
  const time = make('output', '25:00', 'utility-time');
  time.setAttribute('aria-live', 'off');
  time.setAttribute('aria-label', 'Tempo do bloco');
  const caption = make('p', null, 'utility-caption');
  const lesson = make('p', null, 'utility-lesson');
  face.append(ring, time, caption);
  const actions = make('div', null, 'utility-actions');
  const primary = make('button', 'Iniciar foco', 'primary-action utility-primary');
  primary.type = 'button';
  primary.dataset.focusPrimary = '';
  const stop = make('button', 'Encerrar', 'secondary-action utility-stop');
  stop.type = 'button';
  actions.append(primary, stop);
  const status = make('p', null, 'utility-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const cycles = make('p', null, 'utility-cycles');
  body.append(modes, face, lesson, actions, cycles, status);
  panel.append(head, body);

  // ---- capsule -------------------------------------------------------------------------------
  const capsule = make('div', null, 'focus-capsule');
  capsule.dataset.focusCapsule = '';
  capsule.setAttribute('role', 'group');
  capsule.setAttribute('aria-label', 'Cronômetro de foco');
  capsule.hidden = true;
  const capsuleDot = make('span', null, 'focus-capsule-dot');
  capsuleDot.setAttribute('aria-hidden', 'true');
  const capsuleTime = make('span', '25:00', 'focus-capsule-time');
  const capsuleMode = make('span', null, 'focus-capsule-mode');
  const capsuleToggle = iconButton('pause', 'Pausar', 'focus-capsule-toggle');
  const capsuleExpand = iconButton('expand', 'Abrir painel do cronômetro', 'focus-capsule-expand');
  const capsuleHide = iconButton('close', 'Esconder cápsula', 'focus-capsule-hide');
  capsule.append(capsuleDot, capsuleTime, capsuleMode, capsuleToggle, capsuleExpand, capsuleHide);
  document.body.append(panel, capsule);

  // ---- behaviour -----------------------------------------------------------------------------
  let shown = readPref().mode; // 'auto' | 'panel' | 'capsule' | 'hidden'
  if (!['auto', 'panel', 'capsule', 'hidden'].includes(shown)) shown = 'auto';
  let opener = null;
  const setShown = (mode, { focus = false } = {}) => {
    shown = mode;
    savePref({ mode });
    layout(session.state());
    if (focus && mode === 'panel') title.focus();
  };
  const togglePrimary = () => {
    const state = session.state();
    if (state.busy) return;
    if (state.status === 'running') void session.pause().catch(() => {});
    else void session.start().catch(() => {});
  };
  trigger.addEventListener('click', () => {
    opener = trigger;
    setShown(shown === 'panel' ? 'auto' : 'panel', { focus: true });
  });
  minimize.addEventListener('click', () => {
    setShown('capsule');
    capsuleExpand.focus();
  });
  close.addEventListener('click', () => {
    // Back to automatic: the capsule shows while a block is running or paused.
    setShown('auto');
    (opener?.isConnected ? opener : trigger).focus();
  });
  capsuleExpand.addEventListener('click', () => {
    opener = capsuleExpand;
    setShown('panel', { focus: true });
  });
  capsuleHide.addEventListener('click', () => {
    setShown('hidden');
    trigger.focus();
  });
  // Esc closes the open panel wherever focus is (a dialog opened meanwhile closes first).
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden || event.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    close.click();
  });
  primary.addEventListener('click', togglePrimary);
  capsuleToggle.addEventListener('click', togglePrimary);
  stop.addEventListener('click', () => void session.stop().catch(() => {}));

  function layout(state) {
    const active = state.status !== 'idle';
    const wide = window.matchMedia(WIDE).matches;
    const panelOpen = shown === 'panel';
    panel.hidden = !panelOpen;
    panel.dataset.sheet = String(!wide);
    // Wide screens: the content narrows beside the panel instead of being covered.
    document.body.classList.toggle('utility-open', panelOpen && wide);
    capsule.hidden = panelOpen || shown === 'hidden' || (!active && shown !== 'capsule');
    trigger.setAttribute('aria-expanded', String(panelOpen));
    trigger.dataset.state = state.status;
    trigger.classList.toggle('is-active', active);
  }

  function render(state) {
    const label = clock(state.remaining ?? state.elapsed);
    const active = state.status !== 'idle';
    time.textContent = label;
    capsuleTime.textContent = label;
    triggerTime.textContent = active ? label : '';
    trigger.setAttribute(
      'aria-label',
      active
        ? `Cronômetro de foco: ${MODE_LABEL[state.mode]} ${state.status === 'paused' ? 'pausado' : 'em andamento'}, ${label}`
        : 'Cronômetro de foco',
    );
    capsuleMode.textContent = MODE_LABEL[state.mode];
    lesson.textContent =
      state.materialTitle && (state.mode === 'pomodoro' || state.mode === 'reading') ? `Aula: ${state.materialTitle}` : '';
    caption.textContent =
      state.status === 'running'
        ? `${MODE_LABEL[state.mode]} em andamento`
        : state.status === 'paused'
          ? `${MODE_LABEL[state.mode]} pausado`
          : state.mode === 'reading'
            ? 'Sem tempo definido'
            : `${MODE_LABEL[state.mode]} de ${Math.round((state.planned || 0) / 60)} minutos`;
    const progress =
      state.planned === null ? (state.elapsed % 3600) / 3600 : 1 - (state.remaining ?? 0) / (state.planned || 1);
    const clamped = String(Math.max(0, Math.min(1, progress)));
    panel.style.setProperty('--focus-progress', clamped);
    capsule.style.setProperty('--focus-progress', clamped);
    capsule.dataset.state = state.status;
    capsule.dataset.mode = state.mode;
    panel.dataset.state = state.status;
    panel.dataset.mode = state.mode;
    for (const [mode, button] of modeButtons) {
      const on = mode === state.mode;
      button.setAttribute('aria-checked', String(on));
      button.tabIndex = on ? 0 : -1;
      button.disabled = state.status === 'running' || state.busy;
    }
    const running = state.status === 'running';
    primary.textContent = running
      ? 'Pausar'
      : state.status === 'paused'
        ? 'Retomar'
        : state.mode === 'pomodoro'
          ? 'Iniciar foco'
          : state.mode === 'reading'
            ? 'Iniciar estudo livre'
            : 'Iniciar pausa';
    primary.setAttribute('aria-pressed', String(running));
    // aria-disabled, not disabled: a disabled button would drop the focus while the session starts.
    primary.setAttribute('aria-disabled', String(Boolean(state.busy)));
    stop.hidden = state.status === 'idle';
    capsuleToggle.replaceChildren(icon(running ? 'pause' : 'play', { size: 18 }));
    capsuleToggle.setAttribute('aria-label', running ? 'Pausar' : 'Retomar');
    capsuleToggle.title = running ? 'Pausar' : 'Retomar';
    capsuleToggle.setAttribute('aria-disabled', String(Boolean(state.busy)));
    const every = state.settings?.longEvery || 4;
    const done = (state.cycle || 0) % every;
    cycles.textContent = `${state.completedToday || 0} ${state.completedToday === 1 ? 'foco hoje' : 'focos hoje'} · ${done} de ${every} até a pausa longa`;
    status.textContent = state.error || (state.notice ? NOTICES[state.notice.kind] || '' : '');
    layout(state);
  }
  session.subscribe(render);
  window.matchMedia(WIDE).addEventListener?.('change', () => layout(session.state()));
  return true;
}
