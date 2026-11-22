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
  // ---- 3.6: material covers (cloth, leather, marbled paper, pressed plants, field notes) ----
  'cloth-lavender': cover({
    base: C.lavenderMid,
    spine: C.lavenderDeep,
    band: C.matcha,
    defs: `<pattern id="cloth" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 1 H4" stroke="${C.lavenderLight}" stroke-width="0.9" opacity="0.55"/><path d="M1 0 V4" stroke="${C.lavenderDeep}" stroke-width="0.7" opacity="0.3"/></pattern>`,
    pattern: `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#cloth)"/>
    <path d="M50 16 H222 M50 308 H222" ${line(1.2, C.lavenderPale, 0.6)} stroke-dasharray="5 4"/>`,
    extra: `<path d="M134 150 L138 160 L148 162 L140 168 L142 178 L134 172 L126 178 L128 168 L120 162 L130 160 Z" fill="${C.lavenderDeep}" opacity="0.55"/>`,
  }),
  'leather-matcha': cover({
    base: C.matchaDeep,
    spine: C.ink,
    band: C.honeyDeep,
    label: C.honeyPale,
    defs: `<pattern id="grain" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r="0.8" fill="${C.matchaLight}" opacity="0.22"/><circle cx="6.5" cy="7" r="0.7" fill="${C.ink}" opacity="0.2"/><circle cx="7" cy="1.5" r="0.5" fill="${C.matchaLight}" opacity="0.18"/></pattern>`,
    pattern: `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#grain)"/>
    <rect x="52" y="20" width="166" height="282" rx="6" ${line(1.4, C.honeyLight, 0.75)} stroke-dasharray="4 4"/>
    <path d="M40 6 H232 V40" ${line(10, C.ink, 0.08)}/>`,
    extra: `<rect x="78" y="62" width="112" height="50" rx="7" ${line(2.4, C.ink, 0.18)}/>
    <path d="M120 236 Q134 214 148 236 Q134 258 120 236 Z" fill="${C.matcha}" ${line(1.4, C.honeyLight, 0.8)}/><path d="M134 222 V250" ${line(1.2, C.honeyLight, 0.8)}/>`,
  }),
  'marbled-honey': cover({
    base: C.honeyPale,
    spine: C.honeyDeep,
    band: C.lavenderDeep,
    defs: '',
    pattern: [0, 1, 2, 3, 4, 5, 6, 7]
      .map((i) => {
        const y = 10 + i * 40;
        const color = [C.honeyLight, C.roseLight, C.white, C.honey][i % 4];
        return `<path d="M0 ${y} C30 ${y + 24} 60 ${y - 20} 110 ${y + 6} S190 ${y + 30} 250 ${y - 6}" stroke="${color}" stroke-width="${12 - (i % 4) * 2}" stroke-linecap="round" opacity="0.75"/>
    <path d="M0 ${y + 14} C40 ${y + 34} 80 ${y - 6} 130 ${y + 20} S210 ${y + 36} 250 ${y + 10}" stroke="${C.honeyDeep}" stroke-width="1" opacity="0.45"/>`;
      })
      .join('\n    '),
  }),
  'botanical-press': cover({
    base: C.paper,
    spine: C.matcha,
    band: C.rose,
    defs: '',
    pattern: `<path d="M150 296 Q140 230 160 150" ${line(1.8, C.matchaDeep)}/>
    ${[
      [158, 160, 1],
      [154, 184, 1.1],
      [150, 208, 1.2],
      [147, 232, 1.25],
      [146, 256, 1.2],
    ]
      .map(
        ([x, y, s]) =>
          `<path d="M${x} ${y} q${-22 * s} ${-4 * s} ${-30 * s} ${-16 * s} q${16 * s} ${-2 * s} ${30 * s} ${16 * s} Z M${x} ${y} q${20 * s} ${2 * s} ${30 * s} ${-12 * s} q${-16 * s} ${-4 * s} ${-30 * s} ${12 * s} Z" fill="${C.matchaLight}" ${line(1.2, C.matchaDeep, 0.8)}/>`,
      )
      .join('')}
    <g ${line(1.2)}><circle cx="92" cy="232" r="9" fill="${C.roseLight}"/><circle cx="92" cy="232" r="3.4" fill="${C.honey}"/><circle cx="104" cy="262" r="6" fill="${C.lavenderLight}"/></g>
    <path d="M92 241 Q96 270 100 296 M104 268 Q102 284 100 296" ${line(1.2, C.matchaDeep)}/>
    <path d="M70 150 l14 -6 l4 8 l-14 6 Z M178 280 l12 4 l-3 9 l-12 -4 Z" fill="${C.mistLight}" opacity="0.8"/>`,
  }),
  constellation: cover({
    base: C.nightDeep,
    spine: C.night,
    band: C.lavender,
    label: C.lavenderPale,
    defs: '',
    pattern: `<path d="M70 160 L104 182 L140 168 L172 196 L160 240 L118 250 L104 182 M172 196 L206 176" ${line(1, C.lavenderLight, 0.55)}/>
    ${[
      [70, 160, 3],
      [104, 182, 4],
      [140, 168, 3],
      [172, 196, 4.4],
      [160, 240, 3],
      [118, 250, 3.4],
      [206, 176, 2.6],
      [80, 270, 2],
      [196, 290, 2],
      [60, 30, 2],
      [200, 36, 2.4],
    ]
      .map(([x, y, s], i) => sparkle(x, y, s * 1.5, i % 3 ? C.honeyLight : C.lavenderLight))
      .join('')}
    <circle cx="190" cy="252" r="1.2" fill="${C.white}"/><circle cx="90" cy="216" r="1.2" fill="${C.white}"/><circle cx="130" cy="290" r="1" fill="${C.white}"/>`,
  }),
  'field-notes': cover({
    base: C.woodLight,
    spine: C.wood,
    band: C.ink,
    defs: `<pattern id="fibre" width="16" height="10" patternUnits="userSpaceOnUse"><path d="M1 3 h6 M9 8 h5" stroke="${C.woodDeep}" stroke-width="0.6" opacity="0.25"/></pattern>`,
    pattern: `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#fibre)"/>
    <path d="M60 150 H186 M60 168 H186 M60 186 H150" ${line(1.2, C.woodDeep, 0.6)}/>
    <rect x="60" y="250" width="40" height="40" rx="3" ${line(1.4, C.woodDeep, 0.7)}/>
    <path d="M66 270 H94 M80 256 V284" ${line(1.2, C.woodDeep, 0.6)}/>`,
  }),
};

export const COVER_IDS = Object.keys(COVERS);

export function coverFiles() {
  const files = {};
  for (const [name, { body, defs }] of Object.entries(COVERS))
    files[`covers/${name}.svg`] = svg({ id: `cover.${name}`, width: W, height: H, body, defs });
  return files;
}
