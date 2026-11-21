// Desk objects (160 × 160): front-on, standing on a shared baseline (y ≈ 138) with a soft shadow.
import { C, line, svg, groundShadow } from './lib.mjs';

const S = 160;
const capsule = (d, width, fill) =>
  `<path d="${d}" stroke="${C.ink}" stroke-opacity="0.88" stroke-width="${width + 3}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" stroke="${fill}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

const OBJECTS = {
  'desk-lamp': `${groundShadow(80, 140, 50)}
    <path d="M100 86 L124 80 L146 138 L92 138 Z" fill="${C.honey}" opacity="0.16"/>
    <ellipse cx="118" cy="139" rx="26" ry="4" fill="${C.honey}" opacity="0.32"/>
    <ellipse cx="54" cy="136" rx="24" ry="5.5" fill="${C.lavenderDeep}" ${line(1.8)}/>
    <path d="M32 134 Q32 124 54 124 Q76 124 76 134" fill="${C.lavender}" ${line(1.8)}/>
    ${capsule('M54 126 L70 88', 5, C.lavenderMid)}
    ${capsule('M70 88 L102 66', 5, C.lavenderMid)}
    <circle cx="70" cy="88" r="5" fill="${C.honeyLight}" ${line(1.6)}/>
    <g transform="translate(110 72) rotate(-18)">
      <ellipse cx="0" cy="12" rx="17" ry="5" fill="${C.honeyPale}" ${line(1.6)}/>
      <circle cx="0" cy="13" r="5" fill="${C.honey}"/>
      <path d="M-17 12 C-17 -4 -10 -12 0 -13 C10 -12 17 -4 17 12 C10 8 -10 8 -17 12 Z" fill="${C.matcha}" ${line(1.8)}/>
      <path d="M-9 -4 Q-6 -9 -1 -10" ${line(1.6, C.white)}/>
      <circle cx="0" cy="-14" r="3" fill="${C.matchaDeep}" ${line(1.4)}/>
    </g>`,
  teacup: `${groundShadow(80, 140, 44)}
    <path d="M68 84 Q64 76 68 68 Q72 60 68 52 M88 84 Q84 76 88 68 Q92 60 88 52" ${line(1.8, C.mistDeep)} opacity="0.7"/>
    <ellipse cx="80" cy="134" rx="40" ry="8" fill="${C.white}" ${line(1.8)}/>
    <ellipse cx="80" cy="132" rx="24" ry="4" fill="${C.lavenderPale}"/>
    <path d="M108 102 C126 100 126 124 104 122" ${line(5.5, C.ink)}/>
    <path d="M108 102 C126 100 126 124 104 122" stroke="${C.rose}" stroke-width="3" stroke-linecap="round"/>
    <path d="M50 94 H110 V104 Q110 130 80 130 Q50 130 50 104 Z" fill="${C.rose}" ${line(1.8)}/>
    <path d="M100 98 Q104 122 86 128 Q102 126 106 108 Z" fill="${C.roseDeep}" opacity="0.35"/>
    <path d="M52 108 Q80 116 108 108" ${line(3, C.white)} stroke-dasharray="0.1 6"/>
    <ellipse cx="80" cy="94" rx="30" ry="7" fill="${C.white}" ${line(1.8)}/>
    <ellipse cx="80" cy="95" rx="25" ry="4.6" fill="${C.matcha}"/>
    <path d="M66 94 Q72 92 78 93" ${line(1.2, C.matchaLight)}/>`,
  'pressed-flower-jar': `${groundShadow(80, 140, 36)}
    <path d="M62 52 H98 V60 Q110 64 110 78 V124 Q110 138 96 138 H64 Q50 138 50 124 V78 Q50 64 62 60 Z" fill="${C.mistPale}" fill-opacity="0.75" ${line(1.8)}/>
    <path d="M70 136 Q68 112 72 92 M80 136 Q81 108 86 84 M90 136 Q92 118 96 102" ${line(1.6, C.matchaDeep)}/>
    <path d="M74 112 Q64 108 64 100 Q72 102 74 110 Z M86 108 Q96 104 98 96 Q90 98 86 106 Z" fill="${C.matchaLight}" ${line(1.2)}/>
    <g ${line(1.3)}>
      <circle cx="72" cy="88" r="7" fill="${C.rose}"/><circle cx="72" cy="88" r="2.6" fill="${C.honeyLight}"/>
      <circle cx="87" cy="80" r="8" fill="${C.lavenderLight}"/><circle cx="87" cy="80" r="3" fill="${C.honey}"/>
      <circle cx="97" cy="98" r="5.5" fill="${C.honeyLight}"/><circle cx="97" cy="98" r="2" fill="${C.honeyDeep}"/>
    </g>
    <path d="M57 76 V122" ${line(3, C.white, 0.9)}/>
    <rect x="58" y="40" width="44" height="14" rx="3" fill="${C.wood}" ${line(1.8)}/>
    <path d="M62 46 H98" ${line(1.2, C.woodDeep)} opacity="0.6"/>
    <path d="M60 58 Q80 64 100 58" ${line(1.6, C.roseDeep)}/>`,
  globe: `${groundShadow(80, 140, 34)}
    <ellipse cx="80" cy="136" rx="26" ry="5.5" fill="${C.wood}" ${line(1.8)}/>
    ${capsule('M80 132 Q80 120 66 114', 6, C.wood)}
    <circle cx="80" cy="74" r="34" fill="${C.mist}" ${line(1.8)}/>
    <g clip-path="url(#globe-clip)">
      <path d="M58 52 Q66 42 78 46 Q86 52 80 60 Q74 66 78 74 Q72 82 62 76 Q54 66 58 52 Z M88 74 Q98 70 106 78 Q110 92 100 100 Q92 104 90 94 Q86 84 88 74 Z M60 92 Q70 92 72 100 Q66 106 58 102 Z" fill="${C.matchaLight}" ${line(1.4)}/>
      <path d="M86 40 Q100 40 108 54" ${line(1.4, C.matchaDeep)} opacity="0.5"/>
    </g>
    <path d="M60 58 Q66 48 76 46" ${line(2, C.white, 0.8)}/>
    <path d="M104 98 A34 34 0 0 0 80 40" ${line(1.4, C.mistDeep)} opacity="0.5"/>
    <path d="M64 112 A41.2 41.2 0 0 1 96 36" ${line(5.5, C.ink)}/>
    <path d="M64 112 A41.2 41.2 0 0 1 96 36" stroke="${C.honey}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="65" cy="112" r="3.6" fill="${C.honeyLight}" ${line(1.4)}/>
    <circle cx="95" cy="37" r="3.6" fill="${C.honeyLight}" ${line(1.4)}/>`,
  inkwell: `${groundShadow(80, 140, 40)}
    <path d="M44 136 Q40 110 58 102 H98 Q116 110 112 136 Z" fill="${C.lavenderDeep}" ${line(1.8)}/>
    <path d="M100 108 Q110 118 106 134 H96 Q104 120 100 108 Z" fill="${C.ink}" opacity="0.25"/>
    <path d="M54 112 Q56 106 62 105" ${line(2.4, C.white, 0.7)}/>
    <rect x="64" y="90" width="28" height="14" rx="3" fill="${C.lavender}" ${line(1.8)}/>
    <ellipse cx="78" cy="90" rx="14" ry="3.5" fill="${C.ink}" ${line(1.6)}/>
    <path d="M78 92 C86 70 104 42 132 18 C124 36 110 58 92 76 C88 80 82 86 78 92 Z" fill="${C.white}" ${line(1.8)}/>
    <path d="M80 89 C92 70 108 48 128 24" ${line(1.3, C.mistDeep)}/>
    <path d="M96 66 L104 66 M102 56 L111 56 M108 46 L117 45 M89 76 L96 77" ${line(1, C.mistDeep)} opacity="0.7"/>
    <path d="M84 80 Q90 76 96 78" ${line(1.6, C.mist)}/>`,
  cactus: `${groundShadow(80, 140, 34)}
    <path d="M56 86 Q38 86 36 70 Q35 58 42 58 Q49 58 48 68 Q48 74 56 74 Z" fill="${C.matcha}" ${line(1.8)}/>
    <path d="M40 62 Q40 72 46 78" ${line(1.2, C.matchaDeep)} opacity="0.6"/>
    <path d="M60 30 Q80 22 100 30 Q114 44 112 68 Q110 90 100 100 H60 Q50 90 48 68 Q46 44 60 30 Z" fill="${C.matcha}" ${line(1.8)}/>
    <path d="M80 28 V100 M66 32 Q60 60 66 100 M94 32 Q100 60 94 100" ${line(1.3, C.matchaDeep)} opacity="0.6"/>
    <path d="M100 34 Q110 50 106 76 Q102 90 96 96 Q104 70 100 34 Z" fill="${C.matchaDeep}" opacity="0.3"/>
    <g fill="${C.honeyPale}">
      <circle cx="73" cy="44" r="1.4"/><circle cx="87" cy="52" r="1.4"/><circle cx="73" cy="64" r="1.4"/>
      <circle cx="87" cy="76" r="1.4"/><circle cx="59" cy="56" r="1.4"/><circle cx="101" cy="60" r="1.4"/>
      <circle cx="61" cy="78" r="1.4"/><circle cx="99" cy="84" r="1.4"/>
    </g>
    <g ${line(1.3)}>
      <path d="M80 24 Q72 14 76 10 Q80 14 80 22 Z M80 24 Q88 14 84 10 Q80 14 80 22 Z" fill="${C.rose}"/>
      <path d="M80 24 Q70 20 68 14 Q76 14 80 22 Z M80 24 Q90 20 92 14 Q84 14 80 22 Z" fill="${C.roseLight}"/>
    </g>
    <rect x="50" y="96" width="60" height="12" rx="3" fill="${C.roseLight}" ${line(1.8)}/>
    <path d="M56 108 H104 L98 136 H62 Z" fill="${C.rose}" ${line(1.8)}/>
    <path d="M60 118 H100" ${line(3, C.white)} stroke-dasharray="0.1 7"/>
    <path d="M96 110 L92 134 H86 Q94 124 96 110 Z" fill="${C.roseDeep}" opacity="0.35"/>`,
  hourglass: `${groundShadow(80, 140, 34)}
    <path d="M62 38 Q62 70 77 84 Q62 98 62 128 H98 Q98 98 83 84 Q98 70 98 38 Z" fill="${C.mistPale}" fill-opacity="0.8" ${line(1.8)}/>
    <path d="M67 62 Q70 74 78 80 H82 Q90 74 93 62 Z" fill="${C.honey}"/>
    <path d="M80 82 V118" ${line(1.4, C.honeyDeep)}/>
    <path d="M64 128 Q66 112 80 110 Q94 112 96 128 Z" fill="${C.honey}"/>
    <path d="M67 46 Q66 64 74 76" ${line(2.2, C.white, 0.85)}/>
    ${capsule('M56 36 V130', 4, C.wood)}
    ${capsule('M104 36 V130', 4, C.wood)}
    <rect x="48" y="28" width="64" height="10" rx="3.5" fill="${C.wood}" ${line(1.8)}/>
    <rect x="48" y="128" width="64" height="10" rx="3.5" fill="${C.wood}" ${line(1.8)}/>
    <path d="M52 33 H108 M52 133 H108" ${line(1.2, C.woodDeep)} opacity="0.5"/>`,
  'magnifying-glass': `${groundShadow(80, 140, 46)}
    <path d="M98 100 L128 132" ${line(12, C.wood)}/>
    <path d="M101 104 L126 131" ${line(2, C.woodLight)} opacity="0.7"/>
    <rect x="93" y="93" width="14" height="12" rx="3" transform="rotate(43 100 99)" fill="${C.honey}" ${line(1.6)}/>
    <circle cx="72" cy="70" r="34" fill="${C.honey}" ${line(1.8)}/>
    <circle cx="72" cy="70" r="27" fill="${C.mistPale}" fill-opacity="0.85" ${line(1.6)}/>
    <path d="M58 58 Q64 50 74 49" ${line(3, C.white, 0.9)}/>
    <path d="M62 80 Q68 72 78 74 Q84 76 86 70" ${line(1.4, C.matchaDeep)} opacity="0.7"/>
    <path d="M70 75 Q66 70 68 66 Q73 68 72 74 Z" fill="${C.matchaLight}" ${line(1.1)}/>`,
  'specimen-box': `${groundShadow(80, 140, 58)}
    <rect x="24" y="56" width="112" height="82" rx="5" fill="${C.wood}" ${line(1.8)}/>
    <rect x="32" y="64" width="96" height="66" rx="2" fill="${C.paper}" ${line(1.5)}/>
    <g>
      <path d="M50 108 Q42 92 50 78 Q60 90 52 108 Z" fill="${C.matchaLight}" ${line(1.4)}/>
      <path d="M50 78 Q50 94 51 112" ${line(1.2, C.matchaDeep)}/>
      <path d="M74 98 a8 8 0 1 1 8 -8 a5 5 0 1 1 -5 -5 a2.6 2.6 0 1 1 2.6 2.6" fill="${C.honeyPale}" ${line(1.5)}/>
      <path d="M100 112 C100 100 104 86 114 76 C112 90 108 102 100 112 Z" fill="${C.white}" ${line(1.4)}/>
      <path d="M100 112 L112 80" ${line(1.1, C.mistDeep)}/>
      <circle cx="78" cy="117" r="5" fill="${C.rose}" ${line(1.2)}/><circle cx="78" cy="117" r="1.8" fill="${C.honeyLight}"/>
    </g>
    <g fill="${C.inkSoft}"><circle cx="50" cy="80" r="1.4"/><circle cx="78" cy="82" r="1.4"/><circle cx="112" cy="79" r="1.4"/></g>
    <path d="M40 124 H58 M66 106 H88 M96 122 H118" ${line(2.2, C.woodLight)}/>
    <path d="M40 128 L70 66 M86 128 L112 74" ${line(5, C.white, 0.45)}/>
    <path d="M24 64 H136" ${line(1.2, C.woodDeep)} opacity="0.5"/>`,
};

export const OBJECT_IDS = Object.keys(OBJECTS);

export function objectFiles() {
  const files = {};
  for (const [name, body] of Object.entries(OBJECTS))
    files[`objects/${name}.svg`] = svg({
      id: `object.${name}`,
      width: S,
      height: S,
      body,
      defs:
        name === 'globe'
          ? '<clipPath id="globe-clip"><circle cx="80" cy="74" r="33"/></clipPath>'
          : '',
    });
  return files;
}
