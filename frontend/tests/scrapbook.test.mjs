import test from 'node:test';
import assert from 'node:assert/strict';
import { ART } from '../js/art/manifest.js';
import {
  COVER_CHOICES,
  DECORATION_LIMIT,
  DECORATION_PATTERN,
  TEMPLATES,
  decorationChoices,
  emptyContent,
  keyAction,
  newDecoration,
  rotateBy,
  sanitizeDecorations,
  snap,
  spineColor,
} from '../js/utils/scrapbook.js';
import { mergeLooks, normalizeLook } from '../js/utils/notebook-look.js';

test('every offered cover, frame and decoration exists in the art manifest and passes the server allowlist', () => {
  for (const id of COVER_CHOICES) assert(ART[id], id);
  assert(!COVER_CHOICES.includes('cover.matcha-linen'), 'collectible covers come from the Gabinete');
  for (const kind of ['sticker', 'tape', 'frame', 'label', 'divider']) {
    const ids = decorationChoices(kind);
    assert(ids.length >= 4, kind);
    for (const id of ids) assert.match(id, DECORATION_PATTERN);
  }
  assert.deepEqual(decorationChoices('stamp'), [], 'no stamp before the Gabinete');
  assert.deepEqual(decorationChoices('stamp', ['stamp.revisit', 'stamp.nope', 'object.globe']), ['stamp.revisit']);
  for (const template of TEMPLATES) assert.equal(typeof emptyContent(template.id), 'object');
  for (const photo of emptyContent('collage').photos) assert(ART[photo.art] && ART[photo.frame]);
  assert.match(spineColor('cover.constellation'), /^#[0-9A-F]{6}$/i);
});

test('placement: snapping to guides and to the grid, keyboard steps, rotation wraps', () => {
  assert.equal(snap(49.2), 50, 'centre guide');
  assert.equal(snap(26.1), 25, 'quarter guide');
  assert.equal(snap(37.4), 37, 'grid');
  assert.equal(snap(-8), 0);
  assert.equal(snap(140), 100);
  const item = { id: 'a', art: 'sticker.moon', x: 10, y: 99.5, rotation: 178, scale: 2.45 };
  assert.equal(keyAction(item, { key: 'ArrowLeft' }).item.x, 9);
  assert.equal(keyAction(item, { key: 'ArrowRight', shiftKey: true }).item.x, 15);
  assert.equal(keyAction(item, { key: 'ArrowDown' }).item.y, 100, 'clamped to the page');
  assert.equal(keyAction(item, { key: 'r' }).item.rotation, -177, 'wraps past 180°');
  assert.equal(keyAction(item, { key: 'R', shiftKey: true }).item.rotation, 173);
  assert.equal(keyAction(item, { key: '+' }).item.scale, 2.5);
  assert.equal(keyAction({ ...item, scale: 0.45 }, { key: '-' }).item.scale, 0.4);
  assert.deepEqual(keyAction(item, { key: 'Delete' }), { remove: true });
  assert.equal(keyAction(item, { key: 'a' }), null);
  assert.equal(rotateBy({ rotation: -178 }, -5).rotation, 177);
  const a = newDecoration('tape.kraft', []);
  const b = newDecoration('tape.kraft', [a]);
  assert.notEqual(a.id, b.id);
  assert.notDeepEqual([a.x, a.y], [b.x, b.y], 'new pieces do not stack');
});

test('sanitizing keeps only allowlisted, known, unique decorations within the limit', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, art: 'sticker.star', x: 200, y: -4, rotation: 999, scale: 9 }));
  const clean = sanitizeDecorations([
    { id: 'x', art: 'object.globe', x: 1, y: 1, rotation: 0, scale: 1 },
    { id: 'y', art: 'sticker.unknown', x: 1, y: 1, rotation: 0, scale: 1 },
    { id: 's0', art: 'sticker.star', x: 1, y: 1, rotation: 0, scale: 1, extra: 'drop me' },
    ...many,
  ]);
  assert.equal(clean.length, DECORATION_LIMIT);
  assert.deepEqual(Object.keys(clean[0]), ['id', 'art', 'x', 'y', 'rotation', 'scale']);
  assert.deepEqual([clean[1].x, clean[1].y, clean[1].rotation, clean[1].scale], [100, 0, 180, 2.5]);
});

test('notebook looks: per lesson, the latest choice wins; unknown values fall back', () => {
  const merged = mergeLooks(
    { a: { cover: 'cover.kraft', at: '2026-11-20' }, b: { paper: 'dot', at: '2026-11-22' } },
    { a: { cover: 'cover.constellation', at: '2026-11-21' }, b: { paper: 'grid', at: '2026-11-21' } },
  );
  assert.equal(merged.a.cover, 'cover.constellation');
  assert.equal(merged.b.paper, 'dot');
  assert.deepEqual(normalizeLook({ cover: 'javascript:alert(1)', paper: 'papyrus' }), { cover: 'cover.cloth-lavender', paper: 'ruled' });
  assert.deepEqual(normalizeLook({ cover: 'cover.field-notes', paper: 'kraft' }), { cover: 'cover.field-notes', paper: 'kraft' });
});
