import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStickers, STICKERS, STICKER_MAX } from '../js/utils/stickers.js';

test('stickers: known kinds only, no repeats, at most three', () => {
  assert.equal(STICKERS.length, 8);
  assert.equal(STICKER_MAX, 3);
  assert.deepEqual(normalizeStickers(['heart', 'heart', 'x', '<svg>', 'star', 'leaf', 'book']), ['heart', 'star', 'leaf']);
  assert.deepEqual(normalizeStickers('star'), []);
  assert.deepEqual(normalizeStickers(null), []);
});
