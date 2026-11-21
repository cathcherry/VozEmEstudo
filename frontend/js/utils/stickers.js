// Original stickers (drawn for Voz em Estudo, no third-party art): decorative SVGs shown next to
// each page title, never over content. Chosen in Aparência › Estúdio visual (up to 3), saved in
// the synced UI preferences (`stickers`), hidden with fewer visual stimuli or screen reader mode.

const face = (x, y, s = 1) =>
  `<circle cx="${x - 5 * s}" cy="${y}" r="${1.7 * s}" fill="#3b2f3f"/><circle cx="${x + 5 * s}" cy="${y}" r="${1.7 * s}" fill="#3b2f3f"/>` +
  `<path d="M${x - 2 * s} ${y + 3 * s} q${2 * s} ${2 * s} ${4 * s} 0" stroke="#3b2f3f" stroke-width="${1.4 * s}" fill="none" stroke-linecap="round"/>` +
  `<ellipse cx="${x - 9 * s}" cy="${y + 3 * s}" rx="${2.4 * s}" ry="${1.5 * s}" fill="#f59fb3" opacity=".7"/><ellipse cx="${x + 9 * s}" cy="${y + 3 * s}" rx="${2.4 * s}" ry="${1.5 * s}" fill="#f59fb3" opacity=".7"/>`;

// White "die-cut" border: every shape is stroked in white under its own fill (paint-order).
const ART = {
  star: {
    name: 'Estrela',
    svg: `<path d="M32 6l7.6 15.6 17.2 2.4-12.4 12.1 3 17.1L32 45.1 16.6 53.2l3-17.1L7.2 24l17.2-2.4z" fill="#f7dd8a" stroke="#fff" stroke-width="5" stroke-linejoin="round" paint-order="stroke"/>${face(32, 31, 0.9)}`,
  },
  heart: {
    name: 'Coração',
    svg: `<path d="M32 55S8 41 8 24c0-8 6-14 13-14 5 0 9 3 11 7 2-4 6-7 11-7 7 0 13 6 13 14 0 17-24 31-24 31z" fill="#f6b3c6" stroke="#fff" stroke-width="5" stroke-linejoin="round" paint-order="stroke"/>${face(32, 29, 0.9)}`,
  },
  matcha: {
    name: 'Matcha',
    svg: `<path d="M12 26h40l-4 24c-1 4-4 6-8 6H24c-4 0-7-2-8-6z" fill="#fbf6ea" stroke="#fff" stroke-width="5" stroke-linejoin="round" paint-order="stroke"/><path d="M12 26h40l-1.4 8H13.4z" fill="#9cc58a"/><path d="M52 31c6 0 8 4 6 8s-6 5-9 4" fill="none" stroke="#e9dfc9" stroke-width="3.5" stroke-linecap="round"/><path d="M26 18c-2-3 2-5 0-9M36 18c-2-3 2-5 0-9" stroke="#c9bfe8" stroke-width="2.4" fill="none" stroke-linecap="round"/>${face(32, 42, 0.75)}`,
  },
  cloud: {
    name: 'Nuvem',
    svg: `<path d="M18 48c-7 0-11-5-11-10s4-10 10-10c1-8 8-13 15-13 8 0 14 5 15 12 6 0 10 5 10 11s-5 10-11 10z" fill="#e6ddfb" stroke="#fff" stroke-width="5" stroke-linejoin="round" paint-order="stroke"/>${face(32, 35, 0.85)}`,
  },
  leaf: {
    name: 'Folha',
    svg: `<path d="M12 52C10 30 24 12 54 10c1 26-14 42-38 42z" fill="#a9d18e" stroke="#fff" stroke-width="5" stroke-linejoin="round" paint-order="stroke"/><path d="M14 50C24 38 34 28 48 17" stroke="#7aae62" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
  },
  sparkle: {
    name: 'Brilho',
    svg: `<path d="M32 5c2 14 6 21 23 27-17 6-21 13-23 27-2-14-6-21-23-27 17-6 21-13 23-27z" fill="#cdb9f5" stroke="#fff" stroke-width="5" stroke-linejoin="round" paint-order="stroke"/><circle cx="52" cy="12" r="4" fill="#f7dd8a" stroke="#fff" stroke-width="3" paint-order="stroke"/>`,
  },
  book: {
    name: 'Livro',
    svg: `<path d="M6 16c9-3 18-2 26 4 8-6 17-7 26-4v34c-9-3-18-2-26 4-8-6-17-7-26-4z" fill="#bcd9f2" stroke="#fff" stroke-width="5" stroke-linejoin="round" paint-order="stroke"/><path d="M32 20v34" stroke="#8fb6d8" stroke-width="2.4"/><path d="M12 25c5-1 10 0 14 2M12 32c5-1 10 0 14 2M38 27c4-2 9-3 14-2M38 34c4-2 9-3 14-2" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`,
  },
  pencil: {
    name: 'Lápis',
    svg: `<path d="M44 8l12 12-30 30-15 3 3-15z" fill="#f9c98f" stroke="#fff" stroke-width="5" stroke-linejoin="round" paint-order="stroke"/><path d="M44 8l12 12-5 5-12-12z" fill="#f6b3c6"/><path d="M14 38l12 12-15 3z" fill="#fbecd2"/><path d="M11 49l3 1-3 3z" fill="#3b2f3f"/>`,
  },
};

export const STICKERS = Object.freeze(Object.keys(ART));
export const STICKER_MAX = 3;
export const stickerName = (kind) => ART[kind]?.name || kind;

/** Known kinds only, no repeats, at most STICKER_MAX. */
export function normalizeStickers(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.filter((kind) => STICKERS.includes(kind)))].slice(0, STICKER_MAX);
}

/** An <svg> for `kind` (decorative unless `label` is given). */
export function stickerSvg(kind, { label = '' } = {}) {
  const art = ART[kind];
  if (!art) return null;
  const template = document.createElement('template');
  // Fixed, trusted markup from this module (no user input reaches it).
  template.innerHTML = `<svg viewBox="0 0 64 64" class="sticker" data-sticker="${kind}">${art.svg}</svg>`;
  const svg = template.content.firstElementChild;
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg;
}

/** Places the chosen stickers after the page's main title (and removes them when none). */
export function renderPageStickers(kinds, root = document) {
  const title = root.querySelector('main h1');
  root.querySelectorAll('.page-stickers').forEach((node) => node.remove());
  const list = normalizeStickers(kinds);
  if (!title || !list.length) return null;
  const holder = document.createElement('span');
  holder.className = 'page-stickers';
  holder.setAttribute('aria-hidden', 'true');
  for (const kind of list) holder.append(stickerSvg(kind));
  title.append(holder);
  return holder;
}
