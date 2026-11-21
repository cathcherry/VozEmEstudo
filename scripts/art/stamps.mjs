// Round perforated postage stamps (120 × 120), one per learning event. Motif inside a 64 px circle.
import { C, line, svg, perforatedCircle, sparkle } from './lib.mjs';

const S = 120;
const base = (
  pale,
  ring,
) => `<path d="${perforatedCircle(60, 60, 57, 30, 3.2)}" fill="${C.white}" ${line(1.4)}/>
  <circle cx="60" cy="60" r="46" fill="${pale}" stroke="${ring}" stroke-width="3"/>
  <circle cx="60" cy="60" r="50.5" stroke="${C.ink}" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="1.5 3"/>`;

/** Outlined capsule stroke, used for handles, pencils and stems. */
const capsule = (d, width, fill) =>
  `<path d="${d}" stroke="${C.ink}" stroke-opacity="0.88" stroke-width="${width + 3}" stroke-linecap="round"/><path d="${d}" stroke="${fill}" stroke-width="${width}" stroke-linecap="round"/>`;

const MOTIFS = {
  'first-evidence': {
    tint: [C.honeyPale, C.honeyLight],
    body: `<g transform="rotate(-8 56 58)">
        <rect x="36" y="34" width="36" height="46" rx="3.5" fill="${C.white}" ${line(1.8)}/>
        <path d="M43 44 H65 M43 51 H62 M43 58 H66 M43 65 H58" ${line(1.6, C.lavender)}/>
      </g>
      ${capsule('M79 77 L89 88', 5.5, C.wood)}
      <circle cx="70" cy="66" r="14" fill="${C.mistPale}" fill-opacity="0.85" ${line(2.2)}/>
      <path d="M63 62 Q63 58 67 58 M70 62 Q70 58 74 58" ${line(2.4, C.honeyDeep)}/>
      <path d="M62 71 Q66 67 70 69" ${line(1.4, C.white)}/>`,
  },
  'own-explanation': {
    tint: [C.lavenderPale, C.lavenderLight],
    body: `<path d="M38 38 H74 A8 8 0 0 1 82 46 V64 A8 8 0 0 1 74 72 H55 L45 81 V72 H38 A8 8 0 0 1 30 64 V46 A8 8 0 0 1 38 38 Z" fill="${C.white}" ${line(1.8)}/>
      <path d="M38 55 Q42 49 46 55 T54 55 T62 55" ${line(2, C.lavender)}/>
      <g transform="rotate(-50 76 70)">
        <rect x="58" y="65" width="30" height="10" rx="2" fill="${C.honey}" ${line(1.6)}/>
        <rect x="82" y="65" width="7" height="10" rx="2" fill="${C.roseLight}" ${line(1.4)}/>
        <path d="M58 65 L49 70 L58 75 Z" fill="${C.woodLight}" ${line(1.4)}/>
        <path d="M52.5 68 L49 70 L52.5 72 Z" fill="${C.ink}"/>
      </g>`,
  },
  revisit: {
    tint: [C.mistPale, C.mistLight],
    body: `<path d="M40.3 46.2 A24 24 0 1 1 36.8 66.2" ${line(3, C.mistDeep)}/>
      <path d="M46.7 45.1 L39.2 47.9 L39.2 39.9" ${line(3, C.mistDeep)}/>
      <path d="M52 44 H68 V78 L60 71 L52 78 Z" fill="${C.rose}" ${line(1.8)}/>
      <path d="M56 50 H64" ${line(1.4, C.white)}/>`,
  },
  connection: {
    tint: [C.matchaPale, C.matchaLight],
    body: `<path d="M44 66 Q52 44 76 52 M44 66 Q50 82 62 82 M76 52 Q78 76 62 82" ${line(1.6, C.matchaDeep)} stroke-dasharray="3 3.5"/>
      <circle cx="44" cy="66" r="11" fill="${C.lavenderLight}" ${line(1.8)}/>
      <circle cx="76" cy="52" r="12" fill="${C.honeyLight}" ${line(1.8)}/>
      <circle cx="62" cy="82" r="7" fill="${C.mist}" ${line(1.8)}/>
      <path d="M40 63 Q44 60 47 63 M72 49 Q76 45 80 49" ${line(1.4, C.white)}/>
      ${sparkle(60, 38, 5, C.matcha)}`,
  },
  'first-investigation': {
    tint: [C.rosePale, C.roseLight],
    body: `<circle cx="60" cy="60" r="24" fill="${C.white}" ${line(2)}/>
      <circle cx="60" cy="60" r="18.5" stroke="${C.rose}" stroke-width="1.4" stroke-dasharray="2 3.4"/>
      <path d="M60 33 V38 M60 82 V87 M33 60 H38 M82 60 H87" ${line(2)}/>
      <path d="M60 42 L66 60 L60 60 Z" fill="${C.roseDeep}" ${line(1.4)}/>
      <path d="M60 42 L54 60 L60 60 Z" fill="${C.rose}" ${line(1.4)}/>
      <path d="M60 78 L54 60 L66 60 Z" fill="${C.lavenderLight}" ${line(1.4)}/>
      <circle cx="60" cy="60" r="2.6" fill="${C.honey}" ${line(1.2)}/>`,
  },
  'careful-reviewer': {
    tint: [C.matchaPale, C.matchaLight],
    body: `<rect x="38" y="40" width="40" height="30" rx="4" transform="rotate(-12 58 55)" fill="${C.lavenderPale}" ${line(1.6)}/>
      <rect x="40" y="44" width="40" height="30" rx="4" transform="rotate(-4 60 59)" fill="${C.mistPale}" ${line(1.6)}/>
      <rect x="42" y="50" width="40" height="30" rx="4" transform="rotate(5 62 65)" fill="${C.white}" ${line(1.8)}/>
      <path d="M52 65 L59 72 L73 57" ${line(3.2, C.matcha)}/>`,
  },
  'curious-question': {
    tint: [C.mistPale, C.mistLight],
    body: `<path d="M50 50 C50 38 70 36 72 48 C74 58 62 60 61 70 V74" ${line(4, C.matchaDeep)}/>
      <path d="M50 50 C50 44 58 42 60 47 C62 52 56 54 55 50" ${line(2.4, C.matchaDeep)}/>
      <path d="M71 44 Q80 38 82 44 Q78 49 72 48 Z M73 56 Q82 54 82 60 Q76 63 70 59 Z M62 64 Q53 61 51 66 Q56 70 62 68 Z" fill="${C.matchaLight}" ${line(1.4)}/>
      <circle cx="61" cy="84" r="4" fill="${C.honey}" ${line(1.6)}/>`,
  },
  'gentle-evening': {
    tint: [C.lavenderLight, C.lavenderMid],
    body: `<path d="M66 32 A20 20 0 1 0 82 58 A15 15 0 1 1 66 32 Z" fill="${C.honeyLight}" ${line(1.8)}/>
      ${sparkle(44, 42, 4, C.white)}${sparkle(86, 40, 3, C.white)}
      <path d="M40 70 H70 V74 A12 12 0 0 1 58 86 H52 A12 12 0 0 1 40 74 Z" fill="${C.white}" ${line(1.8)}/>
      <path d="M70 73 A5 5 0 0 1 70 81" ${line(1.8)}/>
      <path d="M50 66 Q47 62 50 58 M58 66 Q55 62 58 58" ${line(1.6, C.white)}/>`,
  },
  'first-discovery': {
    tint: [C.honeyPale, C.honeyLight],
    body: `<path d="M30 48 Q45 42 60 48 Q75 42 90 48 V80 Q75 74 60 80 Q45 74 30 80 Z" fill="${C.white}" ${line(1.8)}/>
      <path d="M60 48 V80" ${line(1.4)}/>
      <path d="M38 72 Q44 60 50 54" ${line(1.6, C.matchaDeep)}/>
      <path d="M44 63 Q38 60 38 55 Q44 56 45 62 Z M48 58 Q50 52 54 52 Q54 57 49 59 Z" fill="${C.matchaLight}" ${line(1.2)}/>
      <circle cx="50" cy="53" r="2.6" fill="${C.rose}" ${line(1)}/>
      <path d="M66 58 H82 M66 64 H80 M66 70 H78" ${line(1.4, C.lavender)}/>
      ${sparkle(76, 36, 7, C.honey)}`,
  },
  'first-reflection': {
    tint: [C.mistPale, C.mistLight],
    body: `<path d="M28 70 Q60 62 92 70 Q60 82 28 70 Z" fill="${C.mist}" opacity="0.55"/>
      <path d="M32 70 Q60 64 88 70" ${line(1.4, C.mistDeep)}/>
      <circle cx="60" cy="48" r="11" fill="${C.honeyLight}" ${line(1.6)}/>
      <circle cx="64" cy="45" r="9" fill="${C.mistPale}"/>
      <path d="M50 76 Q60 80 70 76" ${line(1.6, C.honeyDeep)} opacity="0.75"/>
      <path d="M54 82 Q60 84 66 82" ${line(1.4, C.honeyDeep)} opacity="0.45"/>
      <path d="M40 88 H52 M68 88 H80" ${line(1.2, C.mistDeep)} opacity="0.6"/>
      ${sparkle(84, 40, 6, C.honey)}`,
  },
  'deep-focus': {
    tint: [C.mistPale, C.mistLight],
    body: `<circle cx="60" cy="64" r="22" fill="${C.honey}" opacity="0.28"/>
      <path d="M53 38 Q60 30 67 38" ${line(1.8)}/>
      <path d="M50 46 L53 41 H67 L70 46 Z" fill="${C.lavenderDeep}" ${line(1.6)}/>
      <rect x="48" y="46" width="24" height="30" rx="7" fill="${C.honeyLight}" ${line(1.8)}/>
      <path d="M60 52 C66 58 66 66 60 68 C54 66 54 58 60 52 Z" fill="${C.honey}"/>
      <path d="M55 47 V75 M65 47 V75" ${line(1.1, C.honeyDeep)} opacity="0.6"/>
      <path d="M51 76 H69 L66 81 H54 Z" fill="${C.lavenderDeep}" ${line(1.6)}/>`,
  },
  'shared-note': {
    tint: [C.rosePale, C.roseLight],
    body: `<path d="M34 76 Q44 84 54 78" ${line(1.6, C.roseDeep)} stroke-dasharray="2.5 3.5"/>
      <path d="M36 62 L86 40 L66 82 L58 66 Z" fill="${C.white}" ${line(1.8)}/>
      <path d="M58 66 L86 40 L52 70 Z" fill="${C.mistLight}" ${line(1.6)}/>
      <path d="M58 66 L62 76" ${line(1.4)}/>`,
  },
  'new-subject': {
    tint: [C.matchaPale, C.matchaLight],
    body: `<path d="M32 70 Q46 64 60 70 Q74 64 88 70 V84 Q74 78 60 84 Q46 78 32 84 Z" fill="${C.rose}" ${line(1.8)}/>
      <path d="M34 68 Q47 62 60 68 V80 Q47 74 34 80 Z M86 68 Q73 62 60 68 V80 Q73 74 86 80 Z" fill="${C.white}" ${line(1.6)}/>
      <path d="M60 68 V44" ${line(2.4, C.matchaDeep)}/>
      <path d="M60 54 C50 54 44 46 44 38 C54 38 60 44 60 54 Z" fill="${C.matchaLight}" ${line(1.6)}/>
      <path d="M60 48 C68 48 76 42 76 32 C66 32 60 38 60 48 Z" fill="${C.matcha}" ${line(1.6)}/>`,
  },
};

export const STAMP_IDS = Object.keys(MOTIFS);

export function stampFiles() {
  const files = {};
  for (const [name, { tint, body }] of Object.entries(MOTIFS))
    files[`stamps/${name}.svg`] = svg({
      id: `stamp.${name}`,
      width: S,
      height: S,
      body: `${base(...tint)}\n  ${body}`,
    });
  return files;
}
