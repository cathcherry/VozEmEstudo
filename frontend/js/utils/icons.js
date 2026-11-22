// Functional UI icons (3.6): one licensed pack, one weight, one sprite.
//
// Pack: Phosphor Icons 2.1.1 (MIT, © 2023 Phosphor Icons — https://phosphoricons.com,
// https://github.com/phosphor-icons/core), duotone weight. `npm run icons:build` copies the icons
// named below from node_modules into /assets/icons/sprite.svg (one <symbol id="i-<name>"> each),
// so nothing is fetched from a CDN at runtime. The duotone layer is tinted by the CSS custom
// property --icon-tint (default: the text colour at 20 %); forced-colors mode drops the tint.
//
// The code always uses the SEMANTIC name (left), never the Phosphor name (right): to swap one
// icon, change the right-hand side here and run `npm run icons:build`.
// Illustrated art (discipline emblems, stickers, Lume) lives in the art manifest instead.

export const ICON_SPRITE = '/assets/icons/sprite.svg';

export const ICON_MAP = Object.freeze({
  // App shell and navigation
  create: 'plus',
  home: 'house',
  library: 'books',
  review: 'cards',
  plan: 'calendar-dots',
  focus: 'timer',
  classrooms: 'users-three',
  settings: 'gear-six',
  discoveries: 'notebook',
  cabinet: 'archive',
  menu: 'list',
  appearance: 'palette',
  'focus-mode': 'corners-out',
  search: 'magnifying-glass',
  customize: 'sliders-horizontal',
  desk: 'desk',
  close: 'x',
  more: 'dots-three',
  // Library (Biblioteca)
  open: 'book-open',
  edit: 'pencil-simple',
  organize: 'tag',
  folder: 'folder-simple',
  'folder-add': 'folder-simple-plus',
  questions: 'list-checks',
  add: 'plus-circle',
  remove: 'trash',
  document: 'file-text',
  grid: 'squares-four',
  rows: 'rows',
  filter: 'funnel-simple',
  emblem: 'seal',
  upload: 'upload-simple',
  download: 'download-simple',
  audio: 'waveform',
  video: 'video-camera',
  info: 'info',
  // Study tools, notebook and notes
  note: 'note-pencil',
  highlight: 'highlighter',
  bookmark: 'bookmark-simple',
  quote: 'quotes',
  idea: 'lightbulb',
  flag: 'flag',
  star: 'star',
  check: 'check',
  sparkle: 'sparkle',
  celebrate: 'confetti',
  calendar: 'calendar-blank',
  clock: 'clock',
  // Player, reading aloud and focus timer
  play: 'play',
  pause: 'pause',
  stop: 'stop',
  rewind: 'clock-counter-clockwise',
  forward: 'clock-clockwise',
  speak: 'speaker-high',
  listen: 'headphones',
  expand: 'arrows-out-simple',
  minimize: 'arrows-in-simple',
  fullscreen: 'corners-out',
  trim: 'scissors',
  'full-range': 'brackets-square',
  'mini-window': 'picture-in-picture',
  // Ambient sound layers
  rain: 'cloud-rain',
  ocean: 'waves',
  wind: 'wind',
  forest: 'tree-evergreen',
  fireplace: 'fire',
  thunder: 'cloud-lightning',
  stream: 'drop',
  crickets: 'moon-stars',
  cafe: 'coffee',
  // Discoveries and the cabinet
  evidence: 'seal-check',
  investigation: 'compass',
  connection: 'graph',
  question: 'question',
  lantern: 'lamp',
  leaf: 'leaf',
});

export const ICON_NAMES = Object.freeze(Object.keys(ICON_MAP));
const SVG_NS = 'http://www.w3.org/2000/svg';

const attributes = ({ size = 20, label, className = '' }) => ({
  class: `ui-icon ${className}`.trim(),
  width: String(size),
  height: String(size),
  focusable: 'false',
  ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }),
});

/**
 * An icon as an <svg> element (decorative by default: pass `label` only when nothing else names
 * the control). Unknown names throw in development so a typo never ships as a blank square.
 */
export function icon(name, options = {}) {
  if (!Object.hasOwn(ICON_MAP, name)) throw new Error(`Unknown icon "${name}"`);
  const doc = options.document || globalThis.document;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [key, value] of Object.entries(attributes(options))) svg.setAttribute(key, value);
  svg.dataset.icon = name;
  const use = doc.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `${ICON_SPRITE}#i-${name}`);
  svg.append(use);
  return svg;
}

const escapeAttribute = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** The same icon as an HTML string, for markup built with template literals. */
export function iconMarkup(name, options = {}) {
  if (!Object.hasOwn(ICON_MAP, name)) throw new Error(`Unknown icon "${name}"`);
  const attrs = Object.entries({ ...attributes(options), 'data-icon': name })
    .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
    .join(' ');
  return `<svg ${attrs}><use href="${ICON_SPRITE}#i-${name}"/></svg>`;
}
