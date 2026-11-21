// 3.5 M5: atmospheres (single source of truth), experience-mode resolution and desk rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  ATMOSPHERES,
  ATMOSPHERE_IDS,
  ATMOSPHERE_PREFERENCES,
  CSS_END,
  CSS_START,
  DEFAULT_ATMOSPHERE,
  atmosphereCss,
  availableCovers,
  availableOutfits,
  choosePreferences,
  contrastPairs,
  contrastRatio,
  getAtmosphere,
  resolveAtmosphere,
} from '../js/utils/atmospheres.js';
import { PRESETS } from '../js/utils/soundscape-mix.js';
import { ART } from '../js/art/manifest.js';
import {
  STARTER_OBJECTS,
  availableObjects,
  companionState,
  describeDesk,
  isToday,
  mergeDesk,
  placeObject,
  removeObject,
  splitDesk,
} from '../js/utils/desk.js';
import { DESK_SLOTS } from '../js/utils/collectibles.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

test('eight atmospheres, each complete and pointing at real art and a real sound preset', () => {
  assert.equal(ATMOSPHERES.length, 8);
  assert.deepEqual(
    ATMOSPHERES.map((a) => a.name),
    [
      'Biblioteca chuvosa',
      'Escrivaninha lavanda',
      'Tarde de matcha',
      'Inverno aconchegante',
      'Estudo à beira-mar',
      'Jardim noturno',
      'Caderno acadêmico antigo',
      'Pastel sonhador',
    ],
  );
  for (const a of ATMOSPHERES) {
    assert(ART[a.wallpaper], `${a.id}: wallpaper ${a.wallpaper} in the art manifest`);
    assert(PRESETS.some((p) => p.id === a.soundscape), `${a.id}: soundscape preset ${a.soundscape}`);
    if (a.outfit) assert(ART[`character.lume.outfit.${a.outfit}`], `${a.id}: outfit ${a.outfit}`);
    assert(['paper', 'night'].includes(a.base));
    assert(a.accents.length >= 2 && a.accents.length <= 3);
    assert.equal(new Set(a.accents.map((x) => x.id)).size, a.accents.length);
  }
  assert(ATMOSPHERE_IDS.includes(DEFAULT_ATMOSPHERE));
});

test('every palette keeps text, links and buttons at AA (4.5:1)', () => {
  for (const a of ATMOSPHERES)
    for (const [label, fg, bg] of contrastPairs(a))
      assert(contrastRatio(fg, bg) >= 4.5, `${a.id} ${label}: ${contrastRatio(fg, bg).toFixed(2)}`);
});

test('the default atmosphere keeps the reference palette of the vision (no visual change)', () => {
  const p = getAtmosphere('lavender-desk').palette;
  assert.equal(p.background, '#f7f5fb');
  assert.equal(p.text, '#2e2a3b');
  assert.equal(getAtmosphere('lavender-desk').accents[0].strong, '#5a4896');
});

test('system.css holds the generated atmosphere block, up to date', () => {
  const css = read('css/system.css');
  const start = css.indexOf(CSS_START);
  const end = css.indexOf(CSS_END);
  assert(start > 0 && end > start, 'markers present');
  assert.equal(css.slice(start + CSS_START.length + 1, end), `${atmosphereCss()}\n`);
  // Each palette yields to other themes, to the palette switch and to "Contraste reforçado".
  assert.match(atmosphereCss(), /\[data-theme='paper'\]:not\(\[data-atmosphere-palette='off'\], \[data-high-contrast='true'\]\)/);
});

test('theme-init.js validates the same choices as atmospheres.js', () => {
  const source = read('js/utils/theme-init.js');
  const list = (name) => JSON.parse(source.match(new RegExp(`const ${name} = (\\[[^\\]]*\\])`))[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  assert.deepEqual(list('ATMOSPHERES'), ATMOSPHERE_IDS);
  assert.deepEqual(list('OUTFITS'), ATMOSPHERE_PREFERENCES.lumeOutfit);
  assert.deepEqual(list('COVERS'), ATMOSPHERE_PREFERENCES.notebookCover);
  assert.deepEqual(list('DECORATIONS'), ATMOSPHERE_PREFERENCES.decoration);
  assert.deepEqual(list('DESK_STARTERS'), [...STARTER_OBJECTS]);
  assert.deepEqual(list('DESK_SLOTS').sort(), Object.keys(DESK_SLOTS).sort());
});

/** Runs theme-init.js in a sandbox with a given localStorage and returns <html>'s dataset. */
function boot(stored) {
  const data = new Map(Object.entries(stored));
  const dataset = {};
  const style = { setProperty() {}, removeProperty() {} };
  const sandbox = {
    localStorage: {
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => data.set(k, String(v)),
      removeItem: (k) => data.delete(k),
    },
    document: {
      documentElement: { dataset, style, setAttribute() {}, removeAttribute() {} },
      querySelector: () => null,
      head: { append() {} },
      createElement: () => ({}),
    },
    location: { pathname: '/painel.html', hash: '' },
    window: {},
    setTimeout,
    crypto: globalThis.crypto,
    Event: class {},
  };
  sandbox.window = sandbox;
  sandbox.window.dispatchEvent = () => {};
  vm.runInNewContext(read('js/utils/theme-init.js'), sandbox);
  return { dataset, appearance: sandbox.VozAppearance, data };
}

test('experience mode: applied to <html> before first paint; the per-device value is migrated', () => {
  assert.equal(boot({}).dataset.experience, 'cozy');
  const legacy = boot({ 'voz-experience-mode': 'quiet' });
  assert.equal(legacy.dataset.experience, 'quiet');
  assert.equal(legacy.dataset.experienceMode, 'quiet', 'older pages read the same mode');
  // The account preference wins over the old device value.
  const account = boot({
    'voz-experience-mode': 'quiet',
    'audioestudo-ui-preferences': JSON.stringify({ experience: 'adventure' }),
  });
  assert.equal(account.dataset.experience, 'adventure');
  // Unknown values fall back to the default; nothing else is lost.
  const odd = boot({ 'audioestudo-ui-preferences': JSON.stringify({ experience: 'loud', textSize: 'large' }) });
  assert.equal(odd.dataset.experience, 'cozy');
  assert.equal(odd.dataset.textSize, 'large');
});

test('atmosphere preferences: validated and applied as data attributes', () => {
  const { dataset, appearance } = boot({
    'audioestudo-ui-preferences': JSON.stringify({
      atmosphere: 'seaside',
      atmosphereAccent: 'coral',
      atmosphereMotion: 'off',
      lumeOutfit: 'raincoat',
      decoration: 'abundant',
      deskStarters: { 'desk-left': 'object.cactus', window: 'object.globe', nowhere: 'object.teacup' },
    }),
  });
  assert.equal(dataset.atmosphere, 'seaside');
  assert.equal(dataset.atmosphereAccent, 'coral');
  assert.equal(dataset.atmosphereMotion, 'off');
  assert.equal(dataset.lumeOutfit, 'raincoat');
  assert.equal(dataset.decoration, 'abundant');
  // A collectible cannot be saved as a starter; unknown slots are dropped.
  assert.deepEqual(JSON.parse(JSON.stringify(appearance.loadUi().deskStarters)), { 'desk-left': 'object.cactus' });
  assert.equal(boot({ 'audioestudo-ui-preferences': '{"atmosphere":"mars"}' }).dataset.atmosphere, 'lavender-desk');
});

test('resolveAtmosphere: customisation and accessibility modes', () => {
  const base = resolveAtmosphere({ atmosphere: 'cozy-winter' });
  assert.equal(base.paletteActive, true);
  assert.equal(base.outfit, 'winter-scarf');
  assert.equal(base.wallpaper, 'wallpaper.cozy-winter');
  assert.equal(base.motion, 'snow');
  assert.equal(base.accent.id, 'berry');
  // A classic theme or the palette switch keeps the colours out; the rest stays.
  assert.equal(resolveAtmosphere({ atmosphere: 'cozy-winter' }, { theme: 'forest' }).paletteActive, false);
  assert.equal(resolveAtmosphere({ atmosphere: 'cozy-winter', atmospherePalette: 'off' }).paletteActive, false);
  assert.equal(resolveAtmosphere({ atmosphere: 'night-garden' }, { theme: 'night' }).paletteActive, true);
  // Custom choices.
  const custom = resolveAtmosphere({ atmosphere: 'cozy-winter', atmosphereAccent: 'pine', lumeOutfit: 'none', atmosphereWallpaper: 'off', atmosphereMotion: 'off' });
  assert.equal(custom.accent.id, 'pine');
  assert.equal(custom.outfit, null);
  assert.equal(custom.wallpaper, null);
  assert.equal(custom.motion, null);
  assert.equal(resolveAtmosphere({ atmosphere: 'cozy-winter', atmosphereAccent: 'nope' }).accent.id, 'berry');
  // High contrast and screen-reader mode override decoration; reduced motion stills the window.
  const contrast = resolveAtmosphere({ atmosphere: 'rainy-library', highContrast: true });
  assert.equal(contrast.paletteActive, false);
  assert.equal(contrast.wallpaper, null);
  assert.equal(contrast.decoration, 'minimal');
  assert.equal(resolveAtmosphere({ atmosphere: 'rainy-library', screenReaderMode: true }).wallpaper, null);
  assert.equal(resolveAtmosphere({ atmosphere: 'rainy-library', reducedMotion: true }).motion, null);
  assert.equal(resolveAtmosphere({ atmosphere: 'rainy-library', lowStimulation: true }).motion, null);
  assert.equal(resolveAtmosphere({ atmosphere: 'rainy-library', reducedMotion: true }).wallpaper, 'wallpaper.rainy-library');
});

test('choosing an atmosphere resets its suggestions; locked covers and outfits stay out', () => {
  assert.deepEqual(choosePreferences('seaside'), {
    atmosphere: 'seaside',
    atmosphereAccent: 'teal',
    atmospherePalette: 'on',
    lumeOutfit: 'auto',
    notebookCover: 'auto',
  });
  assert(!availableCovers([]).includes('cover.matcha-linen'), 'a collectible cover needs its unlock');
  assert(availableCovers([{ id: 'cover.matcha-linen' }]).includes('cover.matcha-linen'));
  assert.equal(availableOutfits([]).length, 4, 'the four outfits are defaults');
  const look = resolveAtmosphere({ notebookCover: 'cover.matcha-linen' }, { available: { covers: availableCovers([]) } });
  assert.notEqual(look.cover, 'cover.matcha-linen');
});

test('Lume on the desk is never sad: sleepy at night, happy after studying today, reading mid-lesson', () => {
  const at = (hour) => new Date(2026, 10, 21, hour, 0);
  assert.equal(companionState({ now: at(23) }), 'sleepy');
  assert.equal(companionState({ now: at(3), reviewedToday: true }), 'sleepy');
  assert.equal(companionState({ now: at(15), reviewedToday: true, lessonInProgress: true }), 'happy');
  assert.equal(companionState({ now: at(15), lessonInProgress: true }), 'reading');
  assert.equal(companionState({ now: at(15) }), 'idle');
  assert(isToday(at(8).getTime(), at(20)));
  assert(!isToday(new Date(2026, 10, 20, 23).toISOString(), at(20)));
  assert(!isToday(null));
});

test('desk: starters for everyone, collectibles only once unlocked and with the feature on', () => {
  assert.deepEqual(availableObjects(), [...STARTER_OBJECTS]);
  const unlocks = [
    { id: 'object.globe', kind: 'object' },
    { id: 'stamp.first-evidence', kind: 'stamp' },
  ];
  assert.deepEqual(availableObjects({ unlocks, discoveries: false }), [...STARTER_OBJECTS]);
  assert.deepEqual(availableObjects({ unlocks, discoveries: true }), [...STARTER_OBJECTS, 'object.globe']);
  const available = availableObjects({ unlocks, discoveries: true });
  const desk = mergeDesk({
    starters: { 'desk-left': 'object.teacup', window: 'object.cactus' },
    items: [
      { slot: 'window', objectId: 'object.globe' },
      { slot: 'wall', objectId: 'object.desk-lamp' }, // not unlocked: dropped
    ],
    available,
  });
  assert.deepEqual(desk, { 'desk-left': 'object.teacup', window: 'object.globe' });
});

test('desk: placing, swapping, storing and splitting into the two stores', () => {
  let desk = { 'desk-left': 'object.teacup', 'shelf-left': 'object.cactus' };
  desk = placeObject(desk, 'object.globe', 'desk-left'); // from the drawer: teacup goes back
  assert.deepEqual(desk, { 'desk-left': 'object.globe', 'shelf-left': 'object.cactus' });
  desk = placeObject(desk, 'object.cactus', 'desk-left'); // moving onto a taken place: swap
  assert.deepEqual(desk, { 'desk-left': 'object.cactus', 'shelf-left': 'object.globe' });
  desk = placeObject(desk, 'object.cactus', 'nowhere');
  assert.deepEqual(desk, { 'desk-left': 'object.cactus', 'shelf-left': 'object.globe' });
  desk = removeObject(desk, 'object.globe');
  assert.deepEqual(desk, { 'desk-left': 'object.cactus' });
  assert.deepEqual(splitDesk({ window: 'object.globe', 'desk-right': 'object.teacup' }), {
    starters: { 'desk-right': 'object.teacup' },
    items: [{ slot: 'window', objectId: 'object.globe' }],
  });
  assert.equal(describeDesk({}), 'A mesa está vazia.');
  assert.equal(describeDesk({ 'desk-right': 'object.teacup' }), 'Na sua mesa: Xícara de chá (mesa, à direita).');
});
