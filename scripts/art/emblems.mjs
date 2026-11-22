// Discipline emblems (64 × 64): one small stationery motif on a tinted label plate. Read at
// 32–96 px: the plate's tint names the family, the motif names the subject. Ink line 2.2 for the
// main shapes and 1.6 for details (≈ 1.1 px at 32 px), flat fills, one white highlight.
import { C, line, svg } from './lib.mjs';

const S = 64;

/** Tint families: plate (pale), border (deep), motif fills (base / light). */
export const FAMILY = {
  lavender: {
    pale: C.lavenderPale,
    light: C.lavenderLight,
    base: C.lavenderMid,
    deep: C.lavenderDeep,
  },
  matcha: { pale: C.matchaPale, light: C.matchaLight, base: C.matcha, deep: C.matchaDeep },
  honey: { pale: C.honeyPale, light: C.honeyLight, base: C.honey, deep: C.honeyDeep },
  mist: { pale: C.mistPale, light: C.mistLight, base: C.mist, deep: C.mistDeep },
  rose: { pale: C.rosePale, light: C.roseLight, base: C.rose, deep: C.roseDeep },
  wood: { pale: C.honeyPale, light: C.woodLight, base: C.wood, deep: C.woodDeep },
};

const L = (w = 2.2) => line(w);
const LD = (w = 1.6) => line(w, C.ink, 0.7);

/** An n-toothed gear outline centred on (cx, cy). */
function gear(cx, cy, outer, inner, teeth) {
  const pts = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i += 1) {
    const a = i * step - Math.PI / 2;
    for (const [da, r] of [
      [-0.27, inner],
      [-0.14, outer],
      [0.14, outer],
      [0.27, inner],
    ])
      pts.push(
        `${(cx + r * Math.cos(a + da * step)).toFixed(2)} ${(cy + r * Math.sin(a + da * step)).toFixed(2)}`,
      );
  }
  return `M${pts.join(' L')} Z`;
}

const MOTIFS = {
  biologia: [
    'matcha',
    'Biologia',
    'Dupla hélice de DNA',
    (
      k,
    ) => `<path d="M25.5 17 H38.5 M23.8 29 H40.2 M23.8 35 H40.2 M25.5 47 H38.5" stroke="${k.base}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M40 13 C40 22 24 24 24 32 C24 40 40 42 40 51" ${line(2.6, k.deep)}/>
    <path d="M24 13 C24 22 40 24 40 32 C40 40 24 42 24 51" ${L(2.6)}/>`,
  ],
  quimica: [
    'lavender',
    'Química',
    'Frasco de laboratório com líquido e bolhas',
    (
      k,
    ) => `<path d="M22.4 38 Q27 35.6 32 38 Q37 40.4 41.6 38 L46 46.5 Q47.8 51 43 51 H21 Q16.2 51 18 46.5 Z" fill="${k.base}"/>
    <path d="M29 13 V26 L18 46.5 Q16.2 51 21 51 H43 Q47.8 51 46 46.5 L35 26 V13" ${L()}/>
    <path d="M26.5 12.5 H37.5" ${L()}/>
    <path d="M24.6 37 L27.8 31" ${line(1.8, C.white, 0.9)}/>
    <circle cx="28" cy="45" r="1.8" fill="${C.white}"/><circle cx="35" cy="42.4" r="1.3" fill="${C.white}"/>
    <circle cx="40.5" cy="8.5" r="2" ${LD()}/><circle cx="36.5" cy="4.8" r="1.2" ${LD(1.3)}/>`,
  ],
  fisica: [
    'mist',
    'Física',
    'Átomo com três órbitas',
    (k) => `<g ${L(2)}>
      <ellipse cx="32" cy="32" rx="18" ry="6.5"/>
      <ellipse cx="32" cy="32" rx="18" ry="6.5" transform="rotate(60 32 32)"/>
      <ellipse cx="32" cy="32" rx="18" ry="6.5" transform="rotate(-60 32 32)"/>
    </g>
    <circle cx="32" cy="32" r="4.6" fill="${C.honey}" ${L(1.8)}/>
    <circle cx="50" cy="32" r="2.4" fill="${k.deep}"/><circle cx="23" cy="16.4" r="2.4" fill="${k.deep}"/><circle cx="23" cy="47.6" r="2.4" fill="${k.deep}"/>`,
  ],
  matematica: [
    'honey',
    'Matemática',
    'Esquadro com régua e compasso',
    (
      k,
    ) => `<path d="M14 51 V15 L50 51 Z M20 45 V30.5 L34.5 45 Z" fill="${k.light}" fill-rule="evenodd" ${L()}/>
    <path d="M18 51 V48 M22 51 V47 M26 51 V48 M30 51 V47 M34 51 V48 M38 51 V47 M42 51 V48" ${LD(1.3)}/>
    <path d="M16.5 20 L16.5 46" ${line(1.4, C.white, 0.9)}/>
    <circle cx="44" cy="20" r="6.5" fill="${C.white}" ${L(1.8)}/>
    <path d="M44 16.5 V23.5 M40.5 20 H47.5" ${line(1.6, k.deep)}/>`,
  ],
  historia: [
    'wood',
    'História',
    'Coluna clássica',
    (k) => `<path d="M16 54 H48 V50 H16 Z" fill="${k.base}" ${L(1.8)}/>
    <path d="M19 50 H45 V46.5 H19 Z" fill="${C.white}" ${L(1.8)}/>
    <path d="M22.5 46.5 V21 H41.5 V46.5" fill="${C.white}" ${L(1.8)}/>
    <path d="M37 22 V46 H41.5 V22 Z" fill="${k.light}" opacity="0.8"/>
    <path d="M27.5 24 V44 M32 24 V44 M36.5 24 V44" ${LD(1.4)}/>
    <path d="M17 15 H47 V20 H17 Z" fill="${C.white}" ${L(1.8)}/>
    <circle cx="19.5" cy="21" r="3.2" fill="${k.light}" ${L(1.6)}/><circle cx="44.5" cy="21" r="3.2" fill="${k.light}" ${L(1.6)}/>
    <path d="M15 15 L32 9 L49 15 Z" fill="${k.base}" ${L(1.8)}/>`,
  ],
  geografia: [
    'matcha',
    'Geografia',
    'Globo terrestre no suporte',
    (k) => `<path d="M24 53 H40" ${L(2.6)}/><path d="M32 47 V53" ${L()}/>
    <circle cx="32" cy="28" r="14" fill="${C.mist}" ${L()}/>
    <path d="M23 21 Q27 17 31 19 Q33 23 30 25 Q31 30 26 31 Q21 27 23 21 Z M35 29 Q40 27 43 31 Q42 37 37 39 Q34 35 35 29 Z" fill="${k.light}" ${line(1.4)}/>
    <path d="M22.5 22 Q25 18.5 28.5 17.2" ${line(1.6, C.white, 0.85)}/>
    <path d="M18.5 40 A19 19 0 0 0 46 13.5" ${line(5.2, C.ink)}/>
    <path d="M18.5 40 A19 19 0 0 0 46 13.5" stroke="${C.honey}" stroke-width="2.6" stroke-linecap="round"/>`,
  ],
  literatura: [
    'rose',
    'Português e literatura',
    'Livro aberto com fita marcadora',
    (
      k,
    ) => `<path d="M10 20 V50 C19 47.5 26 48 32 52 C38 48 45 47.5 54 50 V20" fill="${k.base}" ${L()}/>
    <path d="M32 19 C26 15 18 15 13 17 V46 C19 44.5 26 45 32 48.5 Z" fill="${C.white}" ${L()}/>
    <path d="M32 19 C38 15 46 15 51 17 V46 C45 44.5 38 45 32 48.5 Z" fill="${C.white}" ${L()}/>
    <path d="M17 24 Q22 22.6 28 24 M17 29 Q22 27.6 28 29 M17 34 Q22 32.6 28 34 M36 24 Q42 22.6 47 24 M36 29 Q41 27.6 44 28.4" ${LD(1.3)}/>
    <path d="M40 46 V56 L43 53.6 L46 56 V45.2" fill="${C.honey}" ${line(1.6)}/>`,
  ],
  linguas: [
    'lavender',
    'Línguas',
    'Dois balões de conversa',
    (
      k,
    ) => `<path d="M17 13 H37 A6 6 0 0 1 43 19 V29 A6 6 0 0 1 37 35 H23 L16 40 L17.5 34.6 A6 6 0 0 1 11 29 V19 A6 6 0 0 1 17 13 Z" fill="${k.light}" ${L()}/>
    <path d="M30 29 H47 A6 6 0 0 1 53 35 V43 A6 6 0 0 1 47.6 49 L49 54 L42 49 H30 A6 6 0 0 1 24 43 V35 A6 6 0 0 1 30 29 Z" fill="${C.white}" ${L()}/>
    <path d="M17 21 H35 M17 26.5 H29" ${line(1.8, k.deep)}/>
    <circle cx="32" cy="39" r="1.8" fill="${C.ink}"/><circle cx="38.5" cy="39" r="1.8" fill="${C.ink}"/><circle cx="45" cy="39" r="1.8" fill="${C.ink}"/>`,
  ],
  artes: [
    'rose',
    'Artes',
    'Paleta de pintura com pincel',
    (
      k,
    ) => `<path d="M32 12 C45 12 54 20 53 30 C52 36 46 36 42 35 C38 34.6 36 37 37.5 40.5 C39.5 45 36 51 28 51 C17 51 10 42 11 32 C12 20 21 12 32 12 Z" fill="${C.woodLight}" ${L()}/>
    <circle cx="26" cy="42" r="3.6" fill="${k.pale}" ${line(1.6)}/>
    <circle cx="22" cy="28" r="3.6" fill="${k.base}"/><circle cx="31" cy="20.5" r="3.6" fill="${C.honey}"/><circle cx="42" cy="22" r="3.6" fill="${C.matcha}"/><circle cx="45" cy="30" r="2.8" fill="${C.lavender}"/>
    <path d="M58 6 L36 33" ${L(4.6)}/><path d="M58 6 L36 33" stroke="${C.wood}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M37.5 31 L33 36.5 Q30 39 31 35 L35 30 Z" fill="${C.lavenderDeep}" ${line(1.4)}/>`,
  ],
  musica: [
    'lavender',
    'Música',
    'Duas colcheias unidas',
    (k) => `<path d="M8 22 H56 M8 30 H56 M8 38 H56 M8 46 H56" ${line(1, k.deep, 0.35)}/>
    <path d="M26 44 V17 L46 12 V39" ${L(2.4)}/>
    <path d="M26 17 L46 12 V18 L26 23 Z" fill="${C.ink}" fill-opacity="0.88"/>
    <ellipse cx="21.5" cy="45" rx="5.6" ry="4.2" transform="rotate(-20 21.5 45)" fill="${k.base}" ${L(2)}/>
    <ellipse cx="41.5" cy="40" rx="5.6" ry="4.2" transform="rotate(-20 41.5 40)" fill="${k.base}" ${L(2)}/>`,
  ],
  filosofia: [
    'mist',
    'Filosofia',
    'Coruja de olhos atentos',
    (
      k,
    ) => `<path d="M32 55 C19 55 15 45 16 33 C16.6 24 18 17 18 11 L24.5 17 Q32 14.4 39.5 17 L46 11 C46 17 47.4 24 48 33 C49 45 45 55 32 55 Z" fill="${k.base}" ${L()}/>
    <path d="M24 41 Q32 37 40 41 Q40 51 32 52 Q24 51 24 41 Z" fill="${k.pale}"/>
    <path d="M27 45 l2 1.6 l2 -1.6 M33 45 l2 1.6 l2 -1.6 M30 49 l2 1.4 l2 -1.4" ${line(1.2, k.deep)}/>
    <circle cx="25" cy="28" r="6.4" fill="${C.white}" ${L(1.8)}/><circle cx="39" cy="28" r="6.4" fill="${C.white}" ${L(1.8)}/>
    <circle cx="25.6" cy="28.4" r="2.6" fill="${C.ink}"/><circle cx="38.4" cy="28.4" r="2.6" fill="${C.ink}"/>
    <circle cx="26.4" cy="27.4" r="0.9" fill="${C.white}"/><circle cx="39.2" cy="27.4" r="0.9" fill="${C.white}"/>
    <path d="M30 34 L32 38 L34 34 Z" fill="${C.honey}" ${line(1.2)}/>`,
  ],
  sociologia: [
    'honey',
    'Sociologia',
    'Três pessoas lado a lado',
    (
      k,
    ) => `<path d="M8 50 C8 41 12.5 37 18 37 C23.5 37 28 41 28 50 M36 50 C36 41 40.5 37 46 37 C51.5 37 56 41 56 50" fill="${k.light}" ${L()}/>
    <circle cx="18" cy="29" r="5.4" fill="${k.light}" ${L()}/><circle cx="46" cy="29" r="5.4" fill="${k.light}" ${L()}/>
    <path d="M20 52 C20 40 25.4 34.6 32 34.6 C38.6 34.6 44 40 44 52 Z" fill="${C.rose}" ${L()}/>
    <circle cx="32" cy="24" r="6.6" fill="${C.white}" ${L()}/>`,
  ],
  direito: [
    'wood',
    'Direito',
    'Balança da justiça',
    (k) => `<path d="M32 13 V49 M23 52 H41" ${L(2.4)}/>
    <path d="M15 20 Q32 16 49 20" ${L(2.4)}/>
    <circle cx="32" cy="12" r="2.6" fill="${C.honey}" ${line(1.6)}/>
    <path d="M15 20 L9.5 36 M15 20 L20.5 36 M49 20 L43.5 36 M49 20 L54.5 36" ${LD(1.4)}/>
    <path d="M8 36 H22 Q20.6 42.6 15 42.6 Q9.4 42.6 8 36 Z M42 36 H56 Q54.6 42.6 49 42.6 Q43.4 42.6 42 36 Z" fill="${C.honey}" ${L(1.8)}/>
    <path d="M26 49 H38 L36 45 H28 Z" fill="${k.base}" ${line(1.6)}/>`,
  ],
  saude: [
    'rose',
    'Medicina e saúde',
    'Coração com linha de pulso',
    (
      k,
    ) => `<path d="M32 51 C18 41.5 11 34 11 25.5 C11 18.6 15.8 14 22 14 C26.6 14 30 16.6 32 20.4 C34 16.6 37.4 14 42 14 C48.2 14 53 18.6 53 25.5 C53 34 46 41.5 32 51 Z" fill="${k.base}" ${L()}/>
    <path d="M44 41 Q48 37 49.6 32.6" stroke="${k.deep}" stroke-width="3" stroke-linecap="round" opacity="0.5"/>
    <path d="M14.5 31 H23 L26.4 24 L31 38 L35 27 L37.4 31 H49.5" ${line(2.4, C.white, 0.95)}/>
    <path d="M17 21 Q19 17.6 22.6 17.2" ${line(1.6, C.white, 0.8)}/>`,
  ],
  economia: [
    'honey',
    'Economia',
    'Gráfico de barras e moeda',
    (k) => `<path d="M10 51 H54" ${L(2.2)}/>
    <rect x="13" y="38" width="8" height="13" rx="1.5" fill="${C.matchaLight}" ${L(1.8)}/>
    <rect x="24" y="30" width="8" height="21" rx="1.5" fill="${C.matcha}" ${L(1.8)}/>
    <rect x="35" y="22" width="8" height="29" rx="1.5" fill="${C.matchaDeep}" ${L(1.8)}/>
    <circle cx="46" cy="17" r="8" fill="${k.base}" ${L(2)}/>
    <circle cx="46" cy="17" r="4.6" ${line(1.4, k.deep)}/>
    <path d="M42.4 13.6 Q43.6 11.8 45.6 11.4" ${line(1.4, C.white, 0.85)}/>`,
  ],
  computacao: [
    'mist',
    'Computação',
    'Computador clássico com tela acesa',
    (k) => `<path d="M19 50 L17.5 55 H46.5 L45 50" fill="${k.light}" ${L(1.8)}/>
    <rect x="15" y="9" width="34" height="42" rx="4" fill="${C.paper}" ${L()}/>
    <path d="M45 13 V47" ${line(2.6, k.light, 1)}/>
    <rect x="19.5" y="13.5" width="25" height="20" rx="2.4" fill="${C.night}" ${L(1.8)}/>
    <path d="M23.5 19.5 L27 22.5 L23.5 25.5" ${line(1.8, C.honeyLight, 1)}/>
    <path d="M29.5 26.5 H36" ${line(1.8, C.matchaLight, 1)}/>
    <path d="M31 43.5 H42" ${L(1.8)}/>
    <circle cx="22" cy="43.5" r="1.4" fill="${C.matcha}"/>`,
  ],
  engenharia: [
    'wood',
    'Engenharia',
    'Duas engrenagens encaixadas',
    (k) => `<path d="${gear(27, 37, 15, 11.4, 9)}" fill="${k.light}" ${L(1.8)}/>
    <circle cx="27" cy="37" r="4.4" fill="${C.white}" ${L(1.8)}/>
    <path d="${gear(46, 18.5, 9.4, 7, 7)}" fill="${C.honey}" ${L(1.8)}/>
    <circle cx="46" cy="18.5" r="2.8" fill="${C.white}" ${L(1.6)}/>
    <path d="M18 29 Q21 25.4 25 24.8" ${line(1.6, C.white, 0.85)}/>`,
  ],
  psicologia: [
    'lavender',
    'Psicologia',
    'Perfil de cabeça com uma flor dentro',
    (
      k,
    ) => `<path d="M22 55 V46 C14 41.5 11.5 32 14.5 24 C18 14.5 27.5 10 37 12 C46 14 51 21.5 50.5 29.5 L54.5 36.4 L50.5 38 V43 C50.5 46.4 48 47.6 44.6 47.4 L40 47 V55" fill="${k.light}" ${L()}/>
    <g transform="translate(31 28)">
      <circle cx="0" cy="-5.2" r="3.8" fill="${C.rose}"/><circle cx="5" cy="-1.6" r="3.8" fill="${C.rose}"/><circle cx="3" cy="4.2" r="3.8" fill="${C.rose}"/><circle cx="-3" cy="4.2" r="3.8" fill="${C.rose}"/><circle cx="-5" cy="-1.6" r="3.8" fill="${C.rose}"/>
      <circle cx="0" cy="0" r="2.8" fill="${C.honey}" ${line(1.2)}/>
    </g>`,
  ],
  'educacao-fisica': [
    'matcha',
    'Educação física',
    'Bola com costuras e linhas de movimento',
    (k) => `<path d="M10 27 H16 M9 33 H15 M10.5 39 H16.5" ${line(2, k.deep, 0.7)}/>
    <circle cx="36" cy="33" r="16" fill="${C.honeyLight}" ${L()}/>
    <path d="M24.6 22 C31 27.4 31 38.6 24.6 44 M47.4 22 C41 27.4 41 38.6 47.4 44" ${line(2.2, C.white, 1)}/>
    <path d="M24.6 22 C31 27.4 31 38.6 24.6 44 M47.4 22 C41 27.4 41 38.6 47.4 44" ${line(1, k.deep, 0.6)} stroke-dasharray="1.6 2.4"/>
    <path d="M27 20.5 Q30.5 18 34.5 17.6" ${line(1.6, C.white, 0.9)}/>`,
  ],
  astronomia: [
    'lavender',
    'Astronomia',
    'Planeta com anéis e estrelas',
    (
      k,
    ) => `<path d="M12.03 42.87 A21 6.5 -22 0 1 50.97 27.13" ${L(5.4)}/><path d="M12.03 42.87 A21 6.5 -22 0 1 50.97 27.13" ${line(2.8, C.honey, 1)}/>
    <circle cx="31.5" cy="35" r="12.5" fill="${k.base}" ${L()}/>
    <path d="M22 30 Q24 25.4 29 24" ${line(1.6, C.white, 0.85)}/>
    <path d="M12.03 42.87 A21 6.5 -22 0 0 50.97 27.13" ${L(5.4)}/><path d="M12.03 42.87 A21 6.5 -22 0 0 50.97 27.13" ${line(2.8, C.honey, 1)}/>
    <path d="M16 11 Q16.6 15.4 21 16 Q16.6 16.6 16 21 Q15.4 16.6 11 16 Q15.4 15.4 16 11 Z M47 9 Q47.4 12 50.4 12.4 Q47.4 12.8 47 15.8 Q46.6 12.8 43.6 12.4 Q46.6 12 47 9 Z" fill="${C.honey}" ${line(1)}/>`,
  ],
  botanica: [
    'matcha',
    'Botânica',
    'Broto num vaso de barro',
    (k) => `<path d="M32 38 V25" ${line(2.2, k.deep)}/>
    <path d="M32 30 C24 30 19.5 25 19.5 17 C27 17 32 21.4 32 30 Z" fill="${k.base}" ${L(1.8)}/>
    <path d="M32 26 C38.6 26 45.5 22 45.5 12.5 C38 12.5 32 17 32 26 Z" fill="${k.light}" ${L(1.8)}/>
    <path d="M23 28 L29 26 M41 16 L35.4 21" ${line(1.2, k.deep)}/>
    <path d="M22.5 42 H41.5 L39 54 H25 Z" fill="${C.rose}" ${L(1.8)}/>
    <path d="M36 43 L34.6 53" stroke="${C.roseDeep}" stroke-width="3" opacity="0.4"/>
    <rect x="19.5" y="37" width="25" height="6" rx="1.6" fill="${C.roseLight}" ${L(1.8)}/>`,
  ],
  idiomas: [
    'mist',
    'Idiomas',
    'Envelope de correio aéreo com selo',
    (k) => `<rect x="9" y="17" width="46" height="31" rx="3" fill="${C.white}"/>
    <rect x="11.2" y="19.2" width="41.6" height="26.6" rx="1.6" stroke="${C.rose}" stroke-width="3" stroke-dasharray="5 5"/>
    <rect x="11.2" y="19.2" width="41.6" height="26.6" rx="1.6" stroke="${k.deep}" stroke-width="3" stroke-dasharray="5 5" stroke-dashoffset="5"/>
    <rect x="9" y="17" width="46" height="31" rx="3" ${L()}/>
    <path d="M14.5 22.5 L32 35 L49.5 22.5" ${L(1.8)}/>
    <rect x="40" y="10" width="13" height="15" rx="1" fill="${C.honey}" ${L(1.6)} stroke-dasharray="2 1.4"/>
    <circle cx="46.5" cy="17.5" r="3" fill="${C.honeyPale}"/>`,
  ],
  geral: [
    'lavender',
    'Geral',
    'Caderno espiral com etiqueta',
    (k) => `<rect x="17" y="10" width="33" height="45" rx="3.4" fill="${k.base}" ${L()}/>
    <path d="M45 10.5 V54.5" ${line(3, k.deep, 0.5)}/>
    <rect x="24.5" y="18" width="19" height="10" rx="1.8" fill="${C.white}" ${L(1.6)}/>
    <path d="M28 23 H40" ${line(1.4, k.deep)}/>
    <g ${L(1.8)}>${[15, 22, 29, 36, 43, 50].map((y) => `<path d="M20.5 ${y} H14.5 A2.4 2.4 0 0 1 14.5 ${y - 4.4} H20.5"/>`).join('')}</g>`,
  ],
  pesquisa: [
    'honey',
    'Pesquisa',
    'Lupa sobre uma folha de anotações',
    (k) => `<path d="M12 10 H32 L39 17 V50 H12 Z" fill="${C.white}" ${L()}/>
    <path d="M32 10 V17 H39" fill="${k.pale}" ${L(1.8)}/>
    <path d="M16.5 22 H31 M16.5 27.5 H34 M16.5 33 H25" ${LD(1.4)}/>
    <path d="M45.4 45.4 L54 54" ${L(6.2)}/><path d="M45.4 45.4 L54 54" stroke="${C.wood}" stroke-width="3.4" stroke-linecap="round"/>
    <circle cx="38" cy="38" r="10.4" fill="${C.mistPale}" fill-opacity="0.85" ${L(2.4)}/>
    <path d="M32 35 Q33.4 31.6 37 30.6" ${line(1.8, C.white, 1)}/>
    <path d="M33.5 40 H42.5" ${line(1.6, k.deep)}/>`,
  ],
};

export const EMBLEMS = Object.entries(MOTIFS).map(([name, [family, title, alt]]) => ({
  name,
  family,
  title,
  alt,
}));

function plate(k) {
  // A label plate: lifted by a soft shadow, with a highlight along the top edge and a thin
  // inner rule (the deboss of a pressed label). The motif sits over it.
  return `<rect x="5" y="6.5" width="54" height="54" rx="13" fill="${C.ink}" opacity="0.1"/>
  <rect x="4" y="4" width="56" height="55" rx="13" fill="${k.pale}" ${line(1.4, k.deep, 0.55)}/>
  <rect x="7.5" y="7.5" width="49" height="48" rx="10" ${line(1, k.deep, 0.22)}/>
  <path d="M10 7.2 Q32 5.4 54 7.2" ${line(1.2, C.white, 0.9)}/>`;
}

export function emblemFiles() {
  const files = {};
  for (const [name, [family, , , draw]] of Object.entries(MOTIFS)) {
    const k = FAMILY[family];
    files[`emblems/${name}.svg`] = svg({
      id: `emblem.${name}`,
      width: S,
      height: S,
      body: `${plate(k)}\n  ${draw(k)}`,
    });
  }
  return files;
}
