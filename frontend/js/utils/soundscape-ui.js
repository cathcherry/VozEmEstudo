// Soundscape interface: a small headphones button in the top bar opens a popover mixer (layer
// toggles with tooltips, sliders, atmosphere presets, master volume, "abaixar durante a aula",
// music link and the mini-player). Nothing plays until the student clicks play (or the one-tap
// resume after changing pages). The same mixer is reused by the mini-player window.
import { LAYERS, PRESETS, parseMusicUrl } from './soundscape-mix.js';
import { createSoundscapeController } from './soundscape-controller.js';
import { toast } from './toast.js';
import { icon as uiIcon } from './icons.js';

/** Soundscape names -> the shared icon set (frontend/js/utils/icons.js, Phosphor duotone). */
export const ICONS = Object.freeze({
  sound: 'listen',
  play: 'play',
  pause: 'pause',
  close: 'close',
  window: 'mini-window',
  rain: 'rain',
  ocean: 'ocean',
  wind: 'wind',
  forest: 'forest',
  fireplace: 'fireplace',
  thunder: 'thunder',
  stream: 'stream',
  crickets: 'crickets',
  library: 'library',
  cafe: 'cafe',
});
const VOLUME_LABEL = {
  rain: 'Volume da chuva',
  ocean: 'Volume das ondas do mar',
  wind: 'Volume do vento',
  forest: 'Volume da floresta',
  fireplace: 'Volume da lareira',
  thunder: 'Volume do trovão distante',
  stream: 'Volume do riacho',
  crickets: 'Volume dos grilos',
  library: 'Volume da biblioteca',
  cafe: 'Volume do café',
};
const LAYER_HINT = {
  rain: 'Chuva',
  ocean: 'Ondas do mar',
  wind: 'Vento',
  forest: 'Floresta (folhas e pássaros)',
  fireplace: 'Lareira (estalos)',
  thunder: 'Trovão distante (raro e suave)',
  stream: 'Riacho',
  crickets: 'Grilos (noite)',
  library: 'Biblioteca (sala e páginas)',
  cafe: 'Café (conversas e xícaras)',
};

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
export function icon(name, size = 18) {
  return uiIcon(ICONS[name], { size });
}
const iconButton = (name, label, className) => {
  const button = make('button', null, className);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(icon(name));
  return button;
};
let uid = 0;

/** The official player for a validated link. Created only after a click (no request before). */
export function musicFrame(link) {
  const frame = document.createElement('iframe');
  frame.className = `soundscape-frame soundscape-frame-${link.provider}`;
  frame.src = link.embedUrl;
  frame.title = link.provider === 'youtube' ? 'Player do YouTube' : 'Player do Spotify';
  frame.loading = 'lazy';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.setAttribute(
    'allow',
    link.provider === 'youtube'
      ? 'encrypted-media; picture-in-picture; fullscreen'
      : 'encrypted-media; clipboard-write; fullscreen; picture-in-picture',
  );
  if (link.provider === 'youtube') frame.allowFullscreen = true;
  return frame;
}

/**
 * The mixer panel bound to a controller.
 * @param {ReturnType<typeof createSoundscapeController>} controller
 * @param {{ headingId: string, onClose?: () => void, onMini?: () => void, variant?: 'popover'|'mini' }} options
 */
export function buildMixer(controller, { headingId, onClose, onMini, variant = 'popover' }) {
  const id = `soundscape-${(uid += 1)}`;
  const root = make('div', null, 'soundscape-mixer');
  const head = make('div', null, 'soundscape-head');
  const title = make('h2', 'Sons ambientes', 'soundscape-title');
  title.id = headingId;
  title.tabIndex = -1;
  const playButton = iconButton('play', 'Tocar sons ambientes', 'soundscape-play');
  playButton.dataset.soundscapePlay = '';
  head.append(title, playButton);
  if (onClose) {
    const close = iconButton('close', 'Fechar mixer', 'soundscape-icon soundscape-close');
    close.addEventListener('click', onClose);
    head.append(close);
  }
  const status = make('p', null, 'soundscape-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  // Presets: a segmented row of native radios (arrow keys move between atmospheres).
  const presets = make('fieldset', null, 'soundscape-presets');
  presets.append(make('legend', 'Atmosfera'));
  const presetRow = make('div', null, 'soundscape-segments');
  const presetInputs = new Map();
  for (const preset of PRESETS) {
    const label = make('label', null, 'soundscape-segment');
    const input = make('input');
    input.type = 'radio';
    input.name = `${id}-preset`;
    input.value = preset.id;
    input.addEventListener('change', () => input.checked && controller.setPreset(preset.id));
    label.append(input, make('span', preset.label));
    presetRow.append(label);
    presetInputs.set(preset.id, input);
  }
  presets.append(presetRow);

  // Layers: icon-only toggles (tooltip and accessible name) with a slider each.
  const layers = make('fieldset', null, 'soundscape-layers');
  layers.append(make('legend', 'Camadas'));
  const grid = make('div', null, 'soundscape-layer-grid');
  const layerControls = new Map();
  for (const layer of LAYERS) {
    const row = make('div', null, 'soundscape-layer');
    row.dataset.layer = layer.id;
    const toggle = iconButton(layer.id, LAYER_HINT[layer.id], 'soundscape-layer-toggle');
    toggle.dataset.soundscapeLayer = layer.id;
    toggle.setAttribute('aria-pressed', 'false');
    const slider = make('input', null, 'soundscape-range');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '5';
    slider.setAttribute('aria-label', VOLUME_LABEL[layer.id]);
    toggle.addEventListener('click', () =>
      controller.setLayer(layer.id, { on: toggle.getAttribute('aria-pressed') !== 'true' }),
    );
    slider.addEventListener('input', () =>
      controller.setLayer(layer.id, { volume: Number(slider.value) / 100 }),
    );
    row.append(toggle, slider);
    grid.append(row);
    layerControls.set(layer.id, { row, toggle, slider });
  }
  layers.append(grid);

  const masterRow = make('div', null, 'soundscape-master');
  const masterLabel = make('label', 'Volume geral');
  const master = make('input', null, 'soundscape-range');
  master.type = 'range';
  master.min = '0';
  master.max = '100';
  master.step = '5';
  master.id = `${id}-master`;
  masterLabel.htmlFor = master.id;
  master.addEventListener('input', () => controller.setMaster(Number(master.value) / 100));
  masterRow.append(masterLabel, master);

  const options = make('div', null, 'soundscape-options');
  const duckLabel = make('label', null, 'soundscape-check');
  const duck = make('input');
  duck.type = 'checkbox';
  duck.dataset.soundscapeDuck = '';
  duck.addEventListener('change', () => controller.setDuck(duck.checked));
  duckLabel.append(duck, make('span', 'Abaixar durante a aula'));
  const focusLabel = make('label', null, 'soundscape-check');
  focusLabel.hidden = true;
  const withFocus = make('input');
  withFocus.type = 'checkbox';
  withFocus.addEventListener('change', () => controller.setWithFocus(withFocus.checked));
  focusLabel.append(withFocus, make('span', 'Tocar junto com o foco'));
  options.append(duckLabel, focusLabel);

  // Music: a pasted YouTube or Spotify link, played by the platform's own embedded player.
  const music = make('details', null, 'soundscape-music');
  music.append(make('summary', 'Música (YouTube ou Spotify)'));
  const form = make('form', null, 'soundscape-music-form');
  form.noValidate = true;
  const urlLabel = make('label', 'Link de playlist, álbum ou vídeo');
  const url = make('input', null, 'soundscape-url');
  url.type = 'url';
  url.id = `${id}-url`;
  url.inputMode = 'url';
  url.autocomplete = 'off';
  url.spellcheck = false;
  url.placeholder = 'https://open.spotify.com/playlist/…';
  urlLabel.htmlFor = url.id;
  const use = make('button', 'Usar link', 'soundscape-small');
  use.type = 'submit';
  const formRow = make('div', null, 'soundscape-music-row');
  formRow.append(url, use);
  const musicError = make('p', null, 'soundscape-error');
  musicError.id = `${id}-url-error`;
  url.setAttribute('aria-describedby', musicError.id);
  form.append(urlLabel, formRow, musicError);
  const embed = make('div', null, 'soundscape-embed');
  const load = make('button', 'Carregar player', 'soundscape-small');
  load.type = 'button';
  load.hidden = true;
  const remove = make('button', 'Remover música', 'soundscape-small soundscape-quiet');
  remove.type = 'button';
  remove.hidden = true;
  const musicActions = make('div', null, 'soundscape-music-row');
  musicActions.append(load, remove);
  const musicNote = make(
    'p',
    'Sem login no Spotify, toca prévias de 30 segundos.',
    'soundscape-note',
  );
  music.append(form, musicActions, embed, musicNote);
  let frameFor = '';
  const showFrame = (link) => {
    embed.replaceChildren(musicFrame(link));
    frameFor = link.url;
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const link = controller.setMusic(url.value);
      musicError.textContent = '';
      url.removeAttribute('aria-invalid');
      url.value = '';
      showFrame(link);
    } catch (failure) {
      musicError.textContent = failure.message;
      url.setAttribute('aria-invalid', 'true');
    }
  });
  load.addEventListener('click', () => {
    const saved = controller.state().mix.music;
    if (saved) showFrame(parseMusicUrl(saved.url));
  });
  remove.addEventListener('click', () => {
    controller.setMusic(null);
    embed.replaceChildren();
    frameFor = '';
  });

  const foot = make('div', null, 'soundscape-foot');
  const note = make('p', null, 'soundscape-note');
  if (onMini) {
    const mini = make('button', null, 'soundscape-small soundscape-mini-button');
    mini.type = 'button';
    mini.dataset.soundscapeMini = '';
    mini.append(icon('window', 16), make('span', 'Abrir mini-player'));
    mini.addEventListener('click', onMini);
    foot.append(mini);
    note.textContent =
      'Ao trocar de página o som para e volta com um toque. No mini-player ele continua sem parar.';
  } else
    note.textContent =
      'Deixe esta janela aberta: o som continua enquanto você navega pelo Voz em Estudo.';
  foot.append(note);

  root.append(head, status, presets, layers, masterRow, options, music, foot);

  function render(state) {
    const { mix } = state;
    const label = state.playing ? 'Pausar sons ambientes' : 'Tocar sons ambientes';
    playButton.replaceChildren(icon(state.playing ? 'pause' : 'play'));
    playButton.setAttribute('aria-label', label);
    playButton.title = label;
    playButton.setAttribute('aria-pressed', String(state.playing));
    for (const [presetId, input] of presetInputs) input.checked = mix.preset === presetId;
    for (const [layerId, control] of layerControls) {
      const layer = mix.layers[layerId];
      control.toggle.setAttribute('aria-pressed', String(layer.on));
      control.row.dataset.on = String(layer.on);
      const value = String(Math.round(layer.volume * 100));
      if (control.slider.value !== value) control.slider.value = value;
    }
    const masterValue = String(Math.round(mix.master * 100));
    if (master.value !== masterValue) master.value = masterValue;
    duck.checked = mix.duck;
    withFocus.checked = mix.withFocus;
    const saved = mix.music?.url || '';
    load.hidden = !saved || frameFor === saved;
    remove.hidden = !saved;
    if (!saved && frameFor) {
      embed.replaceChildren();
      frameFor = '';
    }
    status.textContent = state.error
      ? state.error
      : state.mini
        ? state.playing
          ? 'Tocando no mini-player.'
          : 'Mini-player aberto e em pausa.'
        : state.playing
          ? state.ducked && mix.duck
            ? 'Som mais baixo enquanto a aula toca.'
            : mix.preset
              ? `Tocando: ${PRESETS.find((item) => item.id === mix.preset).label}.`
              : 'Tocando a sua mistura.'
          : '';
    root.dataset.state = state.playing ? (state.ducked && mix.duck ? 'ducked' : 'playing') : 'off';
  }
  playButton.addEventListener('click', () => void controller.toggle());
  controller.subscribe(render);
  return {
    root,
    title,
    showFocusOption() {
      focusLabel.hidden = false;
    },
    variant,
  };
}

/** Adds the soundscape stylesheet once (pages keep their own static links untouched). */
export function ensureStyles(doc = document) {
  if (doc.querySelector('link[data-soundscape-css]')) return;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../../css/soundscape.css', import.meta.url).href;
  link.dataset.soundscapeCss = '';
  doc.head.append(link);
}

/** Lesson audio/video on the page lowers the ambience while it plays. */
export function watchLessonMedia(controller, doc = document) {
  const isMedia = (node) => /^(AUDIO|VIDEO)$/.test(node?.tagName || '');
  const anyPlaying = () =>
    [...doc.querySelectorAll('audio, video')].some((media) => !media.paused && !media.ended);
  doc.addEventListener(
    'play',
    (event) => isMedia(event.target) && controller.setDucked(true),
    true,
  );
  for (const type of ['pause', 'ended', 'emptied'])
    doc.addEventListener(
      type,
      (event) => isMedia(event.target) && !anyPlaying() && controller.setDucked(false),
      true,
    );
  if (anyPlaying()) controller.setDucked(true);
}

let instance = null;
/** The page's soundscape ({ controller, showFocusOption }) once initSoundscape ran, else null. */
export const getSoundscape = () => instance;

/** Mounts the top-bar button and popover for the signed-in account. */
export function initSoundscape({ userId } = {}) {
  if (instance || !userId || !document.body.classList.contains('app-page')) return instance;
  const nav = document.querySelector('.header-navigation');
  if (!nav) return null;
  ensureStyles();
  const controller = createSoundscapeController({ userId });

  const wrap = make('div', null, 'soundscape');
  wrap.dataset.soundscape = '';
  const trigger = iconButton('sound', 'Sons ambientes', 'soundscape-trigger');
  trigger.dataset.soundscapeTrigger = '';
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'soundscape-popover');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.append(make('span', null, 'soundscape-dot'));
  const popover = make('section', null, 'soundscape-popover');
  popover.id = 'soundscape-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-labelledby', 'soundscape-popover-title');
  popover.hidden = true;
  const open = (value) => {
    popover.hidden = !value;
    trigger.setAttribute('aria-expanded', String(value));
    if (value) mixer.title.focus();
  };
  const close = (restore = true) => {
    if (popover.hidden) return;
    open(false);
    if (restore) trigger.focus();
  };
  const mixer = buildMixer(controller, {
    headingId: 'soundscape-popover-title',
    onClose: () => close(),
    onMini: () => openMiniPlayer(),
  });
  popover.append(mixer.root);
  wrap.append(trigger, popover);
  nav.prepend(wrap);

  trigger.addEventListener('click', () => open(popover.hidden));
  popover.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });
  document.addEventListener('click', (event) => {
    // composedPath: the clicked icon may already be replaced (play ↔ pause) when this runs.
    const path = event.composedPath();
    if (!path.includes(wrap) && !path.some((node) => node.classList?.contains('app-toast')))
      close(false);
  });

  function openMiniPlayer() {
    const features = 'popup=yes,width=380,height=660';
    const win = window.open(
      `./mini-player.html#u=${encodeURIComponent(userId)}`,
      'voz-mini-player',
      features,
    );
    if (!win) {
      toast('O navegador bloqueou a janela do mini-player. Permita pop-ups para este site.', {
        type: 'error',
      });
      return;
    }
    controller.handOver();
    close(false);
  }

  controller.subscribe((state) => {
    trigger.dataset.state = state.playing ? 'playing' : state.resumable ? 'resumable' : 'off';
  });
  watchLessonMedia(controller);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void controller.wake();
  });
  window.addEventListener('pageshow', () => void controller.wake());
  window.addEventListener(
    'pagehide',
    () => controller.state().ducked && controller.setDucked(false),
  );

  // Playing on the previous page: offer to continue with one tap (never starts by itself).
  const first = controller.state();
  if (first.resumable)
    toast('Seus sons ambientes estavam tocando. Quer continuar?', {
      action: { label: 'Retomar som', onClick: () => void controller.play() },
      duration: 12000,
    });

  instance = { controller, showFocusOption: () => mixer.showFocusOption(), open: () => open(true) };
  return instance;
}
