// Aparência › "Seu espaço de estudo" (3.5, Milestone 5): the Creative Studio.
// Simple view: the eight atmospheres as preview tiles (each tile is drawn from the atmosphere's
// own colours, so it shows what you will get whatever the current theme is). Studio view: the
// details, with a live preview that uses the page's real tokens (every choice applies at once).
// Static radios with data-ui-setting are saved by preferences.js; this module renders the rest.
import { getUiPreferences, setUiPreference, setUiPreferences } from '../utils/preferences.js';
import {
  ATMOSPHERES,
  LUME_OUTFIT_CHOICES,
  NOTEBOOK_COVERS,
  availableCovers,
  availableOutfits,
  choosePreferences,
  getAtmosphere,
  resolveAtmosphere,
} from '../utils/atmospheres.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { getSoundscape } from '../utils/soundscape-ui.js';
import * as discoveryApi from '../api/discovery.api.js';

const $ = (selector, root = document) => root.querySelector(selector);
const VIEW_KEY = 'voz-studio-view';
const ART = '/assets/art/';
const wallpaperSrc = (id) => `${ART}wallpapers/${id.replace(/^wallpaper\./, '')}.svg`;
let unlocks = [];

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.filter(Boolean));
  return node;
}

function status(text) {
  const box = $('[data-studio-status]');
  box.textContent = '';
  requestAnimationFrame(() => (box.textContent = text));
}

const look = () =>
  resolveAtmosphere(getUiPreferences(), {
    theme: document.documentElement.dataset.theme,
    available: { covers: availableCovers(unlocks), outfits: availableOutfits(unlocks) },
  });

// ---- Choosing an atmosphere ---------------------------------------------------------------

function chooseAtmosphere(id) {
  const atmosphere = getAtmosphere(id);
  const appearance = window.VozAppearance;
  // The atmosphere's colours need its base theme (light paper or the night).
  if (appearance.loadAppearance().theme !== atmosphere.base)
    appearance.saveAppearance({ ...appearance.loadAppearance(), theme: atmosphere.base });
  setUiPreferences(choosePreferences(id));
  // Aparência's other controls (Temas prontos) re-read the saved look.
  window.dispatchEvent(new Event('voz-preferences-change'));
  status(`Atmosfera ${atmosphere.name} aplicada.`);
  sync();
}

/** The atmosphere's sound is offered, never played on its own: one click starts it. */
function renderSoundOffer() {
  const box = $('[data-studio-sound]');
  const atmosphere = getAtmosphere(getUiPreferences().atmosphere);
  const sound = getSoundscape();
  if (!sound) {
    box.replaceChildren();
    return;
  }
  const button = el('button', { type: 'button', className: 'text-action studio-sound-play' });
  button.append(
    el('span', { className: 'studio-sound-icon', 'aria-hidden': 'true' }),
    document.createTextNode(`Ouvir a mistura sonora ${atmosphere.name}`),
  );
  button.addEventListener('click', () => {
    sound.controller.setPreset(atmosphere.soundscape);
    void sound.controller.play();
    status(`Tocando a mistura ${atmosphere.name}. Pause pelo botão de sons no topo da página.`);
  });
  box.replaceChildren(button);
}

// ---- Simple view: tiles ------------------------------------------------------------------

function tile(atmosphere) {
  const p = atmosphere.palette;
  const accent = atmosphere.accents[0];
  const button = el('button', { type: 'button', className: 'atmosphere-tile', 'aria-pressed': 'false' });
  button.dataset.atmosphere = atmosphere.id;
  for (const [name, value] of Object.entries({
    '--t-bg': p.background,
    '--t-surface': p.surface,
    '--t-text': p.text,
    '--t-muted': p.muted,
    '--t-line': p.border,
    '--t-accent': atmosphere.base === 'night' ? accent.accent : accent.strong,
    '--t-on-accent': accent.contrast || '#ffffff',
    '--t-wall': atmosphere.desk.wall,
    '--t-desk': atmosphere.desk.top,
    '--t-edge': atmosphere.desk.edge,
  }))
    button.style.setProperty(name, value);
  const scene = el(
    'span',
    { className: 'atmosphere-tile-scene', 'aria-hidden': 'true' },
    el('span', { className: 'atmosphere-tile-window' }, el('img', { src: wallpaperSrc(atmosphere.wallpaper), alt: '', loading: 'lazy', decoding: 'async' })),
    el('img', { className: 'atmosphere-tile-cup', src: `${ART}objects/teacup.svg`, alt: '', loading: 'lazy' }),
    el(
      'span',
      { className: 'atmosphere-tile-sheet' },
      el('span', { className: 'atmosphere-tile-title', text: 'Fotossíntese' }),
      el('span', { className: 'atmosphere-tile-line' }),
      el('span', { className: 'atmosphere-tile-line is-short' }),
      el('span', { className: 'atmosphere-tile-button', text: 'Continuar' }),
    ),
  );
  button.append(
    scene,
    el('span', { className: 'atmosphere-tile-copy' }, el('strong', { text: atmosphere.name }), el('small', { text: atmosphere.description })),
    el('span', { className: 'atmosphere-tile-mark', 'aria-hidden': 'true' }),
  );
  button.addEventListener('click', () => chooseAtmosphere(atmosphere.id));
  return button;
}

// ---- Studio view -------------------------------------------------------------------------

function radio(name, value, checked, label, onChange, extra) {
  const input = el('input', { className: 'segment-input', type: 'radio', name, value });
  input.checked = checked;
  input.addEventListener('change', () => input.checked && onChange(value));
  return el('label', {}, input, extra, el('span', { text: label }));
}

function renderDetail() {
  const prefs = getUiPreferences();
  const current = look();
  const select = $('[data-studio-atmosphere]');
  if (!select.options.length) {
    for (const atmosphere of ATMOSPHERES) select.append(new Option(atmosphere.name, atmosphere.id));
    select.addEventListener('change', () => chooseAtmosphere(select.value));
  }
  select.value = current.atmosphere.id;
  $('[data-studio-accents]').replaceChildren(
    ...current.atmosphere.accents.map((accent) => {
      const swatch = el('i', { className: 'accent-swatch', 'aria-hidden': 'true' });
      swatch.style.background = current.atmosphere.base === 'night' ? accent.accent : accent.strong;
      return radio('studio-accent', accent.id, accent.id === current.accent.id, accent.name, (value) => {
        setUiPreference('atmosphereAccent', value);
        status(`Cor de destaque: ${accent.name}.`);
      }, swatch);
    }),
  );
  const outfits = availableOutfits(unlocks);
  const outfitChoice = prefs.lumeOutfit || 'auto';
  const auto = current.atmosphere.outfit
    ? `Da atmosfera (${LUME_OUTFIT_CHOICES.find(([id]) => id === current.atmosphere.outfit)[1].toLocaleLowerCase('pt-BR')})`
    : 'Da atmosfera (sem roupa)';
  $('[data-studio-outfits]').replaceChildren(
    el(
      'div',
      { className: 'segmented-control segmented-wrap' },
      radio('studio-outfit', 'auto', outfitChoice === 'auto', auto, (v) => setUiPreference('lumeOutfit', v)),
      radio('studio-outfit', 'none', outfitChoice === 'none', 'Sem roupa', (v) => setUiPreference('lumeOutfit', v)),
      ...LUME_OUTFIT_CHOICES.filter(([id]) => outfits.includes(id)).map(([id, name]) =>
        radio('studio-outfit', id, outfitChoice === id, name, (v) => setUiPreference('lumeOutfit', v)),
      ),
    ),
  );
  const covers = availableCovers(unlocks);
  const coverChoice = prefs.notebookCover && prefs.notebookCover !== 'auto' ? prefs.notebookCover : 'auto';
  $('[data-studio-covers]').replaceChildren(
    ...[['auto', 'Da atmosfera'], ...NOTEBOOK_COVERS.filter(([id]) => covers.includes(id))].map(([id, name]) => {
      const input = el('input', { type: 'radio', name: 'studio-cover', value: id, className: 'cover-input' });
      input.checked = coverChoice === id;
      input.addEventListener('change', () => input.checked && setUiPreference('notebookCover', id));
      const art = id === 'auto' ? current.cover : id;
      return el(
        'label',
        { className: 'cover-option' },
        input,
        el('img', { src: `${ART}covers/${art.replace(/^cover\./, '')}.svg`, alt: '', width: 48, height: 64, loading: 'lazy' }),
        el('span', { text: name }),
      );
    }),
  );
}

function renderPreview() {
  const current = look();
  const img = $('[data-preview-wallpaper]');
  if (current.wallpaper) {
    img.src = wallpaperSrc(current.wallpaper);
    img.hidden = false;
  } else img.hidden = true;
  $('[data-preview-weather]').dataset.motion = current.motion || 'none';
  const lume = $('[data-preview-lume]');
  if (current.outfit) lume.dataset.artOutfit = current.outfit;
  else delete lume.dataset.artOutfit;
  $('[data-preview-cover]').dataset.artId = current.cover;
  $('[data-studio-preview]').dataset.decor = current.decoration;
}

function sync() {
  const id = getAtmosphere(getUiPreferences().atmosphere).id;
  for (const button of document.querySelectorAll('.atmosphere-tile'))
    button.setAttribute('aria-pressed', String(button.dataset.atmosphere === id));
  renderDetail();
  renderPreview();
  renderSoundOffer();
}

function setView(view) {
  const studio = view === 'studio';
  $('[data-studio-simple]').hidden = studio;
  $('[data-studio-detail]').hidden = !studio;
  for (const input of document.querySelectorAll('input[name="studio-view"]')) input.checked = input.value === view;
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* the view is a convenience */
  }
}

function init() {
  const host = $('[data-creative-studio]');
  if (!host) return;
  $('[data-atmosphere-tiles]').replaceChildren(...ATMOSPHERES.map(tile));
  for (const input of document.querySelectorAll('input[name="studio-view"]'))
    input.addEventListener('change', () => input.checked && setView(input.value));
  let view = 'simple';
  try {
    view = localStorage.getItem(VIEW_KEY) === 'studio' ? 'studio' : 'simple';
  } catch {
    /* default view */
  }
  if (location.hash === '#estudio-detalhes') view = 'studio';
  setView(view);
  sync();
  window.addEventListener('voz-ui-preferences-change', sync);
  // The soundscape mounts with the signed-in shell; offer the sound once it exists.
  setTimeout(renderSoundOffer, 600);
  void getFeatureFlags()
    .then(async (flags) => {
      if (!flags.discoveries) return;
      unlocks = (await discoveryApi.getCollection()).unlocks || [];
      sync();
    })
    .catch(() => {});
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
