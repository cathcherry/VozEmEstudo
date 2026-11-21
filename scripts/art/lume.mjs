// Lume, the librarian moth: one shared skeleton, six states and four outfits (240 × 240).
// Head, body and eyes never move between states, so every outfit lines up with every state.
// Animated parts carry stable class names (see docs/ART_DIRECTION_AND_ASSETS.md, "Lume").
import { C, line, svg, sparkle, round } from './lib.mjs';

const SIZE = 240;
const cubic = (p, t) => {
  const u = 1 - t;
  return [0, 1].map(
    (i) =>
      u * u * u * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t * t * t * p[3][i],
  );
};
const tangent = (p, t) => {
  const u = 1 - t;
  return [0, 1].map(
    (i) =>
      3 * u * u * (p[1][i] - p[0][i]) +
      6 * u * t * (p[2][i] - p[1][i]) +
      3 * t * t * (p[3][i] - p[2][i]),
  );
};
const pt = ([x, y]) => `${round(x)} ${round(y)}`;

/** Smooth path through points (Catmull-Rom converted to cubic Béziers). */
function smooth(points, closed = false) {
  const n = points.length;
  const get = (i) => (closed ? points[(i + n) % n] : points[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${pt(points[0])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i += 1) {
    const [p0, p1, p2, p3] = [get(i - 1), get(i), get(i + 1), get(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return closed ? `${d} Z` : d;
}

/** A feather-like antenna: a vane around a curved rachis, with fine barbs. */
function feather(rachis, width) {
  const left = [];
  const right = [];
  const barbs = [];
  const steps = 16;
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const [x, y] = cubic(rachis, t);
    const [tx, ty] = tangent(rachis, t);
    const len = Math.hypot(tx, ty) || 1;
    const [nx, ny] = [-ty / len, tx / len];
    const w = width * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.75) + 0.4;
    left.push([x + nx * w, y + ny * w]);
    right.push([x - nx * w, y - ny * w]);
    if (s > 2 && s < steps - 1 && s % 2 === 0) {
      const ahead = cubic(rachis, Math.min(1, t + 0.07));
      const [ax, ay] = ahead;
      barbs.push(`M${pt([x, y])} L${pt([ax + nx * w * 0.8, ay + ny * w * 0.8])}`);
      barbs.push(`M${pt([x, y])} L${pt([ax - nx * w * 0.8, ay - ny * w * 0.8])}`);
    }
  }
  const outline = smooth([...left, ...right.reverse()], true);
  const spine = `M${pt(rachis[0])} C${pt(rachis[1])} ${pt(rachis[2])} ${pt(rachis[3])}`;
  return `<path d="${outline}" fill="${C.honeyLight}" ${line(1.5)}/>
      <path d="${spine}" ${line(1.3, C.honeyDeep)}/>
      <path d="${barbs.join(' ')}" ${line(0.9, C.honeyDeep)} opacity="0.7"/>`;
}

/** Puffy collar (the moth's fluffy thorax) as a ring of soft bumps. */
function ruff(cx, cy, rx, ry, bumps) {
  const points = [];
  for (let i = 0; i < bumps; i += 1) {
    const a = (i / bumps) * Math.PI * 2;
    points.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  let d = `M${pt(points[0])}`;
  for (let i = 0; i < bumps; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % bumps];
    const r = Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.58;
    d += ` A${round(r)} ${round(r)} 0 0 1 ${pt(b)}`;
  }
  return `${d} Z`;
}

const FOREWING = 'M106 108 C88 84 54 60 34 66 C18 71 18 98 30 114 C42 130 76 134 104 124 Z';
const FOREWING_BAND = 'M104 110 C90 92 66 78 52 81 C42 84 42 102 50 112 C60 122 84 124 102 120 Z';
const HINDWING = 'M108 128 C88 126 62 134 54 152 C47 168 60 182 78 178 C94 174 104 156 112 140 Z';
const HINDWING_BAND =
  'M108 132 C92 133 74 140 69 152 C65 162 72 170 82 167 C94 163 102 150 108 140 Z';
const VEINS_FORE = 'M104 114 Q76 92 42 76 M104 117 Q70 106 30 98 M104 120 Q74 122 42 122';
const VEINS_HIND = 'M108 134 Q86 146 64 160 M108 137 Q96 154 80 172';

function wing(side) {
  const mirror = side === 'r' ? ` transform="translate(${SIZE} 0) scale(-1 1)"` : '';
  return `<g class="lume-wing lume-wing-${side}"><g${mirror}>
      <g class="lume-wing-hind">
        <path d="${HINDWING}" fill="${C.lavenderPale}" ${line(1.6)}/>
        <path d="${HINDWING_BAND}" fill="${C.lavenderLight}" opacity="0.75"/>
        <path d="${VEINS_HIND}" ${line(1.2, C.matcha)}/>
        <circle cx="70" cy="164" r="3.2" fill="${C.roseLight}"/>
      </g>
      <g class="lume-wing-fore">
        <path d="${FOREWING}" fill="${C.lavenderPale}" ${line(1.6)}/>
        <path d="${FOREWING_BAND}" fill="${C.lavenderLight}" opacity="0.75"/>
        <path d="${VEINS_FORE}" ${line(1.2, C.matcha)}/>
        <circle cx="48" cy="96" r="7.5" fill="${C.honeyLight}" ${line(1.2)}/>
        <circle cx="48" cy="96" r="3" fill="${C.honey}"/>
      </g>
    </g></g>`;
}

function antennae(droop = 0) {
  const left = feather(
    [
      [112, 76],
      [106, 62],
      [96, 46],
      [82, 36],
    ],
    5.2,
  );
  const right = feather(
    [
      [128, 76],
      [134, 62],
      [144, 46],
      [158, 36],
    ],
    5.2,
  );
  const tilt = (side) =>
    droop
      ? ` transform="rotate(${side === 'l' ? -droop : droop} ${side === 'l' ? 112 : 128} 76)"`
      : '';
  return `<g class="lume-antennae">
      <g class="lume-antenna lume-antenna-l"><g${tilt('l')}>${left}</g></g>
      <g class="lume-antenna lume-antenna-r"><g${tilt('r')}>${right}</g></g>
    </g>`;
}

const BODY_BACK = `<g class="lume-abdomen">
        <ellipse cx="120" cy="162" rx="23" ry="25" fill="${C.lavenderMid}" ${line(1.6)}/>
        <path d="M141 152 C146 166 140 182 126 186 C136 176 140 164 141 152 Z" fill="${C.lavender}" opacity="0.55"/>
        <path d="M100 160 Q120 166 140 160 M103 171 Q120 177 137 171" ${line(1.1, C.lavenderDeep)} opacity="0.45"/>
      </g>
      <ellipse cx="110" cy="188" rx="7" ry="3.6" fill="${C.lavenderMid}" ${line(1.4)}/>
      <ellipse cx="130" cy="188" rx="7" ry="3.6" fill="${C.lavenderMid}" ${line(1.4)}/>`;
const BODY_FRONT = `<path class="lume-ruff" d="${ruff(120, 132, 31, 11.5, 12)}" fill="${C.paper}" ${line(1.6)}/>
      <path d="M100 72 Q105 62 112 69 Q118 58 125 68 Q133 61 138 73" fill="${C.lavenderLight}" ${line(1.5)}/>
      <circle class="lume-head" cx="120" cy="100" r="31" fill="${C.lavenderLight}" ${line(1.6)}/>
      <path d="M144 84 C154 100 148 122 130 128 C142 118 147 102 144 84 Z" fill="${C.lavenderMid}" opacity="0.5"/>
      <ellipse cx="97" cy="114" rx="5.5" ry="3.2" fill="${C.rose}" opacity="0.45"/>
      <ellipse cx="143" cy="114" rx="5.5" ry="3.2" fill="${C.rose}" opacity="0.45"/>`;

/** Open eyes with highlights; `look` shifts the pupils (x, y) without moving the eye sockets. */
function openEyes([dx, dy] = [0, 0]) {
  const eye = (cx) => `<ellipse cx="${cx + dx}" cy="${101 + dy}" rx="6.4" ry="7.8" fill="${C.ink}"/>
        <circle cx="${cx + dx + 2}" cy="${98 + dy}" r="2.2" fill="${C.white}"/>
        <circle cx="${cx + dx - 2.2}" cy="${104.5 + dy}" r="1" fill="${C.white}" opacity="0.85"/>`;
  const lid = (cx) => `<g class="lume-lid" transform="scale(1 0)">
        <path d="M${cx - 8.4} 95 C${cx - 8.4} 87.6 ${cx + 8.4} 87.6 ${cx + 8.4} 95 V103 Q${cx} 109.5 ${cx - 8.4} 103 Z" fill="${C.lavenderLight}"/>
        <path d="M${cx - 6.6} 104 Q${cx} 108.6 ${cx + 6.6} 104" ${line(2)}/>
      </g>`;
  return `<g class="lume-eyes">
      ${eye(108)}
      ${eye(132)}
      <g class="lume-lids">${lid(108)}${lid(132)}</g>
    </g>`;
}
const arcEyes = (up) => {
  const arc = (cx) =>
    up
      ? `M${cx - 6.5} 103 Q${cx} 94 ${cx + 6.5} 103`
      : `M${cx - 6.5} 100 Q${cx} 106 ${cx + 6.5} 100`;
  return `<g class="lume-eyes lume-eyes-closed"><path d="${arc(108)} ${arc(132)}" ${line(2.2)}/></g>`;
};

const MOUTHS = {
  smile: `<path class="lume-mouth" d="M115.5 113.5 Q120 117.5 124.5 113.5" ${line(1.6)}/>`,
  open: `<path class="lume-mouth" d="M114 112.5 Q120 113.6 126 112.5 Q125 120 120 120 Q115 120 114 112.5 Z" fill="${C.roseDeep}" ${line(1.4)}/>`,
  small: `<path class="lume-mouth" d="M117.5 114 Q120 115.6 122.5 114" ${line(1.5)}/>`,
  hmm: `<path class="lume-mouth" d="M116 115 Q119 113.6 123.5 114.6" ${line(1.5)}/>`,
};

/** Stubby arm from under the collar to a hand point, drawn as an outlined capsule (optional elbow bend). */
function arm(from, to, cls, bend = 0) {
  const [fx, fy] = from;
  const [tx, ty] = to;
  const mx = (fx + tx) / 2 - (ty - fy) * bend;
  const my = (fy + ty) / 2 + (tx - fx) * bend;
  const d = bend
    ? `M${fx} ${fy} Q${round(mx)} ${round(my)} ${tx} ${ty}`
    : `M${fx} ${fy} L${tx} ${ty}`;
  return `<g class="${cls}">
        <path d="${d}" stroke="${C.ink}" stroke-opacity="0.88" stroke-width="12.6" stroke-linecap="round"/>
        <path d="${d}" stroke="${C.lavenderMid}" stroke-width="9.6" stroke-linecap="round"/>
      </g>`;
}

/** A small paw drawn in front of a prop (the arm itself sits behind the collar). */
const paw = (x, y) => `<circle cx="${x}" cy="${y}" r="5" fill="${C.lavenderMid}" ${line(1.5)}/>`;

/** The lantern, hung from a hook at (x, y). `glow` scales the honey light behind it. */
function lantern(x, y, glow = 1, standing = false) {
  const top = standing ? y : y + 7;
  const string = standing
    ? `<path d="M${x - 5} ${top - 1} Q${x} ${top - 9} ${x + 5} ${top - 1}" ${line(1.4)}/>`
    : `<path d="M${x} ${y} L${x} ${top}" ${line(1.4)}/>`;
  return `<g class="lume-lantern">
      <circle class="lume-glow" cx="${x}" cy="${top + 14}" r="${round(22 * glow)}" fill="${C.honey}" opacity="${round(0.16 + 0.08 * glow)}"/>
      ${string}
      <path d="M${x - 7} ${top + 3} L${x - 5} ${top} H${x + 5} L${x + 7} ${top + 3} Z" fill="${C.lavenderDeep}" ${line(1.3)}/>
      <rect x="${x - 8}" y="${top + 3}" width="16" height="21" rx="5" fill="${C.honeyLight}" ${line(1.5)}/>
      <path class="lume-flame" d="M${x} ${top + 8} C${x + 4} ${top + 12} ${x + 4} ${top + 18} ${x} ${top + 19} C${x - 4} ${top + 18} ${x - 4} ${top + 12} ${x} ${top + 8} Z" fill="${C.honey}"/>
      <path d="M${x - 3} ${top + 4} V${top + 23} M${x + 3} ${top + 4} V${top + 23}" ${line(0.9, C.honeyDeep)} opacity="0.6"/>
      <path d="M${x - 6} ${top + 24} H${x + 6} L${x + 4} ${top + 27} H${x - 4} Z" fill="${C.lavenderDeep}" ${line(1.3)}/>
    </g>`;
}

const SLOT = (layer) => `<g class="lume-outfit-slot" data-layer="${layer}"></g>`;
const SHADOW = `<ellipse class="lume-shadow" cx="120" cy="196" rx="44" ry="4.5" fill="${C.ink}" opacity="0.1"/>`;

function figure({ eyes, mouth, arms, props = '', extras = '', droop = 0, behind = '' }) {
  return `${SHADOW}
  <g class="lume-figure">
    ${behind}
    <g class="lume-wings">${wing('l')}${wing('r')}</g>
    ${antennae(droop)}
    <g class="lume-body">
      ${BODY_BACK}
      <g class="lume-arms">${arms}</g>
      ${BODY_FRONT}
    </g>
    ${SLOT('body')}
    ${eyes}
    ${MOUTHS[mouth]}
    ${SLOT('head')}
    ${props}
    <g class="lume-extras">${extras}</g>
  </g>`;
}

const restingArms = `${arm([98, 138], [86, 153], 'lume-arm lume-arm-l', 0.12)}${arm([142, 138], [156, 152], 'lume-arm lume-arm-r', -0.12)}`;

const BOOK = `<g class="lume-book">
      <path d="M92 150 Q106 146 120 152 Q134 146 148 150 L148 172 Q134 168 120 174 Q106 168 92 172 Z" fill="${C.rose}" ${line(1.5)}/>
      <path d="M95 147 Q107 143 120 149 L120 170 Q107 164 95 168 Z" fill="${C.paper}" ${line(1.4)}/>
      <path d="M145 147 Q133 143 120 149 L120 170 Q133 164 145 168 Z" fill="${C.white}" ${line(1.4)}/>
      <path d="M100 153 Q108 151 115 154 M100 158 Q108 156 115 159 M125 154 Q132 151 140 153 M125 159 Q132 156 140 158" ${line(1, C.lavender)} opacity="0.7"/>
      <path d="M128 149 V178 L131 175 L134 178 V150" fill="${C.matcha}" ${line(1.1)}/>
    </g>`;

const thoughtDots = (
  fill,
) => `<circle class="lume-dot lume-dot-1" cx="158" cy="70" r="3.2" fill="${fill[0]}" ${line(1.2)}/>
      <circle class="lume-dot lume-dot-2" cx="169" cy="56" r="4.6" fill="${fill[0]}" ${line(1.2)}/>
      <circle class="lume-dot lume-dot-3" cx="184" cy="40" r="6.4" fill="${fill[1]}" ${line(1.2)}/>`;

export const LUME_STATES = {
  idle: figure({
    eyes: openEyes(),
    mouth: 'smile',
    arms: restingArms,
    props: lantern(157, 155),
  }),
  reading: figure({
    eyes: openEyes([-0.6, 2.6]),
    mouth: 'small',
    arms: `${arm([100, 138], [96, 158], 'lume-arm lume-arm-l', -0.15)}${arm([140, 138], [144, 158], 'lume-arm lume-arm-r', 0.15)}`,
    props: `${lantern(184, 160, 0.8, true)}${BOOK}${paw(95, 159)}${paw(145, 159)}`,
  }),
  thinking: figure({
    eyes: openEyes([2.4, -2.4]),
    mouth: 'hmm',
    arms: `${arm([98, 138], [86, 153], 'lume-arm lume-arm-l', 0.12)}${arm([140, 138], [138, 120], 'lume-arm lume-arm-r', 0.35)}`,
    props: `${lantern(184, 160, 0.8, true)}${paw(138, 120)}`,
    extras: thoughtDots([C.mist, C.mistLight]),
  }),
  happy: figure({
    eyes: arcEyes(true),
    mouth: 'open',
    arms: `${arm([98, 136], [80, 124], 'lume-arm lume-arm-l', -0.1)}${arm([142, 138], [156, 152], 'lume-arm lume-arm-r', -0.12)}`,
    props: lantern(157, 155, 1.1),
    extras: `${sparkle(70, 70, 6, C.honey, ' class="lume-spark"')}${sparkle(178, 80, 4.5, C.honeyLight, ' class="lume-spark"')}`,
  }),
  sleepy: figure({
    eyes: arcEyes(false),
    mouth: 'small',
    droop: 9,
    arms: `${arm([100, 139], [104, 157], 'lume-arm lume-arm-l', -0.2)}${arm([140, 139], [136, 157], 'lume-arm lume-arm-r', 0.2)}`,
    props: lantern(184, 160, 0.55, true),
    extras: thoughtDots([C.mistLight, C.mistPale]),
  }),
  celebrating: figure({
    eyes: arcEyes(true),
    mouth: 'open',
    arms: `${arm([98, 136], [80, 122], 'lume-arm lume-arm-l', -0.1)}${arm([142, 136], [166, 104], 'lume-arm lume-arm-r', -0.1)}`,
    props: `${lantern(168, 100, 1.6)}${paw(166, 103)}`,
    extras: `${sparkle(194, 112, 7, C.honey, ' class="lume-spark"')}${sparkle(146, 80, 4.5, C.honey, ' class="lume-spark"')}${sparkle(196, 152, 4, C.honeyLight, ' class="lume-spark"')}${sparkle(62, 90, 5, C.honeyLight, ' class="lume-spark"')}`,
  }),
};

export const LUME_OUTFITS = {
  'winter-scarf': `<g data-layer="body">
      <path d="M90 128 Q120 146 150 128 L152 138 Q120 158 88 138 Z" fill="${C.rose}" ${line(1.5)}/>
      <path d="M97 133 L95 142 M106 137 L105 147 M116 139 L116 149 M126 139 L127 149 M136 137 L138 146 M145 133 L147 142" ${line(2.4, C.paper)}/>
      <path d="M100 138 Q96 156 102 170 L114 168 Q110 154 112 142 Z" fill="${C.rose}" ${line(1.5)}/>
      <path d="M101 160 L113 158 M102 166 L114 164" ${line(2.2, C.paper)}/>
      <path d="M102 170 L101 176 M106 170 L106 177 M110 169 L111 176" ${line(1.3)}/>
    </g>`,
  raincoat: `<g data-layer="body">
      <path d="M101 134 Q120 142 139 134 C143 150 147 166 150 178 Q120 188 90 178 C93 166 97 150 101 134 Z" fill="${C.mist}" ${line(1.6)}/>
      <path d="M137 140 C141 154 144 166 146 176 Q138 180 130 181 C138 168 139 154 137 140 Z" fill="${C.mistDeep}" opacity="0.4"/>
      <path d="M96 130 Q108 142 120 138 Q132 142 144 130 L141 126 Q120 135 99 126 Z" fill="${C.mistLight}" ${line(1.5)}/>
      <path d="M120 139 V184" ${line(1.2)}/>
      <circle cx="125" cy="151" r="2.3" fill="${C.honey}" ${line(1)}/>
      <circle cx="125" cy="164" r="2.3" fill="${C.honey}" ${line(1)}/>
      <circle cx="125" cy="177" r="2.3" fill="${C.honey}" ${line(1)}/>
    </g>
    <g data-layer="head">
      <path d="M86 84 Q90 58 120 56 Q150 58 154 84 Q120 74 86 84 Z" fill="${C.honey}" ${line(1.6)}/>
      <path d="M78 86 Q120 70 162 86 Q164 92 156 92 Q120 80 84 92 Q76 92 78 86 Z" fill="${C.honeyLight}" ${line(1.5)}/>
      <path d="M100 62 Q104 70 104 78" ${line(1.1, C.honeyDeep)} opacity="0.7"/>
    </g>`,
  'reading-glasses': `<g data-layer="head">
      <circle cx="108" cy="102" r="10.5" fill="${C.mistPale}" fill-opacity="0.35" ${line(1.8, C.honeyDeep)}/>
      <circle cx="132" cy="102" r="10.5" fill="${C.mistPale}" fill-opacity="0.35" ${line(1.8, C.honeyDeep)}/>
      <path d="M118.5 100 Q120 97.5 121.5 100 M97.5 100 L90 97 M142.5 100 L150 97" ${line(1.6, C.honeyDeep)}/>
      <path d="M102 96 Q105 93.5 108 94" ${line(1.2, C.white)}/>
      <path d="M126 96 Q129 93.5 132 94" ${line(1.2, C.white)}/>
    </g>`,
  'explorer-hat': `<g data-layer="head">
      <path d="M96 76 Q98 54 120 52 Q142 54 144 76 Z" fill="${C.wood}" ${line(1.6)}/>
      <path d="M97 70 Q120 64 143 70 L144 76 Q120 70 96 76 Z" fill="${C.matcha}" ${line(1.3)}/>
      <path d="M78 80 Q120 64 162 80 Q166 86 156 87 Q120 76 84 87 Q74 86 78 80 Z" fill="${C.woodLight}" ${line(1.6)}/>
      <path d="M120 53 Q118 62 120 70" ${line(1.1, C.woodDeep)} opacity="0.6"/>
    </g>`,
};

export function lumeFiles() {
  const files = {};
  for (const [state, body] of Object.entries(LUME_STATES))
    files[`characters/lume/lume-${state}.svg`] = svg({
      id: `character.lume.${state}`,
      width: SIZE,
      height: SIZE,
      body,
      extra: ` class="lume" data-lume-state="${state}"`,
    });
  for (const [outfit, body] of Object.entries(LUME_OUTFITS))
    files[`characters/lume/outfits/${outfit}.svg`] = svg({
      id: `character.lume.outfit.${outfit}`,
      width: SIZE,
      height: SIZE,
      body,
      extra: ` class="lume-outfit" data-lume-outfit="${outfit}"`,
    });
  return files;
}
