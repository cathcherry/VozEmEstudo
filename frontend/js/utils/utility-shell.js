// The study utility shell: one place for auxiliary tools beside the content. Today it hosts the
// focus timer; notes and music plug into the same panel later (TOOLS below) instead of adding
// competing sidebars. Three presentations of the same focus session:
//   • panel   — right side panel on wide screens (the page content narrows beside it) or a bottom
//               sheet on phones;
//   • capsule — a small floating pill with the time, pause/resume and expand;
//   • hidden  — nothing on screen; the session keeps running and the topbar button shows a dot.
// Hiding or closing a presentation never stops the session.
import { getFocusSession } from './focus-host.js';

const SVG = 'http://www.w3.org/2000/svg';
const MODES = [
  ['pomodoro', 'Foco', 'Foco'],
  ['short', 'Pausa', 'Pausa curta'],
  ['long', 'Longa', 'Pausa longa'],
  ['reading', 'Livre', 'Estudo livre'],
];
const MODE_LABEL = Object.fromEntries(MODES.map(([value, , label]) => [value, label]));
const clock = (seconds) => {
  const value = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(value / 3600),
    m = Math.floor((value % 3600) / 60),
    s = value % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 2, '0')}:${String(s).padStart(2, '0')}`;
};
const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const icon = (paths, size = 18) => {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
};
const ICONS = {
  timer: ['M12 8v5l3 2', 'M9 2h6', 'M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z'],
  play: ['M8 5v14l11-7z'],
  pause: ['M8 5v14', 'M16 5v14'],
  stop: ['M7 7h10v10H7z'],
  expand: ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'],
  minimize: ['M4 14h6v6', 'M20 10h-6V4', 'M14 10l7-7', 'M3 21l7-7'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
};
const iconButton = (name, label, className) => {
  const button = make('button', null, `utility-icon ${className || ''}`.trim());
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(icon(ICONS[name]));
  return button;
};

/** Tools of the shell. Notes and music will register here; each renders into the panel body. */
const TOOLS = { focus: { label: 'Foco' } };

export async function initUtilityShell({ userId, materialId = null } = {}) {
  if (
    !document.body.classList.contains('app-page') ||
    document.querySelector('[data-utility-shell]')
  )
    return;
  const session = await getFocusSession();
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
  // On the Focar page the full timer is already the page.
  const onFocusPage = document.body.dataset.page === 'focus';
  // Outside a lesson, a new block is not linked to the last lesson visited.
  if (!materialId && !document.querySelector('[data-study-tracking-panel]')) session.setMaterial(null);
  let link = () => {};
  if (materialId) {
    // The lesson's title arrives when the page has loaded it.
    const titleNode = document.querySelector('[data-material-title]');
    link = () => {
      const text = titleNode?.getAttribute('aria-busy') === 'true' ? '' : titleNode?.textContent || '';
      session.setMaterial(materialId, text);
    };
    link();
    if (titleNode) new MutationObserver(link).observe(titleNode, { childList: true, characterData: true, subtree: true, attributes: true });
  }

  // ---- topbar button ---------------------------------------------------------------------
  const nav = document.querySelector('.header-navigation');
  const trigger = make('button', null, 'utility-trigger');
  trigger.type = 'button';
  trigger.dataset.utilityTrigger = '';
  trigger.setAttribute('aria-controls', 'utility-panel');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', 'Cronômetro de foco');
  trigger.title = 'Cronômetro de foco';
  trigger.append(icon(ICONS.timer, 20), make('span', null, 'utility-trigger-dot'));
  if (nav && !onFocusPage) nav.prepend(trigger);

  // ---- panel ------------------------------------------------------------------------------
  const panel = make('aside', null, 'utility-panel');
  panel.id = 'utility-panel';
  panel.dataset.utilityShell = '';
  panel.setAttribute('aria-labelledby', 'utility-panel-title');
  panel.hidden = true;
  const head = make('div', null, 'utility-panel-head');
  const title = make('h2', TOOLS.focus.label);
  title.id = 'utility-panel-title';
  title.tabIndex = -1;
  const openPage = make('a', 'Abrir Focar', 'utility-link');
  openPage.href = './focar.html';
  const minimize = iconButton('minimize', 'Minimizar em cápsula');
  const close = iconButton('close', 'Fechar painel (o cronômetro continua na cápsula)');
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

  // ---- capsule ----------------------------------------------------------------------------
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
  const capsuleHide = iconButton(
    'close',
    'Esconder cápsula (o cronômetro continua)',
    'focus-capsule-hide',
  );
  capsule.append(capsuleDot, capsuleTime, capsuleMode, capsuleToggle, capsuleExpand, capsuleHide);

  document.body.append(panel, capsule);

  // Início: start focusing in one click from the week card (same session as everywhere).
  const weekHead = document.querySelector('[data-week-widget] .dash-card-head');
  let shortcut = null;
  if (weekHead) {
    shortcut = make('button', 'Iniciar foco', 'text-action focus-shortcut');
    shortcut.type = 'button';
    shortcut.dataset.focusShortcut = '';
    weekHead.querySelector('h2')?.after(shortcut);
    shortcut.addEventListener('click', () => {
      const state = session.state();
      if (state.status === 'running') void session.pause().catch(() => {});
      else void session.start({ mode: state.status === 'paused' ? undefined : 'pomodoro' }).catch(() => {});
    });
  }

  // ---- behaviour --------------------------------------------------------------------------
  let shown = readPref().mode; // 'auto' | 'panel' | 'capsule' | 'hidden'
  let opener = null;
  const setShown = (mode, { focus = false } = {}) => {
    shown = mode;
    savePref({ mode });
    layout(session.state());
    if (focus && mode === 'panel') title.focus();
  };
  const togglePrimary = () => {
    const state = session.state();
    if (state.status === 'running') void session.pause().catch(() => {});
    else {
      // A new block started on a lesson page belongs to that lesson.
      if (state.status === 'idle') link();
      void session.start({ materialId: materialId ?? undefined }).catch(() => {});
    }
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
    if (trigger.isConnected) trigger.focus();
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close.click();
    }
  });
  primary.addEventListener('click', togglePrimary);
  capsuleToggle.addEventListener('click', togglePrimary);
  stop.addEventListener('click', () => void session.stop().catch(() => {}));

  const NOTICES = {
    pomodoro_done: 'Foco concluído! Hora de uma pausa.',
    short_done: 'Pausa concluída. Pronto para outro foco?',
    long_done: 'Pausa longa concluída. Bom retorno!',
    reading_done: 'Bloco concluído.',
    stopped_away:
      'O cronômetro parou porque nenhuma página do Voz em Estudo ficou aberta e visível.',
  };

  function layout(state) {
    const active = state.status !== 'idle';
    const wide = window.matchMedia('(min-width: 1280px)').matches;
    const panelOpen = shown === 'panel';
    panel.hidden = !panelOpen;
    panel.dataset.sheet = String(!wide);
    // Wide screens: content narrows beside the panel instead of being covered.
    document.body.classList.toggle('utility-open', panelOpen && wide);
    capsule.hidden =
      onFocusPage || panelOpen || shown === 'hidden' || (!active && shown !== 'capsule');
    trigger.setAttribute('aria-expanded', String(panelOpen));
    trigger.dataset.state = state.status;
    trigger.classList.toggle('is-active', active);
  }

  function render(state) {
    const value = state.remaining ?? state.elapsed;
    const label = clock(value);
    time.textContent = label;
    capsuleTime.textContent = label;
    capsuleMode.textContent = MODE_LABEL[state.mode];
    lesson.textContent = state.materialTitle && (state.mode === 'pomodoro' || state.mode === 'reading') ? `Aula: ${state.materialTitle}` : '';
    caption.textContent =
      state.status === 'running'
        ? `${MODE_LABEL[state.mode]} em andamento`
        : state.status === 'paused'
          ? `${MODE_LABEL[state.mode]} pausado`
          : state.mode === 'reading'
            ? 'Estudo livre, sem tempo definido'
            : `${MODE_LABEL[state.mode]} de ${Math.round((state.planned || 0) / 60)} minutos`;
    const progress =
      state.planned === null
        ? (state.elapsed % 3600) / 3600
        : 1 - (state.remaining ?? 0) / (state.planned || 1);
    panel.style.setProperty('--focus-progress', String(Math.max(0, Math.min(1, progress))));
    capsule.style.setProperty('--focus-progress', String(Math.max(0, Math.min(1, progress))));
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
    primary.disabled = state.busy;
    stop.hidden = state.status === 'idle';
    capsuleToggle.replaceChildren(icon(running ? ICONS.pause : ICONS.play));
    capsuleToggle.setAttribute('aria-label', running ? 'Pausar' : 'Retomar');
    capsuleToggle.title = running ? 'Pausar' : 'Retomar';
    capsuleToggle.disabled = state.busy;
    const done = state.cycle % state.settings.longEvery;
    cycles.textContent = `${state.completedToday} ${state.completedToday === 1 ? 'foco hoje' : 'focos hoje'} · ${done} de ${state.settings.longEvery} até a pausa longa`;
    status.textContent = state.error || (state.notice ? NOTICES[state.notice.kind] || '' : '');
    if (shortcut) {
      shortcut.textContent = running ? `Pausar · ${label}` : state.status === 'paused' ? 'Retomar foco' : 'Iniciar foco';
      shortcut.disabled = state.busy;
    }
    layout(state);
  }
  session.subscribe(render);
  window
    .matchMedia('(min-width: 1280px)')
    .addEventListener?.('change', () => layout(session.state()));
}
