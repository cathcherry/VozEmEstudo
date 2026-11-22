import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  ART,
  ART_BASE,
  ART_KINDS,
  LUME_OUTFITS,
  LUME_STATES,
  ORIGINAL,
  kindOf,
} from '../js/art/manifest.js';
import { C, MARK } from '../../scripts/art/lib.mjs';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artRoot = path.join(frontend, 'assets/art');
const { window } = new JSDOM('');
const parse = (file) =>
  new window.DOMParser().parseFromString(readFileSync(file, 'utf8'), 'image/svg+xml');
const fileOf = (entry) => path.join(artRoot, entry.src);
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory() ? walk(path.join(dir, item.name)) : [path.join(dir, item.name)],
  );

test('art manifest: ids follow the naming scheme and point into the folder of their kind', () => {
  assert.equal(ART_BASE, '/assets/art/');
  const ids = Object.keys(ART);
  assert(ids.length >= 55, `${ids.length} entries`);
  for (const id of ids) {
    const kind = ART_KINDS[kindOf(id)];
    assert(kind, `${id}: unknown kind`);
    assert.match(id, kind.pattern, `${id}: id pattern`);
    assert(ART[id].src.startsWith(kind.folder), `${id}: ${ART[id].src} outside ${kind.folder}`);
  }
  const sources = ids.map((id) => ART[id].src);
  assert.equal(new Set(sources).size, sources.length, 'each file is used by one id');
});

test('art manifest: every entry has a file, dimensions, pt-BR alt text and a licence', () => {
  for (const [id, entry] of Object.entries(ART)) {
    assert(existsSync(fileOf(entry)), `${id}: missing file ${entry.src}`);
    assert(Number.isInteger(entry.width) && entry.width > 0, `${id}: width`);
    assert(Number.isInteger(entry.height) && entry.height > 0, `${id}: height`);
    assert(typeof entry.alt === 'string' && entry.alt.trim().length >= 3, `${id}: alt`);
    assert(typeof entry.license === 'string' && entry.license.trim(), `${id}: license`);
    assert(Array.isArray(entry.animation), `${id}: animation states`);
    const kind = kindOf(id);
    if (['stamp', 'object', 'cover', 'wallpaper'].includes(kind) || id.includes('.outfit.'))
      assert(entry.title, `${id}: title`);
    if (kind === 'stamp') assert(entry.event?.endsWith('.'), `${id}: learning event`);
    if (kind === 'wallpaper') assert(['light', 'dark'].includes(entry.tone), `${id}: tone`);
  }
});

test('art files: valid SVG, size matches the manifest, no scripts, links or embedded text', () => {
  for (const [id, entry] of Object.entries(ART)) {
    const doc = parse(fileOf(entry));
    assert.equal(doc.getElementsByTagName('parsererror').length, 0, `${id}: XML`);
    const svg = doc.documentElement;
    assert.equal(svg.nodeName, 'svg', id);
    assert.equal(
      svg.getAttribute('viewBox'),
      `0 0 ${entry.width} ${entry.height}`,
      `${id}: viewBox`,
    );
    assert.equal(svg.getAttribute('width'), String(entry.width), `${id}: width attribute`);
    assert.equal(svg.getAttribute('height'), String(entry.height), `${id}: height attribute`);
    for (const tag of ['script', 'foreignObject', 'text', 'image', 'style'])
      assert.equal(doc.getElementsByTagName(tag).length, 0, `${id}: <${tag}>`);
    for (const node of doc.getElementsByTagName('*'))
      for (const attribute of node.attributes) {
        assert(!/^on/i.test(attribute.name), `${id}: event handler`);
        if (/href$/i.test(attribute.name)) assert(attribute.value.startsWith('#'), `${id}: link`);
      }
  }
});

test('art files: no orphans, and generated art only uses the palette', () => {
  const listed = new Set(Object.values(ART).map((entry) => path.join(artRoot, entry.src)));
  const palette = new Set(Object.values(C).map((hex) => hex.toUpperCase()));
  for (const file of walk(artRoot)) {
    assert(listed.has(file), `${path.relative(artRoot, file)} is not in the manifest`);
    const text = readFileSync(file, 'utf8');
    if (!text.includes(MARK)) continue; // a hand-drawn replacement may use its own colours
    for (const [hex] of text.matchAll(/#[\da-f]{6}\b/gi))
      assert(palette.has(hex.toUpperCase()), `${path.relative(artRoot, file)}: ${hex} off-palette`);
  }
});

test('Lume: every state and outfit is listed, with the animated parts CSS expects', () => {
  assert.deepEqual(LUME_STATES, ['idle', 'reading', 'thinking', 'happy', 'sleepy', 'celebrating']);
  assert.equal(LUME_OUTFITS.length, 4);
  for (const state of LUME_STATES) {
    const entry = ART[`character.lume.${state}`];
    assert(entry?.inline, `${state}: inline SVG`);
    assert.equal(entry.license, ORIGINAL);
    const doc = parse(fileOf(entry));
    for (const part of [
      'lume-figure',
      'lume-wing-l',
      'lume-wing-r',
      'lume-antenna-l',
      'lume-antenna-r',
      'lume-body',
      'lume-eyes',
      'lume-lantern',
      'lume-glow',
    ])
      assert(doc.querySelector(`.${part}`), `${state}: .${part}`);
    for (const layer of ['body', 'head'])
      assert(
        doc.querySelector(`.lume-outfit-slot[data-layer="${layer}"]`),
        `${state}: ${layer} slot`,
      );
  }
  assert(parse(fileOf(ART['character.lume.idle'])).querySelectorAll('.lume-lid').length === 2);
  assert.deepEqual(ART['character.lume.reading'].animation, [], 'nothing moves while reading');
  for (const outfit of LUME_OUTFITS) {
    const doc = parse(fileOf(ART[`character.lume.outfit.${outfit}`]));
    assert(doc.querySelector('[data-layer="body"], [data-layer="head"]'), `${outfit}: layers`);
  }
});

test('art.js: unknown ids fail soft, known ids render with alt text and size', async () => {
  const dom = new JSDOM(
    '<!doctype html><body><div data-art-slot="empty" data-art-id="empty.nope"></div><div data-art-slot="empty" data-art-id="empty.planner"></div></body>',
    { url: 'http://localhost/arte.html' },
  );
  const saved = {};
  for (const key of ['window', 'document', 'location', 'DOMParser', 'MutationObserver', 'Element'])
    saved[key] = globalThis[key];
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    DOMParser: dom.window.DOMParser,
    MutationObserver: dom.window.MutationObserver,
    Element: dom.window.Element,
  });
  const warnings = [];
  const warn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    const art = await import('../js/art/art.js');
    assert.equal(art.getArt('stamp.nope'), null);
    assert.equal(art.renderArt('stamp.nope'), null);
    const img = art.renderArt('stamp.revisit', { size: 48 });
    assert.equal(img.alt, 'Selo “Revisita”');
    assert.equal(img.style.width, '48px');
    assert.equal(img.getAttribute('src'), 'http://localhost/assets/art/stamps/revisit.svg');
    assert.equal(art.renderArt('stamp.revisit', { decorative: true }).alt, '');
    const icon = art.renderArt('icon.leaf');
    assert.equal(icon.getAttribute('role'), 'img');
    assert.equal(icon.getAttribute('aria-label'), 'Folha');
    const [missing, planner] = document.querySelectorAll('[data-art-slot]');
    assert.equal(missing.children.length, 0, 'a missing id draws nothing');
    assert.equal(planner.querySelector('img')?.dataset.artId, 'empty.planner');
    assert.equal(planner.querySelector('img').alt, '', 'slots are decorative by default');
    assert(
      warnings.some((message) => message.includes('empty.nope')),
      'warns on a dev host',
    );
  } finally {
    console.warn = warn;
    Object.assign(globalThis, saved);
    dom.window.close();
  }
});

// ---- 3.6: scrapbook set, discipline emblems and the functional icon sprite ----

test('3.6 kinds: every kind has its pieces, with titles and the expected sizes', async () => {
  const { EMBLEM_IDS } = await import('../js/art/manifest.js');
  const count = (kind) => Object.keys(ART).filter((id) => kindOf(id) === kind).length;
  const expected = { emblem: 24, paper: 7, tape: 8, sticker: 20, frame: 5, divider: 5, label: 4 };
  for (const [kind, total] of Object.entries(expected)) {
    assert.equal(count(kind), total, `${kind}: ${count(kind)} pieces`);
    for (const id of Object.keys(ART).filter((key) => kindOf(key) === kind)) {
      assert(ART[id].title, `${id}: title`);
      assert.equal(ART[id].license, ORIGINAL, `${id}: original art`);
    }
  }
  assert(count('cover') >= 12, 'six new covers next to the first six');
  const sizes = {
    emblem: [64, 64],
    paper: [200, 260],
    tape: [160, 44],
    sticker: [96, 96],
    frame: [200, 240],
    divider: [320, 24],
    label: [200, 72],
  };
  for (const [id, entry] of Object.entries(ART)) {
    const size = sizes[kindOf(id)];
    if (size) assert.deepEqual([entry.width, entry.height], size, `${id}: size`);
  }
  assert.deepEqual(
    EMBLEM_IDS,
    Object.keys(ART).filter((id) => id.startsWith('emblem.')),
  );
  const families = new Set(['lavender', 'matcha', 'honey', 'mist', 'rose', 'wood']);
  for (const id of EMBLEM_IDS) assert(families.has(ART[id].family), `${id}: tint family`);
  const titles = EMBLEM_IDS.map((id) => ART[id].title);
  assert.equal(new Set(titles).size, titles.length, 'emblem names are distinct');
});

test('3.6 art: stickers are die-cut, frames keep a transparent window, builds are reproducible', async () => {
  for (const id of Object.keys(ART).filter((key) => kindOf(key) === 'sticker')) {
    const doc = parse(fileOf(ART[id]));
    assert(doc.getElementsByTagName('feMorphology').length, `${id}: white die-cut border`);
  }
  for (const id of Object.keys(ART).filter(
    (key) => kindOf(key) === 'frame' && key !== 'frame.tape-corners',
  ))
    assert.match(readFileSync(fileOf(ART[id]), 'utf8'), /fill-rule="evenodd"/, `${id}: window`);
  const { emblemFiles } = await import('../../scripts/art/emblems.mjs');
  const { scrapbookFiles } = await import('../../scripts/art/scrapbook.mjs');
  const first = { ...emblemFiles(), ...scrapbookFiles() };
  const again = { ...emblemFiles(), ...scrapbookFiles() };
  assert.deepEqual(first, again, 'seeded edges: the same drawing every build');
  for (const [relative, content] of Object.entries(first)) {
    const onDisk = readFileSync(path.join(artRoot, relative), 'utf8');
    if (onDisk.includes(MARK)) assert.equal(onDisk, content, `${relative}: run npm run art:build`);
  }
});

test('emblems: a folder name suggests its emblem, whole words only', async () => {
  const { emblemFor } = await import('../js/utils/folder-icons.js');
  const cases = {
    'Biologia celular': 'emblem.biologia',
    'Química orgânica': 'emblem.quimica',
    'Educação Física': 'emblem.educacao-fisica',
    'Física II': 'emblem.fisica',
    'Cálculo 1': 'emblem.matematica',
    'Inglês instrumental': 'emblem.idiomas',
    'Leitura e produção de texto': 'emblem.literatura',
    'Programação web': 'emblem.computacao',
    Anatomia: 'emblem.saude',
    TCC: 'emblem.pesquisa',
    'Partes do corpo': null,
    'Projeto pessoal': null,
    '': null,
  };
  for (const [name, expected] of Object.entries(cases))
    assert.equal(emblemFor(name), expected, name);
  for (const id of Object.values(cases).filter(Boolean)) assert(ART[id], `${id} exists`);
});

test('icons: every semantic icon is in the Phosphor sprite, with the MIT licence beside it', async () => {
  const { ICON_MAP, ICON_NAMES, ICON_SPRITE, iconMarkup } = await import('../js/utils/icons.js');
  const iconsRoot = path.join(frontend, 'assets/icons');
  const sprite = readFileSync(path.join(iconsRoot, 'sprite.svg'), 'utf8');
  assert.equal(ICON_SPRITE, '/assets/icons/sprite.svg');
  assert(ICON_NAMES.length >= 60, `${ICON_NAMES.length} icons`);
  for (const name of ICON_NAMES) {
    assert.match(name, /^[a-z]+(?:-[a-z]+)*$/, `${name}: semantic name`);
    assert(
      sprite.includes(`<symbol id="i-${name}"`),
      `${name}: in the sprite (npm run icons:build)`,
    );
    assert(ICON_MAP[name], `${name}: Phosphor source`);
  }
  assert.equal((sprite.match(/<symbol /g) || []).length, ICON_NAMES.length, 'no stale symbols');
  assert.match(sprite, /Phosphor Icons 2\.1\.1.*MIT License/);
  assert.match(readFileSync(path.join(iconsRoot, 'PHOSPHOR-LICENSE.txt'), 'utf8'), /MIT License/);
  for (const forbidden of ['<script', 'href="http', 'onload'])
    assert(!sprite.includes(forbidden), `sprite: ${forbidden}`);
  assert.match(
    iconMarkup('search', { label: 'Buscar "aula"' }),
    /role="img" aria-label="Buscar &quot;aula&quot;"/,
  );
  assert.match(iconMarkup('home'), /aria-hidden="true"/);
  assert.throws(() => iconMarkup('nope'), /Unknown icon/);
  // The static app shell uses the sprite (npm run icons:build rewrites legacy drawings).
  for (const page of [
    'painel.html',
    'historico.html',
    'revisar.html',
    'planejar.html',
    'focar.html',
  ]) {
    const { document } = new JSDOM(readFileSync(path.join(frontend, 'pages', page), 'utf8')).window;
    const navIcons = [...document.querySelectorAll('.side-navigation svg')];
    assert(navIcons.length >= 7, `${page}: sidebar icons`);
    for (const svg of navIcons) {
      const href = svg.querySelector('use')?.getAttribute('href') || '';
      assert(href.startsWith(`${ICON_SPRITE}#i-`), `${page}: sidebar icon from the sprite`);
    }
  }
});
