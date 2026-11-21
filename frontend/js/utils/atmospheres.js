// Atmospheres (3.5, Milestone 5): the single source of truth for the eight study atmospheres of
// docs/EXPERIENCE_VISION_3_5.md (section 7). Aparência (the Creative Studio), the desk on Início
// and the soundscape all read from here.
//
// An atmosphere is a bundle the student can take apart afterwards:
//   palette    token values for the app (the theme's variable names; never new names), applied
//              only while the theme is the atmosphere's base theme ('paper' or 'night'), so the
//              classic themes, the high-contrast themes and "Contraste reforçado" always win;
//   accents    curated accent variants with text-safe companions (AA on paper and surfaces);
//   desk       the colours of the desk scene (wall, desk top and front edge);
//   wallpaper  the art id shown in the desk window (never behind reading text);
//   outfit     Lume's outfit (or null);
//   soundscape the mixer preset offered with it (never played without a click);
//   motion     the quiet ambient motion inside the desk window (or null).
//
// The CSS for the palettes is generated from this file into system.css by
// scripts/build-atmospheres-css.mjs, so the colours apply before first paint (no flash). A test
// fails when the generated block is out of date.

export const DEFAULT_ATMOSPHERE = 'lavender-desk';

/** @typedef {{ id: string, name: string, accent: string, strong: string, soft: string, contrast?: string }} Accent */

export const ATMOSPHERES = Object.freeze([
  {
    id: 'rainy-library',
    name: 'Biblioteca chuvosa',
    description: 'Estantes, janela molhada e azul de chuva.',
    base: 'paper',
    palette: {
      background: '#f1f4f7',
      surface: '#ffffff',
      surfaceAlt: '#e5ebf1',
      text: '#24303c',
      muted: '#55616e',
      border: '#c3ceda',
      borderLight: '#dde4ec',
    },
    accents: [
      { id: 'mist', name: 'Azul de chuva', accent: '#4f7394', strong: '#3d5f78', soft: '#e1eaf2' },
      { id: 'lavender', name: 'Lavanda', accent: '#6e5bae', strong: '#5a4896', soft: '#ebe7f6' },
      { id: 'moss', name: 'Musgo', accent: '#557a5c', strong: '#3f634a', soft: '#e3ede4' },
    ],
    desk: { wall: '#e3e9ef', top: '#b9a58d', edge: '#9c876f' },
    wallpaper: 'wallpaper.rainy-library',
    outfit: 'raincoat',
    soundscape: 'rainy-library',
    motion: 'rain',
  },
  {
    id: 'lavender-desk',
    name: 'Escrivaninha lavanda',
    description: 'Papel lavanda, tinta berinjela e luz da tarde.',
    base: 'paper',
    palette: {
      background: '#f7f5fb',
      surface: '#ffffff',
      surfaceAlt: '#efebf6',
      text: '#2e2a3b',
      muted: '#625c72',
      border: '#cdc6dc',
      borderLight: '#e5e0ee',
    },
    accents: [
      { id: 'lavender', name: 'Lavanda', accent: '#6e5bae', strong: '#5a4896', soft: '#ece7f7' },
      { id: 'rose', name: 'Rosa antigo', accent: '#b05d70', strong: '#9a4357', soft: '#f7e6ea' },
      { id: 'mist', name: 'Névoa', accent: '#4f7394', strong: '#3d5f78', soft: '#e3ecf4' },
    ],
    desk: { wall: '#ece7f5', top: '#cdb9a3', edge: '#ad977f' },
    wallpaper: 'wallpaper.lavender-desk',
    outfit: null,
    soundscape: 'lavender-desk',
    motion: 'dust',
  },
  {
    id: 'matcha-afternoon',
    name: 'Tarde de matcha',
    description: 'Verde chá, luz de mel e folhas na janela.',
    base: 'paper',
    palette: {
      background: '#f3f6ee',
      surface: '#ffffff',
      surfaceAlt: '#e6ecdb',
      text: '#25301f',
      muted: '#53604b',
      border: '#c6d1b6',
      borderLight: '#dde5d1',
    },
    accents: [
      { id: 'matcha', name: 'Matcha', accent: '#5e7f4e', strong: '#48683a', soft: '#e4eddb' },
      { id: 'honey', name: 'Mel', accent: '#a5781f', strong: '#7c5a12', soft: '#f6ecd4' },
      { id: 'rose', name: 'Morango', accent: '#b05d70', strong: '#9a4357', soft: '#f7e6ea' },
    ],
    desk: { wall: '#e5ecd9', top: '#c9b08f', edge: '#a88f6f' },
    wallpaper: 'wallpaper.matcha-afternoon',
    outfit: null,
    soundscape: 'matcha-afternoon',
    motion: 'leaves',
  },
  {
    id: 'cozy-winter',
    name: 'Inverno aconchegante',
    description: 'Neve lá fora, lã vermelha e lareira.',
    base: 'paper',
    palette: {
      background: '#f3f4f8',
      surface: '#ffffff',
      surfaceAlt: '#e6e8f0',
      text: '#2a2c3d',
      muted: '#5a5d71',
      border: '#c9ccda',
      borderLight: '#e0e2ea',
    },
    accents: [
      { id: 'berry', name: 'Lã vermelha', accent: '#a3485c', strong: '#8c3a4d', soft: '#f5e4e8' },
      { id: 'pine', name: 'Pinheiro', accent: '#3e6655', strong: '#335647', soft: '#e1ece6' },
      { id: 'frost', name: 'Geada', accent: '#4f7394', strong: '#3d5f78', soft: '#e1eaf2' },
    ],
    desk: { wall: '#e4e6ef', top: '#b69a84', edge: '#977c67' },
    wallpaper: 'wallpaper.cozy-winter',
    outfit: 'winter-scarf',
    soundscape: 'cozy-winter',
    motion: 'snow',
  },
  {
    id: 'seaside',
    name: 'Estudo à beira-mar',
    description: 'Maresia, farol ao longe e azul-turquesa.',
    base: 'paper',
    palette: {
      background: '#eff6f7',
      surface: '#ffffff',
      surfaceAlt: '#dfecef',
      text: '#1f3237',
      muted: '#4b636a',
      border: '#bfd4d9',
      borderLight: '#d9e7ea',
    },
    accents: [
      { id: 'teal', name: 'Turquesa', accent: '#2c7a84', strong: '#1f626b', soft: '#dcedf0' },
      { id: 'coral', name: 'Coral', accent: '#b3584a', strong: '#963f33', soft: '#f6e3df' },
      { id: 'sand', name: 'Areia', accent: '#9b7426', strong: '#7c5a12', soft: '#f5ecd6' },
    ],
    desk: { wall: '#dfecee', top: '#cdb595', edge: '#ad9577' },
    wallpaper: 'wallpaper.ocean-study',
    outfit: 'explorer-hat',
    soundscape: 'seaside',
    motion: 'waves',
  },
  {
    id: 'night-garden',
    name: 'Jardim noturno',
    description: 'Berinjela escura, lua e vaga-lumes.',
    base: 'night',
    palette: {
      background: '#1b1924',
      surface: '#24212f',
      surfaceAlt: '#2d2939',
      text: '#efebf7',
      muted: '#bdb5cf',
      border: '#575070',
      borderLight: '#3a3549',
    },
    accents: [
      { id: 'lavender', name: 'Luz de lavanda', accent: '#b7a7ea', strong: '#cbbff3', soft: '#352f4a', contrast: '#1b1924' },
      { id: 'firefly', name: 'Vaga-lume', accent: '#e2b14a', strong: '#f0c975', soft: '#3a3222', contrast: '#1b1924' },
      { id: 'moonflower', name: 'Flor da lua', accent: '#e39aac', strong: '#f0aebc', soft: '#3d2a33', contrast: '#1b1924' },
    ],
    desk: { wall: '#211e2c', top: '#4a3f52', edge: '#3a3142' },
    wallpaper: 'wallpaper.night-garden',
    outfit: null,
    soundscape: 'night-garden',
    motion: 'fireflies',
  },
  {
    id: 'old-notebook',
    name: 'Caderno acadêmico antigo',
    description: 'Papel pautado, tinta ferrogálica e folhas prensadas.',
    base: 'paper',
    palette: {
      background: '#eff0ea',
      surface: '#fbfbf7',
      surfaceAlt: '#e3e4da',
      text: '#22283a',
      muted: '#535a69',
      border: '#c5c8ba',
      borderLight: '#dcded2',
    },
    accents: [
      { id: 'ink', name: 'Tinta azul', accent: '#3a5689', strong: '#2a4372', soft: '#e1e6f0' },
      { id: 'oxblood', name: 'Lacre', accent: '#8f3a46', strong: '#7a2e3a', soft: '#f2e2e4' },
      { id: 'bottle', name: 'Verde garrafa', accent: '#3f6b54', strong: '#345a46', soft: '#e0ebe4' },
    ],
    desk: { wall: '#e2e3d8', top: '#a98d70', edge: '#8a7058' },
    wallpaper: 'wallpaper.old-notebook',
    outfit: 'reading-glasses',
    soundscape: 'old-notebook',
    motion: 'dust',
  },
  {
    id: 'dreamy-pastel',
    name: 'Pastel sonhador',
    description: 'Nuvens de algodão, lilás e menta.',
    base: 'paper',
    palette: {
      background: '#f8f4fa',
      surface: '#ffffff',
      surfaceAlt: '#f0e8f4',
      text: '#3a2e45',
      muted: '#685a75',
      border: '#d8cbe0',
      borderLight: '#ebe2f0',
    },
    accents: [
      { id: 'lilac', name: 'Lilás', accent: '#a0629a', strong: '#874b81', soft: '#f5e5f3' },
      { id: 'mint', name: 'Menta', accent: '#3f7a66', strong: '#346652', soft: '#e0f0ea' },
      { id: 'periwinkle', name: 'Pervinca', accent: '#5f68b0', strong: '#4c5499', soft: '#e7e8f6' },
    ],
    desk: { wall: '#f1e8f4', top: '#d9c3c6', edge: '#bca3a8' },
    wallpaper: 'wallpaper.dreamy-pastel',
    outfit: null,
    soundscape: 'dreamy-pastel',
    motion: 'clouds',
  },
]);

export const ATMOSPHERE_IDS = Object.freeze(ATMOSPHERES.map((atmosphere) => atmosphere.id));

/** The Lume outfits of the art manifest (kept here so this module stays import-light). */
export const LUME_OUTFIT_CHOICES = Object.freeze([
  ['winter-scarf', 'Cachecol de inverno'],
  ['raincoat', 'Capa de chuva'],
  ['reading-glasses', 'Óculos de leitura'],
  ['explorer-hat', 'Chapéu de explorador'],
]);

/** Notebook covers for the Arquivo de Descobertas (art ids). */
export const NOTEBOOK_COVERS = Object.freeze([
  ['cover.lavender-dots', 'Bolinhas lavanda'],
  ['cover.honey-gingham', 'Xadrez mel'],
  ['cover.mist-marbled', 'Marmorizado'],
  ['cover.rose-botanical', 'Botânico rosa'],
  ['cover.night-stars', 'Noite estrelada'],
  ['cover.matcha-linen', 'Linho matcha'],
]);

/** Covers and outfits that are collectibles (server-owned unlocks, see RPG_GAMIFICATION_3_5.md). */
export const COLLECTIBLE_COVERS = Object.freeze(['cover.matcha-linen']);
export const COLLECTIBLE_OUTFITS = Object.freeze([]);

/** Covers the student may choose: every default cover plus collectible ones already unlocked. */
export function availableCovers(unlocks = []) {
  const found = new Set(unlocks.map((u) => u?.id));
  return NOTEBOOK_COVERS.map(([id]) => id).filter((id) => !COLLECTIBLE_COVERS.includes(id) || found.has(id));
}
/** Lume outfits the student may choose (all four are defaults today; future ones may be found). */
export function availableOutfits(unlocks = []) {
  const found = new Set(unlocks.map((u) => u?.id));
  return LUME_OUTFIT_CHOICES.map(([id]) => id).filter(
    (id) => !COLLECTIBLE_OUTFITS.includes(`character.lume.outfit.${id}`) || found.has(`character.lume.outfit.${id}`),
  );
}

/** Each atmosphere suggests a cover; the student can choose another. */
const ATMOSPHERE_COVER = {
  'rainy-library': 'cover.mist-marbled',
  'lavender-desk': 'cover.lavender-dots',
  'matcha-afternoon': 'cover.honey-gingham',
  'cozy-winter': 'cover.rose-botanical',
  seaside: 'cover.mist-marbled',
  'night-garden': 'cover.night-stars',
  'old-notebook': 'cover.honey-gingham',
  'dreamy-pastel': 'cover.lavender-dots',
};

/** Choices kept in the account's appearance preferences (theme-init.js validates the same). */
export const ATMOSPHERE_PREFERENCES = Object.freeze({
  atmosphere: ATMOSPHERE_IDS,
  atmosphereAccent: null, // an accent id of the chosen atmosphere (validated per atmosphere)
  atmospherePalette: ['on', 'off'],
  atmosphereWallpaper: ['on', 'off'],
  atmosphereMotion: ['on', 'off'],
  lumeOutfit: ['auto', 'none', ...LUME_OUTFIT_CHOICES.map(([id]) => id)],
  notebookCover: ['auto', ...NOTEBOOK_COVERS.map(([id]) => id)],
  decoration: ['minimal', 'balanced', 'abundant'],
});

export function getAtmosphere(id) {
  return ATMOSPHERES.find((atmosphere) => atmosphere.id === id) || getAtmosphere(DEFAULT_ATMOSPHERE);
}

/** The accent variant in use: the saved one when it belongs to the atmosphere, else the first. */
export function resolveAccent(atmosphere, accentId) {
  return atmosphere.accents.find((accent) => accent.id === accentId) || atmosphere.accents[0];
}

/**
 * What the student sees, resolved from the saved preferences and the page's accessibility state.
 * `available` (optional) lists outfits/covers the account may use (unlocked + defaults); a saved
 * choice outside it falls back to the atmosphere's own suggestion.
 */
export function resolveAtmosphere(prefs = {}, { theme = 'paper', available } = {}) {
  const atmosphere = getAtmosphere(prefs.atmosphere);
  const accent = resolveAccent(atmosphere, prefs.atmosphereAccent);
  const minimal = prefs.highContrast === true || prefs.screenReaderMode === true;
  const calm = minimal || prefs.reducedMotion === true || prefs.lowStimulation === true;
  const allowed = (kind, id) => !available?.[kind] || available[kind].includes(id);
  let outfit = atmosphere.outfit;
  if (prefs.lumeOutfit === 'none') outfit = null;
  else if (prefs.lumeOutfit && prefs.lumeOutfit !== 'auto') outfit = prefs.lumeOutfit;
  if (outfit && !allowed('outfits', outfit)) outfit = atmosphere.outfit;
  let cover = ATMOSPHERE_COVER[atmosphere.id];
  if (prefs.notebookCover && prefs.notebookCover !== 'auto' && allowed('covers', prefs.notebookCover))
    cover = prefs.notebookCover;
  if (!allowed('covers', cover)) cover = 'cover.lavender-dots';
  return {
    atmosphere,
    accent,
    // The palette yields to every theme other than the atmosphere's base, and to high contrast.
    paletteActive: prefs.atmospherePalette !== 'off' && theme === atmosphere.base && !prefs.highContrast,
    wallpaper: !minimal && prefs.atmosphereWallpaper !== 'off' ? atmosphere.wallpaper : null,
    motion: !calm && prefs.atmosphereMotion !== 'off' ? atmosphere.motion : null,
    outfit,
    cover,
    soundscape: atmosphere.soundscape,
    decoration: minimal ? 'minimal' : prefs.decoration || 'balanced',
  };
}

/** Preferences to save when the student picks an atmosphere (its suggestions, fresh). */
export function choosePreferences(id) {
  const atmosphere = getAtmosphere(id);
  return {
    atmosphere: atmosphere.id,
    atmosphereAccent: atmosphere.accents[0].id,
    atmospherePalette: 'on',
    lumeOutfit: 'auto',
    notebookCover: 'auto',
  };
}

// ---- Tokens and contrast (used by the CSS generator and the tests) --------------------------

function channel(hex, index) {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
}
export function luminance(hex) {
  const [r, g, b] = [0, 1, 2]
    .map((i) => channel(hex, i))
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The theme variables an atmosphere sets (names from system.css / style.css). */
export function paletteTokens(atmosphere) {
  const p = atmosphere.palette;
  return {
    '--background': p.background,
    '--surface': p.surface,
    '--surface-alt': p.surfaceAlt,
    '--text': p.text,
    '--muted': p.muted,
    '--border': p.border,
    '--border-light': p.borderLight,
  };
}
export function accentTokens(accent, dark = false) {
  const onAccent = accent.contrast || '#ffffff';
  return {
    '--accent': accent.accent,
    '--accent-strong': accent.strong,
    '--accent-soft': accent.soft,
    '--accent-contrast': onAccent,
    '--button-background': dark ? accent.accent : accent.strong,
    '--button-text': onAccent,
    '--link': accent.strong,
  };
}
export function deskTokens(atmosphere) {
  return {
    '--desk-wall': atmosphere.desk.wall,
    '--desk-top': atmosphere.desk.top,
    '--desk-edge': atmosphere.desk.edge,
  };
}

/** Every text/background pair the palette must keep at AA (4.5:1), for tests and the Studio. */
export function contrastPairs(atmosphere) {
  const p = atmosphere.palette;
  const dark = atmosphere.base === 'night';
  const pairs = [
    ['text on background', p.text, p.background],
    ['text on surface', p.text, p.surface],
    ['text on surface-alt', p.text, p.surfaceAlt],
    ['muted on background', p.muted, p.background],
    ['muted on surface', p.muted, p.surface],
    ['muted on surface-alt', p.muted, p.surfaceAlt],
  ];
  for (const accent of atmosphere.accents) {
    const onAccent = accent.contrast || '#ffffff';
    pairs.push(
      [`${accent.id}: link on surface`, accent.strong, p.surface],
      [`${accent.id}: link on background`, accent.strong, p.background],
      [`${accent.id}: link on soft`, accent.strong, accent.soft],
      [`${accent.id}: button`, onAccent, dark ? accent.accent : accent.strong],
    );
  }
  return pairs;
}

export const CSS_START =
  '  /* ==== Atmospheres (generated by scripts/atmospheres/build-css.mjs; do not edit) ==== */';
export const CSS_END = '  /* ==== End of atmospheres ==== */';

/** The CSS block written into system.css (see scripts/atmospheres/build-css.mjs). */
export function atmosphereCss() {
  const block = (selector, tokens, indent = '  ') =>
    `${indent}${selector} {\n${Object.entries(tokens)
      .map(([name, value]) => `${indent}  ${name}: ${value};`)
      .join('\n')}\n${indent}}`;
  const out = [];
  for (const atmosphere of ATMOSPHERES) {
    const dark = atmosphere.base === 'night';
    const on = `:root[data-atmosphere='${atmosphere.id}'][data-theme='${atmosphere.base}']:not([data-atmosphere-palette='off'], [data-high-contrast='true'])`;
    out.push(`  /* ${atmosphere.name} */`);
    out.push(
      block(on, {
        ...paletteTokens(atmosphere),
        ...accentTokens(atmosphere.accents[0], dark),
        ...deskTokens(atmosphere),
      }),
    );
    for (const accent of atmosphere.accents.slice(1))
      out.push(block(`${on}[data-atmosphere-accent='${accent.id}']`, accentTokens(accent, dark)));
  }
  return out.join('\n');
}
