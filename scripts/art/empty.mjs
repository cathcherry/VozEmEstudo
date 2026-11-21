// Empty-state illustrations (320 × 240, 4:3). Each shows a space with room for the first item,
// often with a dashed "ghost" outline of what will arrive: an invitation, never a reproach.
import { C, line, svg, groundShadow, sparkle } from './lib.mjs';

const W = 320;
const H = 240;
const ghost = `stroke="${C.lavender}" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round" stroke-linejoin="round"`;
const capsule = (d, width, fill) =>
  `<path d="${d}" stroke="${C.ink}" stroke-opacity="0.88" stroke-width="${width + 3}" stroke-linecap="round"/><path d="${d}" stroke="${fill}" stroke-width="${width}" stroke-linecap="round"/>`;
const backdrop = (fill) => `<ellipse cx="160" cy="128" rx="138" ry="96" fill="${fill}"/>`;

const SCENES = {
  library: `${backdrop(C.lavenderPale)}
  ${groundShadow(160, 206, 120, 8, 0.08)}
  <path d="M72 170 V196 M248 170 V196" ${line(3, C.woodDeep)}/>
  <rect x="52" y="160" width="216" height="12" rx="3" fill="${C.wood}" ${line(1.8)}/>
  <rect x="76" y="104" width="22" height="56" rx="3" fill="${C.lavender}" ${line(1.8)}/>
  <path d="M80 114 H94 M80 150 H94" ${line(1.4, C.lavenderPale)}/>
  <rect x="100" y="98" width="20" height="62" rx="3" transform="rotate(12 110 160)" fill="${C.mist}" ${line(1.8)}/>
  <rect x="148" y="102" width="26" height="58" rx="3" ${ghost}/>
  <rect x="180" y="110" width="22" height="50" rx="3" ${ghost}/>
  <rect x="208" y="148" width="44" height="12" rx="2" fill="${C.rose}" ${line(1.6)}/>
  <rect x="212" y="137" width="38" height="11" rx="2" fill="${C.matchaLight}" ${line(1.6)}/>
  <path d="M224 137 C224 126 216 120 210 122 C212 130 218 134 224 137 Z M226 137 C228 124 236 118 242 120 C240 130 232 134 226 137 Z" fill="${C.matcha}" ${line(1.4)}/>
  ${sparkle(164, 82, 6, C.honey)}`,
  discoveries: `${backdrop(C.honeyPale)}
  ${groundShadow(160, 204, 126, 8, 0.08)}
  <path d="M40 186 Q100 172 160 184 Q220 172 280 186 L280 196 Q220 182 160 196 Q100 182 40 196 Z" fill="${C.lavender}" ${line(1.8)}/>
  <path d="M46 70 Q104 58 160 72 V188 Q104 174 46 186 Z" fill="${C.white}" ${line(1.8)}/>
  <path d="M274 70 Q216 58 160 72 V188 Q216 174 274 186 Z" fill="${C.paper}" ${line(1.8)}/>
  <path d="M160 72 V188" ${line(1.4)}/>
  <circle cx="104" cy="118" r="26" ${ghost}/>
  <path d="M182 100 H252 M182 116 H246 M182 132 H252 M182 148 H238" ${line(1.6, C.lavenderLight)}/>
  <path d="M66 166 Q76 150 92 146" ${line(1.4, C.matchaDeep)}/>
  <path d="M76 156 Q68 150 70 144 Q78 148 77 155 Z M84 150 Q86 142 92 142 Q90 149 85 151 Z" fill="${C.matchaLight}" ${line(1.2)}/>
  <g transform="rotate(-24 236 170)">
    <rect x="206" y="164" width="56" height="10" rx="2" fill="${C.honey}" ${line(1.6)}/>
    <path d="M206 164 L194 169 L206 174 Z" fill="${C.woodLight}" ${line(1.4)}/>
    <rect x="256" y="164" width="8" height="10" rx="2" fill="${C.roseLight}" ${line(1.4)}/>
  </g>`,
  flashcards: `${backdrop(C.mistPale)}
  ${groundShadow(160, 204, 100, 8, 0.08)}
  <g transform="translate(0 22)">
  <rect x="96" y="70" width="128" height="88" rx="10" transform="rotate(-12 160 114)" fill="${C.lavenderPale}" ${line(1.8)}/>
  <rect x="96" y="70" width="128" height="88" rx="10" transform="rotate(8 160 114)" fill="${C.matchaPale}" ${line(1.8)}/>
  <rect x="96" y="76" width="128" height="88" rx="10" fill="${C.white}" ${line(1.8)}/>
  <rect x="112" y="92" width="96" height="56" rx="6" ${ghost}/>
  <path d="M160 108 V132 M148 120 H172" ${line(2.4, C.lavender)}/>
  </g>
  ${sparkle(236, 70, 7, C.honey)}${sparkle(84, 168, 4.5, C.honeyLight)}`,
  planner: `${backdrop(C.matchaPale)}
  ${groundShadow(150, 206, 110, 8, 0.08)}
  <rect x="58" y="44" width="170" height="156" rx="10" fill="${C.white}" ${line(1.8)}/>
  <path d="M58 54 A10 10 0 0 1 68 44 H218 A10 10 0 0 1 228 54 V74 H58 Z" fill="${C.matcha}" ${line(1.8)}/>
  <path d="M86 36 V52 M200 36 V52" ${line(4, C.lavenderDeep)}/>
  <g ${line(1, C.lavenderLight)}>
    <path d="M58 106 H228 M58 138 H228 M58 170 H228"/>
    <path d="M82 74 V200 M106 74 V200 M130 74 V200 M154 74 V200 M178 74 V200 M204 74 V200"/>
  </g>
  <circle cx="142" cy="122" r="11" fill="${C.honeyLight}" ${line(1.6)}/>
  <rect x="164" y="146" width="56" height="18" rx="5" ${ghost}/>
  <ellipse cx="266" cy="203" rx="28" ry="5" fill="${C.white}" ${line(1.6)}/>
  <path d="M246 178 H286 V184 A16 16 0 0 1 270 200 H262 A16 16 0 0 1 246 184 Z" fill="${C.rose}" ${line(1.8)}/>
  <path d="M286 182 A6 6 0 0 1 286 192" ${line(2)}/>
  <path d="M260 170 Q256 162 260 154 M272 170 Q268 162 272 154" ${line(1.6, C.mistDeep, 0.7)}/>`,
  classrooms: `${backdrop(C.rosePale)}
  ${groundShadow(160, 206, 120, 8, 0.08)}
  ${capsule('M110 196 L126 64', 4, C.wood)}
  ${capsule('M210 196 L194 64', 4, C.wood)}
  <rect x="96" y="54" width="128" height="88" rx="6" fill="${C.wood}" ${line(1.8)}/>
  <rect x="104" y="62" width="112" height="72" rx="3" fill="${C.matchaDeep}" ${line(1.4)}/>
  <path d="M120 96 Q140 80 160 96 T200 96" ${line(2, C.white, 0.75)}/>
  ${sparkle(184, 78, 6, C.white)}
  <path d="M116 146 H204" ${line(4, C.woodDeep)}/>
  <rect x="190" y="139" width="14" height="5" rx="2" fill="${C.white}" ${line(1)}/>
  <g>
    <rect x="44" y="170" width="44" height="8" rx="3" fill="${C.lavenderMid}" ${line(1.6)}/>
    <path d="M50 178 V202 M82 178 V202" ${line(3, C.lavenderDeep)}/>
    <rect x="232" y="170" width="44" height="8" rx="3" ${ghost}/>
    <path d="M238 178 V202 M270 178 V202" ${ghost}/>
  </g>
`,
};

export const EMPTY_IDS = Object.keys(SCENES);

export function emptyFiles() {
  const files = {};
  for (const [name, body] of Object.entries(SCENES))
    files[`empty/${name}.svg`] = svg({ id: `empty.${name}`, width: W, height: H, body });
  return files;
}
