// Notebook covers (240 × 320, 3:4): page block, cloth spine, a surface pattern, a blank label
// plate and an elastic band. No text: the app writes the notebook title over the label.
import { C, line, svg, sparkle } from './lib.mjs';

const W = 240;
const H = 320;
const BODY = 'M18 6 H222 A10 10 0 0 1 232 16 V304 A10 10 0 0 1 222 314 H18 Z';

function cover({ base, spine, band, label = C.paper, pattern, defs, extra = '' }) {
  return {
    defs: `<clipPath id="cover-clip"><path d="${BODY}"/></clipPath>${defs}`,
    body: `<rect x="22" y="10" width="214" height="308" rx="9" fill="${C.paper}" ${line(1.6)}/>
  <path d="M230 22 V306 M233 26 V302" ${line(1, C.lavender, 0.35)}/>
  <path d="${BODY}" fill="${base}"/>
  <g clip-path="url(#cover-clip)">
    ${pattern}
    <path d="M232 200 V314 H120 Q200 290 232 200 Z" fill="${C.ink}" opacity="0.06"/>
  </g>
  <path d="M8 16 A10 10 0 0 1 18 6 H40 V314 H18 A10 10 0 0 1 8 304 Z" fill="${spine}" ${line(1.8)}/>
  <path d="M33 14 V306" ${line(1.2, C.paper, 0.7)} stroke-dasharray="4 4"/>
  <path d="${BODY}" ${line(1.8)}/>
  <rect x="78" y="62" width="112" height="50" rx="7" fill="${label}" ${line(1.6)}/>
  <rect x="84" y="68" width="100" height="38" rx="4" ${line(1, C.lavender, 0.45)}/>
  <rect x="200" y="6" width="10" height="308" fill="${band}" ${line(1.6)}/>
  <path d="M203 6 V314" ${line(1.2, C.white, 0.35)}/>
  ${extra}`,
  };
}

const COVERS = {
  'matcha-linen': cover({
    base: C.matcha,
    spine: C.matchaDeep,
    band: C.honey,
    defs: `<pattern id="weave" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 1.5 H6 M0 4.5 H6" stroke="${C.matchaLight}" stroke-width="1" opacity="0.5"/><path d="M1.5 0 V6 M4.5 0 V6" stroke="${C.matchaDeep}" stroke-width="0.8" opacity="0.35"/></pattern>`,
    pattern: `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#weave)"/>`,
    extra: `<path d="M64 250 Q80 230 100 240 Q88 258 64 250 Z M90 268 Q110 252 126 266 Q108 280 90 268 Z" fill="${C.matchaLight}" ${line(1.4)}/><path d="M60 274 Q90 252 140 262" ${line(1.4, C.matchaDeep)}/>`,
  }),
  'lavender-dots': cover({
    base: C.lavenderMid,
    spine: C.lavender,
    band: C.rose,
    defs: `<pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="6" cy="6" r="2.6" fill="${C.paper}" opacity="0.8"/><circle cx="18" cy="18" r="2.6" fill="${C.lavenderPale}" opacity="0.7"/></pattern>`,
    pattern: `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#dots)"/>`,
  }),
  'honey-gingham': cover({
    base: C.honeyPale,
    spine: C.honey,
    band: C.lavenderDeep,
    defs: `<pattern id="gingham" width="28" height="28" patternUnits="userSpaceOnUse"><rect width="14" height="28" fill="${C.honey}" opacity="0.32"/><rect width="28" height="14" fill="${C.honey}" opacity="0.32"/></pattern>`,
    pattern: `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#gingham)"/>`,
  }),
  'mist-marbled': cover({
    base: C.mist,
    spine: C.mistDeep,
    band: C.honey,
    defs: '',
    pattern: [0, 1, 2, 3, 4, 5, 6]
      .map((i) => {
        const y = 20 + i * 46;
        const color = [C.mistLight, C.white, C.lavenderLight][i % 3];
        return `<path d="M0 ${y} C40 ${y - 26} 70 ${y + 30} 120 ${y + 4} S200 ${y - 22} 250 ${y + 10}" stroke="${color}" stroke-width="${10 - (i % 3) * 3}" stroke-linecap="round" opacity="0.7"/>
    <path d="M0 ${y + 16} C50 ${y - 4} 80 ${y + 40} 130 ${y + 18} S210 ${y} 250 ${y + 24}" stroke="${C.mistDeep}" stroke-width="1.2" opacity="0.4"/>`;
      })
      .join('\n    '),
  }),
  'rose-botanical': cover({
    base: C.rosePale,
    spine: C.rose,
    band: C.matcha,
    defs: `<pattern id="sprig" width="56" height="56" patternUnits="userSpaceOnUse"><path d="M10 44 Q20 30 34 22" stroke="${C.matchaDeep}" stroke-width="1.2" stroke-linecap="round" opacity="0.8"/><path d="M18 36 Q10 30 12 24 Q20 28 19 35 Z M26 28 Q28 20 34 18 Q34 26 27 29 Z" fill="${C.matchaLight}"/><circle cx="36" cy="20" r="3.2" fill="${C.rose}"/><circle cx="46" cy="48" r="1.8" fill="${C.roseLight}"/></pattern>`,
    pattern: `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#sprig)"/>`,
  }),
  'night-stars': cover({
    base: C.night,
    spine: C.nightDeep,
    band: C.honey,
    label: C.honeyPale,
    defs: '',
    pattern: `${[
      [60, 150, 3],
      [110, 180, 2],
      [170, 140, 3.5],
      [90, 230, 2.5],
      [150, 250, 2],
      [190, 210, 3],
      [70, 290, 2],
      [130, 30, 2.5],
      [180, 34, 2],
      [60, 36, 2],
    ]
      .map(([x, y, s], i) => sparkle(x, y, s * 1.6, i % 3 ? C.lavenderLight : C.honeyLight))
      .join('')}
    <path d="M168 266 A22 22 0 1 0 190 296 A16 16 0 1 1 168 266 Z" fill="${C.honeyLight}" opacity="0.9"/>`,
  }),
};

export const COVER_IDS = Object.keys(COVERS);

export function coverFiles() {
  const files = {};
  for (const [name, { body, defs }] of Object.entries(COVERS))
    files[`covers/${name}.svg`] = svg({ id: `cover.${name}`, width: W, height: H, body, defs });
  return files;
}
