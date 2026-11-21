// Shared palette and SVG helpers for the original Voz em Estudo art set.
// Every value here comes from docs/ART_DIRECTION_AND_ASSETS.md (the style guide).

export const C = Object.freeze({
  ink: '#2E2A3B',
  inkSoft: '#5B5470',
  paper: '#F7F5FB',
  white: '#FFFFFF',
  lavender: '#8E7CC3',
  lavenderMid: '#AE9FDB',
  lavenderLight: '#CFC5EC',
  lavenderPale: '#ECE8F7',
  lavenderDeep: '#6F60A6',
  matcha: '#7FA36B',
  matchaLight: '#B5CDA4',
  matchaPale: '#E3EDDA',
  matchaDeep: '#5E7F4E',
  honey: '#E2B14A',
  honeyLight: '#F1D38C',
  honeyPale: '#FAEDCB',
  honeyDeep: '#B9862A',
  mist: '#A9C4D9',
  mistLight: '#D3E2EE',
  mistPale: '#EAF1F7',
  mistDeep: '#7D9DB8',
  rose: '#D98A9B',
  roseLight: '#EDBDC7',
  rosePale: '#F8E4E8',
  roseDeep: '#B86A7C',
  wood: '#C9A27E',
  woodLight: '#E2C6A8',
  woodDeep: '#9C7656',
  night: '#3D3656',
  nightDeep: '#2A2640',
});

/** The ink line: thin, continuous, rounded, slightly translucent so it never reads as pure black. */
export const line = (width = 2, color = C.ink, opacity = 0.88) =>
  `stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${opacity}"`;

export const MARK = 'voz-art:generated';

export function svg({ id, width, height, body, defs = '', extra = '' }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" fill="none"${extra}>
<!-- ${MARK} | id: ${id} | original art, Voz em Estudo (same terms as the project). Made with scripts/art/build-art.mjs; a replaced file without this marker is never overwritten. -->
${defs ? `<defs>${defs}</defs>\n` : ''}${body.trim()}
</svg>
`;
}

/** Soft contact shadow under an object standing on the desk. */
export const groundShadow = (cx, cy, rx, ry = rx * 0.14, opacity = 0.12) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry.toFixed(1)}" fill="${C.ink}" opacity="${opacity}"/>`;

/** Round postage-stamp edge with perforation bites (no mask, so the bites stay transparent). */
export function perforatedCircle(cx, cy, r, count = 28, bite = 3.4) {
  const step = (Math.PI * 2) / count;
  const half = Math.asin(bite / r);
  const pt = (a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  let d = '';
  for (let i = 0; i < count; i += 1) {
    const a = i * step - Math.PI / 2;
    if (i === 0) d += `M${pt(a + half)}`;
    d += ` A${r} ${r} 0 0 1 ${pt(a + step - half)} A${bite} ${bite} 0 0 0 ${pt(a + step + half)}`;
  }
  return `${d} Z`;
}

/** A 4-point sparkle, for lantern light and small celebrations. */
export function sparkle(x, y, s, fill = C.honey, extra = '') {
  const k = s * 0.16;
  return `<path${extra} d="M${x} ${y - s} Q${x + k} ${y - k} ${x + s} ${y} Q${x + k} ${y + k} ${x} ${y + s} Q${x - k} ${y + k} ${x - s} ${y} Q${x - k} ${y - k} ${x} ${y - s} Z" fill="${fill}"/>`;
}

export const round = (n) => Number(n.toFixed(2));
