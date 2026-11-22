// Scrapbook vocabulary shared by the lesson notebook and the Diário de estudo (3.6 Milestone D):
// covers, papers, page templates and the decorations a page can carry, plus the pure geometry of
// placing them (percent of the page, snapping, keyboard steps). No DOM here: tested in Node.
import { ART, ART_BASE } from '../art/manifest.js';

/** Covers a student may choose (no collectible covers: those come from the Gabinete). */
export const COVER_CHOICES = Object.freeze([
  'cover.cloth-lavender',
  'cover.botanical-press',
  'cover.constellation',
  'cover.field-notes',
  'cover.leather-matcha',
  'cover.marbled-honey',
  'cover.lavender-dots',
  'cover.honey-gingham',
  'cover.mist-marbled',
  'cover.rose-botanical',
  'cover.night-stars',
]);
export const DEFAULT_COVER = 'cover.cloth-lavender';
/** Spine cloth of each cover (the colour of the spine drawn in the cover art). */
const SPINES = {
  'cover.botanical-press': '#7FA36B',
  'cover.cloth-lavender': '#6F60A6',
  'cover.constellation': '#3D3656',
  'cover.field-notes': '#C9A27E',
  'cover.honey-gingham': '#E2B14A',
  'cover.lavender-dots': '#8E7CC3',
  'cover.leather-matcha': '#2E2A3B',
  'cover.marbled-honey': '#B9862A',
  'cover.matcha-linen': '#5E7F4E',
  'cover.mist-marbled': '#7D9DB8',
  'cover.night-stars': '#2A2640',
  'cover.rose-botanical': '#D98A9B',
};
export const spineColor = (cover) => SPINES[cover] || SPINES[DEFAULT_COVER];

/** Papers (materials.css `.paper[data-paper]`), in picker order, with their names. */
export const PAPERS = Object.freeze([
  ['ruled', 'Pautado'],
  ['grid', 'Quadriculado'],
  ['dot', 'Pontilhado'],
  ['linen', 'Linho'],
  ['vellum', 'Vegetal'],
  ['aged', 'Creme envelhecido'],
  ['kraft', 'Kraft'],
]);
export const PAPER_IDS = Object.freeze(PAPERS.map(([id]) => id));

/** Page templates of the diary: a small set of layouts. */
export const TEMPLATES = Object.freeze([
  { id: 'ruled', name: 'Página de caderno', hint: 'Texto corrido em linhas, com uma citação opcional.', paper: 'ruled' },
  { id: 'collage', name: 'Colagem', hint: 'Três fotos com moldura e legenda, e uma nota.', paper: 'kraft' },
  { id: 'concept', name: 'Ficha de conceito', hint: 'Um termo, a definição e um exemplo, numa ficha.', paper: 'grid' },
  { id: 'timeline', name: 'Linha do tempo', hint: 'Até oito momentos em ordem.', paper: 'dot' },
  { id: 'free', name: 'Página livre', hint: 'Uma folha em branco para escrever e decorar.', paper: 'dot' },
]);
export const templateOf = (id) => TEMPLATES.find((item) => item.id === id) || TEMPLATES[0];

export const FRAME_CHOICES = Object.freeze(['frame.polaroid', 'frame.deckle', 'frame.scalloped', 'frame.stamp-border', 'frame.tape-corners']);
export const DIVIDER_CHOICES = Object.freeze(['divider.sprig', 'divider.wave', 'divider.stitch', 'divider.diamond', 'divider.moon-dots']);

/** Empty content of each template (same shape the server validates). */
export function emptyContent(template) {
  switch (template) {
    case 'collage':
      return {
        photos: [
          { caption: '', art: 'sticker.leaf', frame: 'frame.polaroid' },
          { caption: '', art: 'sticker.teacup', frame: 'frame.deckle' },
          { caption: '', art: 'sticker.moon', frame: 'frame.scalloped' },
        ],
        note: '',
      };
    case 'concept':
      return { term: '', definition: '', example: '' };
    case 'timeline':
      return { items: [{ when: '', what: '' }] };
    default:
      return { body: '' };
  }
}

// ---- Decorations -----------------------------------------------------------------------------
export const DECORATION_LIMIT = 24;
export const DECORATION_PATTERN = /^(sticker|tape|stamp|frame|divider|label)\.[a-z0-9]+(-[a-z0-9]+)*$/;
/** Tray tabs, in order. Stamps only appear once the student found some (Gabinete). */
export const DECORATION_KINDS = Object.freeze([
  ['sticker', 'Adesivos'],
  ['tape', 'Fitas'],
  ['frame', 'Molduras'],
  ['label', 'Etiquetas'],
  ['divider', 'Divisores'],
  ['stamp', 'Selos'],
]);
const KIND_NAME = { sticker: 'Adesivo', tape: 'Fita', frame: 'Moldura', label: 'Etiqueta', divider: 'Divisor', stamp: 'Selo' };
/** Width of each kind on the page, in % of the page width (at scale 1). */
export const KIND_WIDTH = Object.freeze({ sticker: 13, stamp: 15, tape: 30, frame: 28, label: 32, divider: 62 });

export const kindOfArt = (art) => String(art).split('.')[0];
export const artSrc = (id) => (ART[id] ? ART_BASE + ART[id].src : '');
export const artTitle = (id) => ART[id]?.title || id;
/** Spoken name: "Adesivo Lua". */
export const decorationName = (art) => `${KIND_NAME[kindOfArt(art)] || 'Decoração'} ${artTitle(art)}`;

/** Art ids of one kind that the student may place (stamps: only the unlocked ones). */
export function decorationChoices(kind, unlockedStamps = []) {
  if (kind === 'stamp') return unlockedStamps.filter((id) => ART[id] && id.startsWith('stamp.'));
  return Object.keys(ART).filter((id) => id.startsWith(`${kind}.`) && DECORATION_PATTERN.test(id));
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Snaps a coordinate (percent): to the page's centre line and quarter lines when close, else to a
 * 1 % grid. Returns a value within 0–100.
 */
export function snap(value, { guides = [25, 50, 75], threshold = 1.6, grid = 1 } = {}) {
  const near = guides.find((guide) => Math.abs(value - guide) <= threshold);
  return clamp(near ?? Math.round(value / grid) * grid, 0, 100);
}

let counter = 0;
/** A new decoration, placed in a free-ish spot (staggered from the centre so they do not stack). */
export function newDecoration(art, existing = []) {
  counter += 1;
  const step = existing.length % 6;
  const kind = kindOfArt(art);
  const tilt = kind === 'tape' ? -6 : kind === 'divider' ? 0 : kind === 'frame' ? 3 : -4;
  return {
    id: `d${Date.now().toString(36)}${counter.toString(36)}`.slice(0, 40),
    art,
    x: clamp(50 + (step % 3 - 1) * 14, 8, 92),
    y: clamp(38 + Math.floor(step / 3) * 16, 8, 92),
    rotation: step % 2 ? -tilt : tilt,
    scale: 1,
  };
}

/** Moves by (dx, dy) percent, clamped to the page. */
export const moveBy = (item, dx, dy) => ({ ...item, x: round(clamp(item.x + dx, 0, 100)), y: round(clamp(item.y + dy, 0, 100)) });
/** Rotates in small steps, wrapping within ±180°. */
export function rotateBy(item, degrees) {
  let rotation = item.rotation + degrees;
  if (rotation > 180) rotation -= 360;
  if (rotation < -180) rotation += 360;
  return { ...item, rotation: round(rotation, 1) };
}
export const scaleBy = (item, delta) => ({ ...item, scale: round(clamp(item.scale + delta, 0.4, 2.5)) });

/**
 * Keyboard alternative to dragging. Returns { item } (changed), { remove: true } or null when the
 * key is not a decoration key. Arrows move 1 % (Shift: 5 %), R rotates 5° (Shift+R: back),
 * + / − resize, Delete or Backspace removes.
 */
export function keyAction(item, { key, shiftKey = false } = {}) {
  const step = shiftKey ? 5 : 1;
  switch (key) {
    case 'ArrowLeft':
      return { item: moveBy(item, -step, 0) };
    case 'ArrowRight':
      return { item: moveBy(item, step, 0) };
    case 'ArrowUp':
      return { item: moveBy(item, 0, -step) };
    case 'ArrowDown':
      return { item: moveBy(item, 0, step) };
    case 'r':
    case 'R':
      return { item: rotateBy(item, shiftKey || key === 'R' ? -5 : 5) };
    case '+':
    case '=':
      return { item: scaleBy(item, 0.1) };
    case '-':
    case '_':
      return { item: scaleBy(item, -0.1) };
    case 'Delete':
    case 'Backspace':
      return { remove: true };
    default:
      return null;
  }
}

/** Keeps only well-formed decorations within the limit (defence against an old or edited copy). */
export function sanitizeDecorations(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && DECORATION_PATTERN.test(item.art) && ART[item.art] && /^[A-Za-z0-9_-]{1,40}$/.test(item.id) && !seen.has(item.id) && seen.add(item.id))
    .slice(0, DECORATION_LIMIT)
    .map((item) => ({
      id: item.id,
      art: item.art,
      x: round(clamp(Number(item.x) || 0, 0, 100)),
      y: round(clamp(Number(item.y) || 0, 0, 100)),
      rotation: round(clamp(Number(item.rotation) || 0, -180, 180), 1),
      scale: round(clamp(Number(item.scale) || 1, 0.4, 2.5)),
    }));
}

/** True when the page should be shown without decoration (quiet mode, or the viewer chose so). */
export function decorationHidden(root = globalThis.document?.documentElement) {
  return root?.dataset?.experience === 'quiet' || root?.dataset?.scrapbookPlain === 'true';
}
/** Reduced motion from the system or the app's own settings. */
export function motionReduced(root = globalThis.document?.documentElement) {
  const data = root?.dataset || {};
  if (data.reducedMotion === 'true' || data.lowStimulation === 'true' || data.motion === 'off') return true;
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}
