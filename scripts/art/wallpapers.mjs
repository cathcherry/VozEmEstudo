// Atmosphere wallpapers (1600 × 1000, 16:10, full-bleed with "cover"). Low contrast by design:
// detail lives at the edges and bottom, the centre stays calm so panels remain readable.
import { C, svg, sparkle } from './lib.mjs';

const W = 1600;
const H = 1000;

/** Deterministic pseudo-random numbers, so a rebuild produces the same scene. */
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r1 = (n) => Math.round(n * 10) / 10;
const sky = (id, stops) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops
    .map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`)
    .join('')}</linearGradient>`;

function shelf(x, width, random, tones) {
  let books = '';
  for (let row = 0; row < 5; row += 1) {
    const base = 260 + row * 150;
    let bx = x + 12;
    while (bx < x + width - 30) {
      const w = 14 + random() * 18;
      const h = 70 + random() * 50;
      const lean = random() < 0.08 ? 6 : 0;
      const tone = tones[Math.floor(random() * tones.length)];
      books += `<rect x="${r1(bx)}" y="${r1(base - h)}" width="${r1(w)}" height="${r1(h)}" rx="2" fill="${tone}"${lean ? ` transform="rotate(${lean} ${r1(bx)} ${base})"` : ''}/>`;
      bx += w + 2 + (random() < 0.1 ? 18 : 0);
    }
    books += `<rect x="${x}" y="${base}" width="${width}" height="12" fill="${C.lavenderLight}" opacity="0.7"/>`;
  }
  return `<rect x="${x}" y="80" width="${width}" height="${H - 80}" fill="${C.lavenderPale}"/>${books}`;
}

const SCENES = {
  'rainy-library': () => {
    const random = rng(7);
    const tones = [C.lavenderLight, C.mistLight, C.matchaPale, C.rosePale, C.honeyPale];
    let rain = '';
    for (let i = 0; i < 90; i += 1) {
      const x = 640 + random() * 320;
      const y = 150 + random() * 560;
      rain += `M${r1(x)} ${r1(y)} l-6 22 `;
    }
    return {
      defs: sky('rl-sky', [
        [0, C.mistPale],
        [1, C.lavenderPale],
      ]),
      body: `<rect width="${W}" height="${H}" fill="url(#rl-sky)"/>
  <g opacity="0.75">${shelf(0, 440, random, tones)}${shelf(1160, 440, random, tones)}</g>
  <path d="M620 780 V300 A180 180 0 0 1 980 300 V780 Z" fill="${C.mistLight}" opacity="0.7"/>
  <path d="M800 120 V780 M620 450 H980 M620 620 H980" stroke="${C.white}" stroke-width="14" opacity="0.7"/>
  <path d="M620 780 V300 A180 180 0 0 1 980 300 V780 Z" stroke="${C.white}" stroke-width="18" opacity="0.8"/>
  <path d="${rain}" stroke="${C.mist}" stroke-width="2" stroke-linecap="round" opacity="0.55"/>
  <rect x="580" y="780" width="440" height="22" rx="6" fill="${C.white}" opacity="0.8"/>
  <rect x="0" y="880" width="${W}" height="120" fill="${C.lavenderLight}" opacity="0.35"/>`,
    };
  },
  'lavender-desk': () => {
    const random = rng(11);
    let dots = '';
    for (let i = 0; i < 70; i += 1)
      dots += `<circle cx="${r1(random() * W)}" cy="${r1(random() * 780)}" r="${r1(2 + random() * 3)}" fill="${C.lavenderLight}" opacity="0.6"/>`;
    return {
      defs: sky('ld-sky', [
        [0, C.lavenderPale],
        [1, C.paper],
      ]),
      body: `<rect width="${W}" height="${H}" fill="url(#ld-sky)"/>
  ${dots}
  <path d="M980 0 H1300 L900 820 H580 Z M1360 0 H1520 L1120 820 H960 Z" fill="${C.white}" opacity="0.4"/>
  <rect x="0" y="820" width="${W}" height="180" fill="${C.lavenderLight}" opacity="0.55"/>
  <rect x="0" y="820" width="${W}" height="8" fill="${C.lavenderMid}" opacity="0.35"/>
  <g opacity="0.5">
    <rect x="90" y="740" width="150" height="26" rx="4" fill="${C.roseLight}"/>
    <rect x="104" y="714" width="130" height="26" rx="4" fill="${C.mistLight}"/>
    <rect x="96" y="688" width="140" height="26" rx="4" fill="${C.matchaLight}"/>
    <rect x="96" y="766" width="150" height="54" rx="4" fill="${C.lavenderMid}" opacity="0.5"/>
    <path d="M1400 820 Q1400 790 1440 790 Q1480 790 1480 820 Z" fill="${C.lavenderMid}"/>
    <path d="M1440 792 L1460 690 L1520 650" stroke="${C.lavenderMid}" stroke-width="12" stroke-linecap="round" fill="none"/>
    <path d="M1490 620 Q1530 600 1560 640 L1520 670 Z" fill="${C.matchaLight}"/>
  </g>`,
    };
  },
  'matcha-afternoon': () => {
    const random = rng(23);
    let leaves = '';
    for (let i = 0; i < 26; i += 1) {
      const x = random() * 520;
      const y = random() * 360;
      const a = Math.round(random() * 360);
      const s = 0.8 + random() * 0.9;
      leaves += `<path transform="translate(${r1(x)} ${r1(y)}) rotate(${a}) scale(${r1(s)})" d="M0 0 C20 -24 60 -24 80 0 C60 24 20 24 0 0 Z" fill="${C.matcha}" opacity="0.14"/>`;
    }
    return {
      defs: sky('ma-sky', [
        [0, C.honeyPale],
        [0.6, C.matchaPale],
        [1, C.matchaPale],
      ]),
      body: `<rect width="${W}" height="${H}" fill="url(#ma-sky)"/>
  <path d="M1600 0 L900 1000 H1100 Z M1600 0 L1250 1000 H1400 Z M1600 0 L600 1000 H700 Z" fill="${C.honey}" opacity="0.08"/>
  ${leaves}
  <path d="M0 860 C300 800 520 840 760 880 C1020 920 1300 820 1600 840 V1000 H0 Z" fill="${C.matchaLight}" opacity="0.45"/>
  <path d="M0 930 C360 880 700 940 1000 930 C1260 920 1420 890 1600 900 V1000 H0 Z" fill="${C.matcha}" opacity="0.25"/>`,
    };
  },
  'cozy-winter': () => {
    const random = rng(31);
    let snow = '';
    for (let i = 0; i < 120; i += 1)
      snow += `<circle cx="${r1(random() * W)}" cy="${r1(random() * 820)}" r="${r1(2 + random() * 4)}" fill="${C.white}" opacity="${r1(0.5 + random() * 0.5)}"/>`;
    const pine = (x, y, s, fill) =>
      `<path d="M${x} ${y - 150 * s} L${x + 40 * s} ${y - 80 * s} H${x + 22 * s} L${x + 60 * s} ${y - 20 * s} H${x - 60 * s} L${x - 22 * s} ${y - 80 * s} H${x - 40 * s} Z" fill="${fill}"/>`;
    let trees = '';
    for (const [x, s] of [
      [80, 1.4],
      [190, 1.1],
      [300, 1.6],
      [1300, 1.3],
      [1420, 1.7],
      [1530, 1.2],
    ])
      trees += pine(x, 880, s, C.mist);
    return {
      defs: sky('cw-sky', [
        [0, C.mistLight],
        [1, C.paper],
      ]),
      body: `<rect width="${W}" height="${H}" fill="url(#cw-sky)"/>
  <circle cx="1260" cy="200" r="110" fill="${C.honeyPale}" opacity="0.7"/>
  <path d="M0 760 C300 700 600 760 900 740 C1200 720 1400 690 1600 720 V1000 H0 Z" fill="${C.lavenderPale}"/>
  <g opacity="0.55">${trees}</g>
  <path d="M0 860 C400 820 800 880 1200 850 C1400 836 1500 840 1600 850 V1000 H0 Z" fill="${C.white}"/>
  ${snow}`,
    };
  },
  'ocean-study': () => {
    let waves = '';
    for (let i = 0; i < 7; i += 1) {
      const y = 700 + i * 44;
      waves += `<path d="M0 ${y} Q100 ${y - 12} 200 ${y} T400 ${y} T600 ${y} T800 ${y} T1000 ${y} T1200 ${y} T1400 ${y} T1600 ${y}" stroke="${C.white}" stroke-width="${3 + i * 0.6}" fill="none" opacity="${r1(0.35 + i * 0.06)}"/>`;
    }
    return {
      defs: sky('os-sky', [
        [0, C.mistPale],
        [0.62, C.paper],
        [0.621, C.mistLight],
        [1, C.mist],
      ]),
      body: `<rect width="${W}" height="${H}" fill="url(#os-sky)"/>
  <circle cx="300" cy="260" r="90" fill="${C.honeyPale}" opacity="0.8"/>
  <path d="M200 330 Q300 300 420 330 Q520 300 640 320" stroke="${C.white}" stroke-width="26" stroke-linecap="round" fill="none" opacity="0.7"/>
  <path d="M1100 200 Q1180 180 1260 200 Q1330 180 1400 196" stroke="${C.white}" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.7"/>
  <g opacity="0.55">
    <path d="M1380 620 L1388 520 H1412 L1420 620 Z" fill="${C.white}"/>
    <path d="M1384 570 H1416" stroke="${C.rose}" stroke-width="10"/>
    <rect x="1386" y="500" width="28" height="20" fill="${C.honeyLight}"/>
    <path d="M1380 500 L1400 482 L1420 500 Z" fill="${C.rose}"/>
  </g>
  ${waves}`,
    };
  },
  'night-garden': () => {
    const random = rng(47);
    let stars = '';
    for (let i = 0; i < 60; i += 1)
      stars += `<circle cx="${r1(random() * W)}" cy="${r1(random() * 560)}" r="${r1(1 + random() * 1.8)}" fill="${C.lavenderLight}" opacity="${r1(0.3 + random() * 0.5)}"/>`;
    let flies = '';
    for (let i = 0; i < 26; i += 1) {
      const x = random() * W;
      const y = 600 + random() * 320;
      if (x > 500 && x < 1100 && y < 820) continue;
      flies += `<circle cx="${r1(x)}" cy="${r1(y)}" r="14" fill="${C.honey}" opacity="0.12"/><circle cx="${r1(x)}" cy="${r1(y)}" r="3" fill="${C.honeyLight}" opacity="0.85"/>`;
    }
    let stems = '';
    for (let i = 0; i < 34; i += 1) {
      const x = random() * W;
      const h = 80 + random() * 160;
      const tone = [C.lavender, C.rose, C.mist][i % 3];
      stems += `<path d="M${r1(x)} 1000 Q${r1(x + 18)} ${r1(1000 - h / 2)} ${r1(x + 6)} ${r1(1000 - h)}" stroke="${C.lavenderDeep}" stroke-width="4" fill="none" opacity="0.6"/><circle cx="${r1(x + 6)}" cy="${r1(1000 - h)}" r="${r1(7 + random() * 6)}" fill="${tone}" opacity="0.45"/>`;
    }
    return {
      defs: sky('ng-sky', [
        [0, C.nightDeep],
        [1, C.night],
      ]),
      body: `<rect width="${W}" height="${H}" fill="url(#ng-sky)"/>
  ${stars}
  <circle cx="1300" cy="190" r="150" fill="${C.lavenderLight}" opacity="0.06"/>
  <path d="M1312.8 126 A64 64 0 1 0 1364 209.2 A48 48 0 1 1 1312.8 126 Z" fill="${C.honeyPale}" opacity="0.9"/>
  ${sparkle(240, 140, 10, C.lavenderLight)}${sparkle(980, 90, 8, C.honeyLight)}
  <path d="M0 900 C300 860 600 900 900 880 C1200 860 1400 880 1600 870 V1000 H0 Z" fill="${C.nightDeep}" opacity="0.8"/>
  ${stems}
  ${flies}`,
    };
  },
};

export const WALLPAPER_IDS = Object.keys(SCENES);

export function wallpaperFiles() {
  const files = {};
  for (const [name, make] of Object.entries(SCENES)) {
    const { defs, body } = make();
    files[`wallpapers/${name}.svg`] = svg({
      id: `wallpaper.${name}`,
      width: W,
      height: H,
      body,
      defs,
      extra: ' preserveAspectRatio="xMidYMid slice"',
    });
  }
  return files;
}
