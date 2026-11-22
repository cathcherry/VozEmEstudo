// Scrapbook set: papers, washi tapes, stickers, frames, dividers and label plates. Same palette,
// same ink line and the same light (top-left) as the rest of the art. Edges that should look torn
// or deckled come from a seeded jitter, so every build draws exactly the same file.
import { C, line, svg, round } from './lib.mjs';

/** Deterministic pseudo-random numbers (a small LCG), one stream per asset. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const hash = (text) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** A rectangle whose edges wobble by up to `amp` units (deckled paper). */
function deckle(x, y, w, h, amp, seed, step = 7) {
  const r = rng(seed);
  const j = () => round((r() - 0.5) * 2 * amp);
  const pts = [];
  for (let i = 0; i <= w; i += step) pts.push([x + i, y + j()]);
  for (let i = step; i <= h; i += step) pts.push([x + w + j(), y + i]);
  for (let i = w - step; i >= 0; i -= step) pts.push([x + i, y + h + j()]);
  for (let i = h - step; i > 0; i -= step) pts.push([x + j(), y + i]);
  return `M${pts.map(([a, b]) => `${round(a)} ${round(b)}`).join(' L')} Z`;
}

/** A rectangle with round perforation bites along every edge (postage stamp). */
function perforatedRect(x, y, w, h, bite, gap) {
  const along = (len) => {
    const n = Math.max(2, Math.round(len / gap));
    return { n, step: len / n };
  };
  const top = along(w);
  const side = along(h);
  let d = `M${x} ${y}`;
  for (let i = 0; i < top.n; i += 1) {
    const c = x + (i + 0.5) * top.step;
    d += ` L${round(c - bite)} ${y} A${bite} ${bite} 0 0 0 ${round(c + bite)} ${y}`;
  }
  d += ` L${x + w} ${y}`;
  for (let i = 0; i < side.n; i += 1) {
    const c = y + (i + 0.5) * side.step;
    d += ` L${x + w} ${round(c - bite)} A${bite} ${bite} 0 0 0 ${x + w} ${round(c + bite)}`;
  }
  d += ` L${x + w} ${y + h}`;
  for (let i = top.n - 1; i >= 0; i -= 1) {
    const c = x + (i + 0.5) * top.step;
    d += ` L${round(c + bite)} ${y + h} A${bite} ${bite} 0 0 0 ${round(c - bite)} ${y + h}`;
  }
  d += ` L${x} ${y + h}`;
  for (let i = side.n - 1; i >= 0; i -= 1) {
    const c = y + (i + 0.5) * side.step;
    d += ` L${x} ${round(c + bite)} A${bite} ${bite} 0 0 0 ${x} ${round(c - bite)}`;
  }
  return `${d} Z`;
}

/** Scalloped rectangle: half circles along every edge. */
function scallopRect(x, y, w, h, r) {
  const nx = Math.round(w / (2 * r));
  const ny = Math.round(h / (2 * r));
  const sx = w / nx;
  const sy = h / ny;
  let d = `M${x} ${y}`;
  for (let i = 0; i < nx; i += 1) d += ` A${sx / 2} ${r} 0 0 1 ${round(x + (i + 1) * sx)} ${y}`;
  for (let i = 0; i < ny; i += 1) d += ` A${r} ${sy / 2} 0 0 1 ${x + w} ${round(y + (i + 1) * sy)}`;
  for (let i = nx - 1; i >= 0; i -= 1) d += ` A${sx / 2} ${r} 0 0 1 ${round(x + i * sx)} ${y + h}`;
  for (let i = ny - 1; i >= 0; i -= 1) d += ` A${r} ${sy / 2} 0 0 1 ${x} ${round(y + i * sy)}`;
  return `${d} Z`;
}

const shadowOf = (d, dx = 1.5, dy = 3, opacity = 0.1) =>
  `<path d="${d}" transform="translate(${dx} ${dy})" fill="${C.ink}" fill-rule="evenodd" opacity="${opacity}"/>`;

// ---- Papers (200 × 260): one loose sheet each ------------------------------------------------

const PW = 200;
const PH = 260;
const PAPERS = {
  ruled: {
    title: 'Pautado',
    alt: 'Folha pautada com margem rosa',
    fill: C.white,
    edge: 0,
    defs: `<pattern id="p" width="${PW}" height="16" patternUnits="userSpaceOnUse" y="6"><path d="M0 15.5 H${PW}" stroke="${C.mist}" stroke-width="1"/></pattern>`,
    over: `<rect x="10" y="34" width="180" height="214" fill="url(#p)"/><path d="M40 12 V252" stroke="${C.rose}" stroke-width="1.2" opacity="0.7"/>`,
  },
  grid: {
    title: 'Quadriculado',
    alt: 'Folha quadriculada azul-névoa',
    fill: C.white,
    edge: 0,
    defs: `<pattern id="p" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0 V12 H0" stroke="${C.mist}" stroke-width="0.8" opacity="0.8"/></pattern>`,
    over: `<rect x="10" y="10" width="180" height="240" fill="url(#p)"/>`,
  },
  dot: {
    title: 'Pontilhado',
    alt: 'Folha com grade de pontos lavanda',
    fill: C.white,
    edge: 0,
    defs: `<pattern id="p" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="6" cy="6" r="0.9" fill="${C.lavenderMid}"/></pattern>`,
    over: `<rect x="10" y="10" width="180" height="240" fill="url(#p)"/>`,
  },
  kraft: {
    title: 'Kraft',
    alt: 'Papel kraft com fibras e borda irregular',
    fill: C.woodLight,
    edge: 1.1,
    defs: '',
    over: (() => {
      const r = rng(41);
      let fibres = '';
      for (let i = 0; i < 70; i += 1) {
        const x = 14 + r() * 172;
        const y = 14 + r() * 232;
        const a = (r() - 0.5) * 1.2;
        const len = 3 + r() * 6;
        fibres += `M${round(x)} ${round(y)} l${round(Math.cos(a) * len)} ${round(Math.sin(a) * len)} `;
      }
      return `<path d="${fibres}" stroke="${C.woodDeep}" stroke-width="0.6" stroke-linecap="round" opacity="0.22"/><path d="${fibres}" transform="translate(3 5)" stroke="${C.honeyPale}" stroke-width="0.6" stroke-linecap="round" opacity="0.4"/>`;
    })(),
  },
  linen: {
    title: 'Linho',
    alt: 'Papel linho com trama fina',
    fill: C.paper,
    edge: 0.6,
    defs: `<pattern id="p" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 1 H4" stroke="${C.lavenderLight}" stroke-width="0.6" opacity="0.55"/><path d="M1 0 V4" stroke="${C.inkSoft}" stroke-width="0.5" opacity="0.12"/></pattern>`,
    over: `<rect x="8" y="8" width="184" height="244" fill="url(#p)"/>`,
  },
  vellum: {
    title: 'Vegetal',
    alt: 'Papel vegetal translúcido',
    fill: C.mistPale,
    fillOpacity: 0.62,
    edge: 0,
    defs: '',
    over: `<path d="M14 18 Q60 10 120 26" stroke="${C.white}" stroke-width="6" stroke-linecap="round" opacity="0.6"/><path d="M150 236 Q170 220 184 200" stroke="${C.white}" stroke-width="4" stroke-linecap="round" opacity="0.5"/>`,
  },
  'aged-cream': {
    title: 'Creme envelhecido',
    alt: 'Papel creme envelhecido, com manchas leves e borda irregular',
    fill: C.honeyPale,
    edge: 1.3,
    defs: '',
    over: (() => {
      const r = rng(77);
      let spots = '';
      for (let i = 0; i < 14; i += 1)
        spots += `<circle cx="${round(16 + r() * 168)}" cy="${round(16 + r() * 228)}" r="${round(1 + r() * 3.4)}" fill="${C.wood}" opacity="${round(0.08 + r() * 0.12)}"/>`;
      return `${spots}<path d="M8 8 H192 V252 H8 Z" stroke="${C.woodLight}" stroke-width="10" opacity="0.35"/>`;
    })(),
  },
};

function paperFile(name, p) {
  const d = p.edge ? deckle(8, 8, 184, 244, p.edge, hash(name), 9) : 'M8 8 H192 V252 H8 Z';
  return svg({
    id: `paper.${name}`,
    width: PW,
    height: PH,
    defs: `<clipPath id="sheet"><path d="${d}"/></clipPath>${p.defs}`,
    body: `${shadowOf(d, 1.5, 3, 0.08)}
  <path d="${d}" fill="${p.fill}"${p.fillOpacity ? ` fill-opacity="${p.fillOpacity}"` : ''}/>
  <g clip-path="url(#sheet)">${p.over}</g>
  <path d="${d}" ${line(1, C.inkSoft, 0.28)}/>`,
  });
}

// ---- Washi tape (160 × 44) -------------------------------------------------------------------

const TW = 160;
const TH = 44;
function tornStrip(seed) {
  const r = rng(seed);
  const y0 = 8;
  const y1 = 36;
  // Torn ends: small irregular teeth, the way washi tape tears between the fingers.
  const end = (x, dir) => {
    const pts = [];
    for (let y = y0; y <= y1 + 0.01; y += 3.5)
      pts.push(`${round(x + dir * r() * 3.4)} ${round(y)}`);
    return pts;
  };
  const right = end(152, -1);
  const left = end(8, 1).reverse();
  return `M${left.at(-1)} L${right.join(' L')} L${left.join(' L')} Z`;
}

const TAPES = {
  'lavender-dots': {
    title: 'Bolinhas lavanda',
    alt: 'Fita washi lavanda com bolinhas brancas',
    base: C.lavenderLight,
    pat: `<pattern id="t" y="8" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.8" fill="${C.white}"/><circle cx="9" cy="9" r="1.8" fill="${C.white}" opacity="0.8"/></pattern>`,
  },
  'matcha-stripes': {
    title: 'Listras matcha',
    alt: 'Fita washi verde com listras diagonais',
    base: C.matchaPale,
    pat: `<pattern id="t" y="8" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="10" fill="${C.matchaLight}"/></pattern>`,
  },
  'honey-gingham': {
    title: 'Xadrez mel',
    alt: 'Fita washi amarela xadrez',
    base: C.honeyPale,
    pat: `<pattern id="t" y="8" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="6" height="12" fill="${C.honeyLight}" opacity="0.7"/><rect width="12" height="6" fill="${C.honeyLight}" opacity="0.7"/></pattern>`,
  },
  'rose-floral': {
    title: 'Florzinhas rosa',
    alt: 'Fita washi rosa com florzinhas',
    base: C.rosePale,
    pat: `<pattern id="t" y="8" width="24" height="28" patternUnits="userSpaceOnUse"><g transform="translate(7 14)" fill="${C.rose}"><circle cx="0" cy="-2.4" r="2"/><circle cx="2.3" cy="-0.7" r="2"/><circle cx="1.4" cy="2" r="2"/><circle cx="-1.4" cy="2" r="2"/><circle cx="-2.3" cy="-0.7" r="2"/><circle r="1.2" fill="${C.honeyLight}"/></g><path d="M15 9 q4 -3 7 -1 q-3 3 -7 1 Z M14 21 q4 3 7 1 q-3 -3 -7 -1 Z" fill="${C.matcha}" opacity="0.7"/></pattern>`,
  },
  'mist-grid': {
    title: 'Grade névoa',
    alt: 'Fita washi azul-névoa quadriculada',
    base: C.mistLight,
    pat: `<pattern id="t" y="8" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M8 0 V8 H0" stroke="${C.mistDeep}" stroke-width="0.8" opacity="0.85"/></pattern>`,
  },
  kraft: {
    title: 'Kraft',
    alt: 'Fita de papel kraft lisa',
    base: C.woodLight,
    pat: `<pattern id="t" y="8" width="9" height="5" patternUnits="userSpaceOnUse"><path d="M0 2 h4" stroke="${C.woodDeep}" stroke-width="0.6" opacity="0.4"/></pattern>`,
  },
  stars: {
    title: 'Estrelinhas',
    alt: 'Fita washi azul-noite com estrelinhas douradas',
    base: C.night,
    pat: `<pattern id="t" y="8" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M5 2 Q5.6 5.4 9 6 Q5.6 6.6 5 10 Q4.4 6.6 1 6 Q4.4 5.4 5 2 Z" fill="${C.honeyLight}"/><circle cx="15" cy="15" r="1.1" fill="${C.lavenderLight}"/></pattern>`,
  },
  check: {
    title: 'Xadrez lavanda e matcha',
    alt: 'Fita washi xadrez em lavanda e verde',
    base: C.paper,
    pat: `<pattern id="t" y="8" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="7" height="14" fill="${C.lavenderLight}" opacity="0.75"/><rect width="14" height="7" fill="${C.matchaLight}" opacity="0.6"/></pattern>`,
  },
};

function tapeFile(name, t) {
  const d = tornStrip(hash(name));
  return svg({
    id: `tape.${name}`,
    width: TW,
    height: TH,
    defs: `<clipPath id="strip"><path d="${d}"/></clipPath>${t.pat}`,
    body: `<g opacity="0.86">
    <path d="${d}" fill="${t.base}"/>
    <g clip-path="url(#strip)"><rect x="0" y="0" width="${TW}" height="${TH}" fill="url(#t)"/>
      <path d="M0 10.5 H${TW}" stroke="${C.white}" stroke-width="2" opacity="0.45"/>
      <path d="M0 34.5 H${TW}" stroke="${C.ink}" stroke-width="1.4" opacity="0.07"/></g>
  </g>`,
  });
}

// ---- Stickers (96 × 96): die-cut with a white border and a soft lift ------------------------

const L = (w = 2) => line(w);
const STICKERS = {
  'pressed-flower': [
    'Flor prensada',
    'Flor prensada de pétalas rosadas',
    `<path d="M48 82 Q46 64 48 48" ${line(2, C.matchaDeep)}/>
    <path d="M47 70 Q36 66 34 58 Q44 58 47 66 Z M48.5 62 Q58 60 62 52 Q52 52 48.5 59 Z" fill="${C.matchaLight}" ${L(1.6)}/>
    <g ${L(1.8)}>${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="48" cy="25" rx="8" ry="12" fill="${C.roseLight}" transform="rotate(${a} 48 37)"/>`).join('')}</g>
    <path d="M48 27 V33 M40 33 L44 36 M56 33 L52 36" ${line(1.2, C.roseDeep)}/>
    <circle cx="48" cy="37" r="5.4" fill="${C.honey}" ${L(1.6)}/>`,
  ],
  leaf: [
    'Folha',
    'Folha verde com nervuras',
    `<path d="M22 76 C18 46 40 20 76 18 C78 52 56 78 22 76 Z" fill="${C.matcha}" ${L()}/>
    <path d="M22 76 C38 60 52 44 68 26 M34 62 L33 48 M42 53 L41 38 M51 43 L50 30 M38 58 L52 58 M47 48 L60 47 M55 38 L66 37" ${line(1.4, C.matchaDeep)}/>
    <path d="M17 81 L24 74" ${line(2.2, C.matchaDeep)}/>
    <path d="M34 36 Q44 26 58 23" ${line(1.8, C.white, 0.7)}/>`,
  ],
  moth: [
    'Mariposa',
    'Mariposa lavanda de asas abertas',
    `<path d="M48 44 C38 26 22 18 14 24 C8 32 16 46 30 50 C20 54 18 66 26 72 C34 76 44 64 48 56 Z" fill="${C.lavenderPale}" ${L()}/>
    <path d="M48 44 C58 26 74 18 82 24 C88 32 80 46 66 50 C76 54 78 66 70 72 C62 76 52 64 48 56 Z" fill="${C.lavenderPale}" ${L()}/>
    <path d="M24 30 Q32 32 40 42 M72 30 Q64 32 56 42 M28 64 Q36 60 44 56 M68 64 Q60 60 52 56" ${line(1.3, C.matchaDeep, 0.7)}/>
    <circle cx="28" cy="36" r="4.4" fill="${C.honey}" ${L(1.4)}/><circle cx="68" cy="36" r="4.4" fill="${C.honey}" ${L(1.4)}/>
    <path d="M48 36 C52 36 53 44 52 56 C51 66 49 70 48 70 C47 70 45 66 44 56 C43 44 44 36 48 36 Z" fill="${C.lavender}" ${L(1.8)}/>
    <path d="M46 36 Q42 26 36 22 M50 36 Q54 26 60 22" ${line(1.6, C.honeyDeep)}/>`,
  ],
  teacup: [
    'Xícara',
    'Xícara de chá com vapor',
    `<path d="M40 30 Q36 25 40 20 Q44 15 40 10 M54 30 Q50 25 54 20" ${line(1.8, C.mistDeep, 0.8)}/>
    <ellipse cx="48" cy="76" rx="32" ry="7" fill="${C.white}" ${L()}/>
    <path d="M70 46 C84 44 84 66 66 64" ${line(5.4)}/><path d="M70 46 C84 44 84 66 66 64" stroke="${C.lavenderMid}" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M22 38 H74 V46 Q74 72 48 72 Q22 72 22 46 Z" fill="${C.lavenderMid}" ${L()}/>
    <path d="M24 52 Q48 58 72 52" stroke="${C.white}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0.1 5.4"/>
    <ellipse cx="48" cy="38" rx="26" ry="6" fill="${C.white}" ${L()}/><ellipse cx="48" cy="39" rx="21" ry="3.6" fill="${C.matcha}"/>`,
  ],
  pencil: [
    'Lápis',
    'Lápis amarelo apontado',
    `<g transform="rotate(-38 48 48)">
      <path d="M14 40 H66 V56 H14 Z" fill="${C.honey}" ${L()}/>
      <path d="M14 45.4 H66 M14 50.6 H66" ${line(1.2, C.honeyDeep)}/>
      <path d="M66 40 L84 48 L66 56 Z" fill="${C.woodLight}" ${L()}/>
      <path d="M78.6 45.6 L84 48 L78.6 50.4 Z" fill="${C.ink}" fill-opacity="0.88"/>
      <path d="M8 40 H18 V56 H8 Q4 56 4 52 V44 Q4 40 8 40 Z" fill="${C.rose}" ${L()}/>
      <rect x="16" y="39" width="8" height="18" rx="1" fill="${C.mistLight}" ${L(1.8)}/>
    </g>`,
  ],
  paperclip: [
    'Clipe',
    'Clipe de papel lavanda',
    `<path d="M38 70 V30 A10 10 0 0 1 58 30 V68 A16 16 0 0 1 26 68 V24" ${line(8)}/>
    <path d="M38 70 V30 A10 10 0 0 1 58 30 V68 A16 16 0 0 1 26 68 V24" stroke="${C.lavenderMid}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M57 32 V60" stroke="${C.white}" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/>`,
  ],
  star: [
    'Estrela',
    'Estrela dourada',
    `<path d="M48 12 L57.4 34.6 L82 36.6 L63.4 52.6 L69 76.6 L48 63.8 L27 76.6 L32.6 52.6 L14 36.6 L38.6 34.6 Z" fill="${C.honey}" ${L()}/>
    <path d="M48 63.8 L48 40 L63.4 52.6 L69 76.6 Z" fill="${C.honeyDeep}" opacity="0.3"/>
    <path d="M40 30 L46 18" ${line(2, C.white, 0.8)}/>`,
  ],
  moon: [
    'Lua',
    'Lua crescente com estrelinha',
    `<path d="M58 14 A34 34 0 1 0 82 66 A26 26 0 1 1 58 14 Z" fill="${C.honeyLight}" ${L()}/>
    <path d="M40 74 A28 28 0 0 1 22 42" ${line(4, C.honeyDeep, 0.25)}/>
    <circle cx="34" cy="38" r="3" fill="${C.honey}" opacity="0.6"/><circle cx="44" cy="60" r="2.2" fill="${C.honey}" opacity="0.6"/>
    <path d="M70 22 Q71 28 77 29 Q71 30 70 36 Q69 30 63 29 Q69 28 70 22 Z" fill="${C.lavenderMid}" ${line(1.2)}/>`,
  ],
  bookmark: [
    'Marcador',
    'Marcador de página com borla',
    `<path d="M32 16 H64 V84 L48 72 L32 84 Z" fill="${C.matcha}" ${L()}/>
    <path d="M37 22 H59 V74 L48 66 L37 74 Z" ${line(1.2, C.white, 0.7)} stroke-dasharray="2 2.4"/>
    <circle cx="48" cy="33" r="6" fill="${C.honeyLight}" ${L(1.6)}/>
    <path d="M48 16 Q50 10 58 9 M58 9 L66 20 M58 9 L62 22 M58 9 L70 16" ${line(1.6, C.roseDeep)}/>`,
  ],
  mushroom: [
    'Cogumelo',
    'Cogumelo de chapéu rosado com pintas',
    `<path d="M38 50 Q36 70 34 80 H62 Q60 70 58 50 Z" fill="${C.paper}" ${L()}/>
    <path d="M54 54 Q56 70 58 78" ${line(3, C.woodLight, 1)}/>
    <path d="M12 52 C12 28 30 14 48 14 C66 14 84 28 84 52 Q48 60 12 52 Z" fill="${C.rose}" ${L()}/>
    <circle cx="32" cy="34" r="5" fill="${C.white}"/><circle cx="52" cy="24" r="4" fill="${C.white}"/><circle cx="66" cy="38" r="5.6" fill="${C.white}"/><circle cx="44" cy="44" r="3" fill="${C.white}"/>
    <path d="M24 82 Q48 76 74 82" ${line(2.4, C.matchaDeep)}/>`,
  ],
  fern: [
    'Samambaia',
    'Ramo de samambaia',
    `<path d="M30 86 Q40 52 66 12" ${line(2, C.matchaDeep)}/>
    ${[
      [34, 74, 1],
      [38, 64, 0.95],
      [43, 54, 0.88],
      [48, 44, 0.8],
      [54, 34, 0.7],
      [60, 25, 0.56],
    ]
      .map(
        ([x, y, s]) =>
          `<path d="M${x} ${y} q${-16 * s} ${-2 * s} ${-22 * s} ${-12 * s} q${12 * s} ${-2 * s} ${22 * s} ${12 * s} Z M${x} ${y} q${14 * s} ${4 * s} ${24 * s} ${-2 * s} q${-12 * s} ${-8 * s} ${-24 * s} ${2 * s} Z" fill="${C.matcha}" ${line(1.3)}/>`,
      )
      .join('')}`,
  ],
  snail: [
    'Caracol',
    'Caracol de concha espiral',
    `<path d="M12 78 C12 70 20 68 30 68 H64 C72 68 76 62 78 54 C79 48 86 47 87 53 C88 68 80 78 66 78 Z" fill="${C.mistLight}" ${L()}/>
    <path d="M78 52 L74 38 M84 50 L88 37" ${line(1.8)}/><circle cx="74" cy="37" r="2.4" fill="${C.ink}"/><circle cx="88" cy="36" r="2.4" fill="${C.ink}"/>
    <circle cx="44" cy="46" r="22" fill="${C.honey}" ${L()}/>
    <path d="M44 46 m0 -2 a3 3 0 1 1 -3 4 a7 7 0 1 1 10 -7 a12 12 0 1 1 -18 10 a17 17 0 1 1 26 -12" ${line(1.8, C.honeyDeep)}/>
    <path d="M28 34 Q34 26 44 25" ${line(2, C.white, 0.7)}/>`,
  ],
  lamp: [
    'Luminária',
    'Luminária de mesa acesa',
    `<ellipse cx="36" cy="80" rx="20" ry="5" fill="${C.lavenderDeep}" ${L()}/>
    <path d="M36 78 L44 50 L60 34" ${line(7)}/><path d="M36 78 L44 50 L60 34" stroke="${C.lavenderMid}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="44" cy="50" r="4" fill="${C.honeyLight}" ${L(1.6)}/>
    <g transform="translate(64 30) rotate(30)"><path d="M-14 8 C-14 -6 -8 -12 0 -12 C8 -12 14 -6 14 8 Z" fill="${C.matcha}" ${L()}/><ellipse cx="0" cy="8" rx="14" ry="4" fill="${C.honeyPale}" ${L(1.6)}/><circle cx="0" cy="9" r="3.6" fill="${C.honey}"/></g>`,
  ],
  envelope: [
    'Envelope',
    'Envelope fechado com coração',
    `<rect x="12" y="24" width="72" height="50" rx="4" fill="${C.white}" ${L()}/>
    <path d="M12 72 L40 48 M84 72 L56 48" ${line(1.4, C.inkSoft, 0.6)}/>
    <path d="M14 26 L48 52 L82 26" fill="${C.lavenderPale}" ${L()}/>
    <path d="M48 58 C40 52 38 48 40 45 C42 42 46 43 48 46 C50 43 54 42 56 45 C58 48 56 52 48 58 Z" fill="${C.rose}" ${L(1.4)}/>`,
  ],
  'wax-seal': [
    'Selo de cera',
    'Selo de cera lavanda com uma estrela',
    `<path d="M48 12 C58 12 62 16 70 18 C80 22 82 30 84 40 C86 50 82 56 80 64 C76 76 66 80 56 82 C46 84 40 82 30 78 C20 74 14 66 12 56 C10 46 12 38 16 30 C22 18 34 12 48 12 Z" fill="${C.lavender}" ${L()}/>
    <circle cx="48" cy="48" r="22" fill="${C.lavenderMid}" ${line(1.6, C.lavenderDeep)}/>
    <circle cx="48" cy="48" r="17" ${line(1.2, C.lavenderDeep, 0.6)}/>
    <path d="M48 36 L51.4 44.4 L60 45 L53.4 50.6 L55.6 59 L48 54.4 L40.4 59 L42.6 50.6 L36 45 L44.6 44.4 Z" fill="${C.lavenderDeep}"/>
    <path d="M26 30 Q32 22 42 20" ${line(2.2, C.white, 0.6)}/>`,
  ],
  'ribbon-bow': [
    'Laço de fita',
    'Laço de fita rosa',
    `<path d="M44 48 C30 30 12 30 12 42 C12 54 30 56 44 50 Z" fill="${C.rose}" ${L()}/>
    <path d="M52 48 C66 30 84 30 84 42 C84 54 66 56 52 50 Z" fill="${C.rose}" ${L()}/>
    <path d="M44 52 L32 80 L40 76 L44 84 L48 56 Z M52 52 L64 80 L56 76 L52 84 L48 56 Z" fill="${C.roseLight}" ${L(1.8)}/>
    <path d="M20 40 Q28 38 38 46 M76 40 Q68 38 58 46" ${line(1.3, C.roseDeep)}/>
    <rect x="42" y="42" width="12" height="13" rx="4" fill="${C.roseDeep}" ${L(1.8)}/>`,
  ],
  bee: [
    'Abelha',
    'Abelha listrada com asas claras',
    `<ellipse cx="38" cy="30" rx="12" ry="16" transform="rotate(-25 38 30)" fill="${C.white}" fill-opacity="0.9" ${L(1.8)}/>
    <ellipse cx="56" cy="28" rx="11" ry="15" transform="rotate(20 56 28)" fill="${C.mistPale}" ${L(1.8)}/>
    <ellipse cx="46" cy="56" rx="26" ry="18" fill="${C.honey}" ${L()}/>
    <path d="M38 39.4 Q34 56 38 72.6 M52 38.4 Q48 56 52 73.6" stroke="${C.ink}" stroke-opacity="0.85" stroke-width="5"/>
    <circle cx="72" cy="50" r="2.4" fill="${C.ink}"/><path d="M20 56 L12 58" ${L(2)}/>
    <path d="M68 60 Q72 62 74 59" ${line(1.4)}/>`,
  ],
  clover: [
    'Trevo',
    'Trevo de quatro folhas',
    `<path d="M48 50 Q52 70 46 86" ${line(2.4, C.matchaDeep)}/>
    <g fill="${C.matcha}" ${L(1.8)}>
      <path d="M48 46 C40 40 32 30 38 22 C42 18 48 20 48 28 C48 20 54 18 58 22 C64 30 56 40 48 46 Z"/>
      <path d="M48 46 C40 40 32 30 38 22 C42 18 48 20 48 28 C48 20 54 18 58 22 C64 30 56 40 48 46 Z" transform="rotate(90 48 46)"/>
      <path d="M48 46 C40 40 32 30 38 22 C42 18 48 20 48 28 C48 20 54 18 58 22 C64 30 56 40 48 46 Z" transform="rotate(180 48 46)"/>
      <path d="M48 46 C40 40 32 30 38 22 C42 18 48 20 48 28 C48 20 54 18 58 22 C64 30 56 40 48 46 Z" transform="rotate(270 48 46)"/>
    </g>
    <path d="M42 28 Q44 24 46 25" ${line(1.4, C.white, 0.7)}/>`,
  ],
  cloud: [
    'Nuvem',
    'Nuvem macia',
    `<path d="M22 66 C10 66 8 50 20 46 C18 32 34 26 42 34 C46 20 68 20 70 36 C84 34 90 50 80 58 C82 66 74 68 70 66 Z" fill="${C.white}" ${L()}/>
    <path d="M24 60 Q48 64 76 60" ${line(3, C.mistLight, 1)}/>
    <circle cx="40" cy="50" r="2" fill="${C.ink}"/><circle cx="56" cy="50" r="2" fill="${C.ink}"/>
    <path d="M45 55 Q48 58 51 55" ${line(1.4)}/>
    <circle cx="34" cy="55" r="3" fill="${C.roseLight}"/><circle cx="62" cy="55" r="3" fill="${C.roseLight}"/>`,
  ],
  'book-heart': [
    'Coração de livros',
    'Pilha de livros com um coração em cima',
    `<rect x="16" y="66" width="62" height="14" rx="2" fill="${C.matcha}" ${L()}/>
    <rect x="22" y="52" width="56" height="14" rx="2" fill="${C.lavenderMid}" ${L()}/>
    <rect x="12" y="38" width="58" height="14" rx="2" fill="${C.rose}" ${L()}/>
    <path d="M70 70 V76 M72 56 V62 M18 42 V48" ${line(1.8, C.white, 0.85)}/>
    <path d="M30 59 H52 M28 73 H50 M24 45 H44" ${line(1.4, C.ink, 0.45)}/>
    <path d="M48 34 C38 27 34 22 36 17 C38 12 45 12 48 18 C51 12 58 12 60 17 C62 22 58 27 48 34 Z" fill="${C.honey}" ${L(1.8)}/>`,
  ],
};

const DIE_CUT = `<filter id="die" x="-12%" y="-12%" width="124%" height="128%" color-interpolation-filters="sRGB">
    <feMorphology in="SourceAlpha" operator="dilate" radius="3.4" result="grown"/>
    <feFlood flood-color="${C.white}"/><feComposite in2="grown" operator="in" result="border"/>
    <feGaussianBlur in="grown" stdDeviation="1.2" result="blur"/><feOffset in="blur" dx="0.6" dy="1.8" result="lift"/>
    <feFlood flood-color="${C.ink}" flood-opacity="0.22"/><feComposite in2="lift" operator="in" result="shadow"/>
    <feMerge><feMergeNode in="shadow"/><feMergeNode in="border"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>`;

// ---- Frames (200 × 240) -------------------------------------------------------------------------
// The window stays transparent (even-odd fill), so a photo or note placed behind shows through.

const FW = 200;
const FH = 240;
const FRAMES = {
  polaroid: [
    'Polaroide',
    'Moldura de foto instantânea com margem larga embaixo',
    () => {
      const outer = 'M14 10 H186 V228 H14 Z';
      const hole = 'M26 22 H174 V170 H26 Z';
      return `${shadowOf(`${outer} ${hole}`, 2, 4, 0.12)}
    <path d="${outer} ${hole}" fill="${C.white}" fill-rule="evenodd"/>
    <path d="${outer}" ${line(1.2, C.inkSoft, 0.35)}/><path d="${hole}" ${line(1.2, C.inkSoft, 0.45)}/>
    <path d="M26 170 H174" ${line(2, C.ink, 0.08)}/>
    <path d="M40 204 Q100 198 160 204" ${line(1.2, C.lavenderMid, 0.5)} stroke-dasharray="1 5"/>`;
    },
  ],
  deckle: [
    'Borda deckle',
    'Foto antiga com borda recortada em zigue-zague',
    () => {
      const r = rng(9);
      const pts = [];
      const zig = (x0, y0, x1, y1, n) => {
        for (let i = 0; i < n; i += 1) {
          const t = i / n;
          const t2 = (i + 0.5) / n;
          const nx = -(y1 - y0);
          const ny = x1 - x0;
          const len = Math.hypot(nx, ny);
          const amp = 3 + r() * 0.8;
          pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
          pts.push([
            x0 + (x1 - x0) * t2 - (nx / len) * amp,
            y0 + (y1 - y0) * t2 - (ny / len) * amp,
          ]);
        }
      };
      zig(16, 14, 184, 14, 28);
      zig(184, 14, 184, 226, 36);
      zig(184, 226, 16, 226, 28);
      zig(16, 226, 16, 14, 36);
      const outer = `M${pts.map(([a, b]) => `${round(a)} ${round(b)}`).join(' L')} Z`;
      const hole = 'M32 30 H168 V210 H32 Z';
      return `${shadowOf(`${outer} ${hole}`, 2, 3.5, 0.1)}
    <path d="${outer} ${hole}" fill="${C.paper}" fill-rule="evenodd"/>
    <path d="${outer}" ${line(1, C.inkSoft, 0.35)}/>
    <path d="${hole}" ${line(1.4, C.woodDeep, 0.4)}/><path d="M28 26 H172 V214 H28 Z" ${line(0.8, C.wood, 0.5)}/>`;
    },
  ],
  'tape-corners': [
    'Cantoneiras',
    'Quatro cantoneiras de papel kraft para prender uma foto',
    () => {
      const corner = (x, y, sx, sy) => {
        const d = `M${x} ${y} h${sx * 44} l${-sx * 44} ${sy * 44} Z`;
        return `${shadowOf(d, 1, 2, 0.12)}<path d="${d}" fill="${C.woodLight}" ${line(1.2, C.woodDeep, 0.7)}/><path d="M${x + sx * 6} ${y + sy * 4} l${sx * 26} 0" ${line(1.4, C.white, 0.6)}/>`;
      };
      return `<rect x="22" y="22" width="156" height="196" rx="1" ${line(1, C.inkSoft, 0.25)} stroke-dasharray="3 5"/>
    ${corner(14, 14, 1, 1)}${corner(186, 14, -1, 1)}${corner(14, 226, 1, -1)}${corner(186, 226, -1, -1)}`;
    },
  ],
  scalloped: [
    'Recorte ondulado',
    'Moldura creme de borda ondulada',
    () => {
      const outer = scallopRect(18, 16, 164, 208, 7);
      const hole = 'M38 36 H162 V204 H38 Z';
      return `${shadowOf(`${outer} ${hole}`, 2, 3.5, 0.1)}
    <path d="${outer} ${hole}" fill="${C.honeyPale}" fill-rule="evenodd"/>
    <path d="${outer}" ${line(1.2, C.honeyDeep, 0.55)}/>
    <path d="M32 30 H168 V210 H32 Z" ${line(1, C.honeyDeep, 0.4)} stroke-dasharray="2 3"/>
    <path d="${hole}" ${line(1.2, C.honeyDeep, 0.5)}/>`;
    },
  ],
  'stamp-border': [
    'Borda de selo',
    'Moldura branca com picote de selo postal',
    () => {
      const outer = perforatedRect(16, 14, 168, 212, 4.2, 14);
      const hole = 'M32 30 H168 V210 H32 Z';
      return `${shadowOf(`${outer} ${hole}`, 1.6, 3, 0.1)}
    <path d="${outer} ${hole}" fill="${C.white}" fill-rule="evenodd"/>
    <path d="${outer}" ${line(1, C.inkSoft, 0.35)}/>
    <path d="${hole}" ${line(1.6, C.lavenderMid, 0.7)}/>`;
    },
  ],
};

// ---- Dividers (320 × 24) ----------------------------------------------------------------------

const DW = 320;
const DH = 24;
const DIVIDERS = {
  wave: [
    'Onda à mão',
    'Linha ondulada desenhada à mão',
    `<path d="M8 12 ${Array.from({ length: 19 }, (_, i) => `Q${16 + i * 16} ${i % 2 ? 17 : 7} ${24 + i * 16} 12`).join(' ')}" ${line(1.8, C.lavenderMid, 0.9)}/>`,
  ],
  sprig: [
    'Raminho',
    'Linha fina com um raminho de folhas no centro',
    `<path d="M10 12 H134 M186 12 H310" ${line(1.2, C.matchaDeep, 0.6)}/>
    <path d="M142 14 Q160 8 178 14" ${line(1.6, C.matchaDeep)}/>
    <path d="M150 12 q-4 -8 2 -10 q3 5 -2 10 Z M160 10 q2 -8 8 -8 q-1 6 -8 8 Z M168 12 q6 -4 10 0 q-5 3 -10 0 Z M156 12 q-2 6 -8 7 q1 -5 8 -7 Z" fill="${C.matcha}" ${line(1)}/>`,
  ],
  stitch: [
    'Costura',
    'Dupla costura tracejada rosa',
    `<path d="M10 9 H310" ${line(1.6, C.rose)} stroke-dasharray="7 5"/>
    <path d="M10 15 H310" ${line(1.6, C.rose, 0.55)} stroke-dasharray="7 5" stroke-dashoffset="6"/>`,
  ],
  diamond: [
    'Losango',
    'Fio duplo com um losango dourado',
    `<path d="M10 10 H146 M10 14 H146 M174 10 H310 M174 14 H310" ${line(1, C.inkSoft, 0.5)}/>
    <path d="M160 4 L168 12 L160 20 L152 12 Z" fill="${C.honey}" ${line(1.2)}/>
    <circle cx="146" cy="12" r="1.6" fill="${C.honeyDeep}"/><circle cx="174" cy="12" r="1.6" fill="${C.honeyDeep}"/>`,
  ],
  'moon-dots': [
    'Pontos e lua',
    'Linha pontilhada com uma pequena lua',
    `<path d="M12 12 H140 M180 12 H308" ${line(2.2, C.lavenderMid, 0.8)} stroke-dasharray="0.1 8"/>
    <path d="M163 4 A8 8 0 1 0 168 18 A6.4 6.4 0 1 1 163 4 Z" fill="${C.honeyLight}" ${line(1.2)}/>
    <path d="M150 7 l1 2.4 l2.4 1 l-2.4 1 l-1 2.4 l-1 -2.4 l-2.4 -1 l2.4 -1 Z" fill="${C.lavender}"/>`,
  ],
};

// ---- Label plates (200 × 72): blank, the app writes over them -------------------------------

const LW = 200;
const LH = 72;
const LABELS = {
  'brass-holder': [
    'Porta-etiqueta de latão',
    'Porta-etiqueta de latão com um cartão em branco',
    `<rect x="12" y="13" width="178" height="52" rx="7" fill="${C.ink}" opacity="0.12"/>
    <rect x="10" y="10" width="180" height="52" rx="7" fill="${C.honeyLight}" ${line(1.6, C.honeyDeep)}/>
    <path d="M16 13 H184" ${line(1.6, C.honeyPale, 0.9)}/>
    <rect x="30" y="18" width="140" height="36" rx="2" fill="${C.white}" ${line(1.4, C.honeyDeep)}/>
    <path d="M30 22 H170" ${line(2.4, C.ink, 0.08)}/>
    <circle cx="20" cy="36" r="3.6" fill="${C.honeyLight}" ${line(1.2, C.honeyDeep)}/><circle cx="180" cy="36" r="3.6" fill="${C.honeyLight}" ${line(1.2, C.honeyDeep)}/>
    <path d="M18 34 L22 38 M178 34 L182 38" ${line(1, C.honeyDeep)}/>`,
  ],
  bookplate: [
    'Ex-libris',
    'Placa de ex-libris creme com fio duplo e cantos recortados',
    (() => {
      const plate =
        'M22 8 H178 A10 10 0 0 0 188 18 V54 A10 10 0 0 0 178 64 H22 A10 10 0 0 0 12 54 V18 A10 10 0 0 0 22 8 Z';
      return `${shadowOf(plate, 1.5, 2.5, 0.1)}<path d="${plate}" fill="${C.paper}" ${line(1.6, C.lavenderDeep, 0.8)}/>
    <path d="M26 14 H174 A8 8 0 0 0 182 22 V50 A8 8 0 0 0 174 58 H26 A8 8 0 0 0 18 50 V22 A8 8 0 0 0 26 14 Z" ${line(1, C.lavender, 0.6)}/>
    <path d="M92 14 Q100 19 108 14" ${line(1.2, C.lavender, 0.8)}/><path d="M92 58 Q100 53 108 58" ${line(1.2, C.lavender, 0.8)}/>`;
    })(),
  ],
  ticket: [
    'Bilhete',
    'Bilhete rosa com picote e recortes laterais',
    (() => {
      const t = 'M10 10 H190 V28 A8 8 0 0 0 190 44 V62 H10 V44 A8 8 0 0 0 10 28 Z';
      return `${shadowOf(t, 1.5, 2.5, 0.1)}<path d="${t}" fill="${C.rosePale}" ${line(1.4, C.roseDeep, 0.7)}/>
    <path d="M150 14 V58" ${line(1.4, C.roseDeep, 0.6)} stroke-dasharray="2 4"/>
    <rect x="18" y="16" width="124" height="40" rx="3" ${line(1, C.rose, 0.7)}/>
    <circle cx="170" cy="36" r="9" ${line(1.4, C.roseDeep, 0.6)}/>
    <path d="M166 36 L169 39 L175 33" ${line(1.4, C.roseDeep, 0.8)}/>`;
    })(),
  ],
  tag: [
    'Etiqueta kraft',
    'Etiqueta de papel kraft com ilhós e barbante',
    (() => {
      const t = 'M40 10 H186 A4 4 0 0 1 190 14 V58 A4 4 0 0 1 186 62 H40 L14 36 Z';
      return `<path d="M2 20 Q10 30 24 36" ${line(1.6, C.woodDeep)}/>
    ${shadowOf(t, 1.5, 2.5, 0.1)}<path d="${t}" fill="${C.woodLight}" ${line(1.4, C.woodDeep, 0.8)}/>
    <circle cx="30" cy="36" r="6" fill="${C.honey}" ${line(1.2, C.honeyDeep)}/><circle cx="30" cy="36" r="2.8" fill="${C.paper}" ${line(1, C.honeyDeep)}/>
    <path d="M24 36 Q14 44 4 40" ${line(1.6, C.woodDeep)}/>
    <path d="M50 18 H180" ${line(1.2, C.white, 0.5)}/>`;
    })(),
  ],
};

export const SCRAPBOOK = {
  paper: Object.entries(PAPERS).map(([name, p]) => ({ name, title: p.title, alt: p.alt })),
  tape: Object.entries(TAPES).map(([name, t]) => ({ name, title: t.title, alt: t.alt })),
  sticker: Object.entries(STICKERS).map(([name, [title, alt]]) => ({ name, title, alt })),
  frame: Object.entries(FRAMES).map(([name, [title, alt]]) => ({ name, title, alt })),
  divider: Object.entries(DIVIDERS).map(([name, [title, alt]]) => ({ name, title, alt })),
  label: Object.entries(LABELS).map(([name, [title, alt]]) => ({ name, title, alt })),
};

export const paperFiles = () =>
  Object.fromEntries(Object.entries(PAPERS).map(([n, p]) => [`papers/${n}.svg`, paperFile(n, p)]));
export const tapeFiles = () =>
  Object.fromEntries(Object.entries(TAPES).map(([n, t]) => [`tapes/${n}.svg`, tapeFile(n, t)]));
export const stickerFiles = () =>
  Object.fromEntries(
    Object.entries(STICKERS).map(([n, [, , body]]) => [
      `stickers/${n}.svg`,
      svg({
        id: `sticker.${n}`,
        width: 96,
        height: 96,
        defs: DIE_CUT,
        body: `<g filter="url(#die)">\n    ${body}\n  </g>`,
      }),
    ]),
  );
export const frameFiles = () =>
  Object.fromEntries(
    Object.entries(FRAMES).map(([n, [, , draw]]) => [
      `frames/${n}.svg`,
      svg({ id: `frame.${n}`, width: FW, height: FH, body: draw() }),
    ]),
  );
export const dividerFiles = () =>
  Object.fromEntries(
    Object.entries(DIVIDERS).map(([n, [, , body]]) => [
      `dividers/${n}.svg`,
      svg({ id: `divider.${n}`, width: DW, height: DH, body }),
    ]),
  );
export const labelFiles = () =>
  Object.fromEntries(
    Object.entries(LABELS).map(([n, [, , body]]) => [
      `labels/${n}.svg`,
      svg({ id: `label.${n}`, width: LW, height: LH, body }),
    ]),
  );

export const scrapbookFiles = () => ({
  ...paperFiles(),
  ...tapeFiles(),
  ...stickerFiles(),
  ...frameFiles(),
  ...dividerFiles(),
  ...labelFiles(),
});
