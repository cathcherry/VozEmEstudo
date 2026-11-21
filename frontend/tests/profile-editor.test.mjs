import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProfileLayout,
  duplicateBlock,
  moveBlock,
  newDataBlock,
  DATA_BLOCKS,
} from '../js/utils/profile-blocks.js';

test('profile layout keeps only known sections, once', () => {
  assert.deepEqual(normalizeProfileLayout(null), { version: 1, hiddenSections: [] });
  assert.deepEqual(
    normalizeProfileLayout({
      hiddenSections: ['achievements', 'achievements', 'navigation', 'about'],
    }),
    { version: 1, hiddenSections: ['achievements', 'about'] },
  );
});

test('duplicate places a fresh, visible copy after the original and keeps unknown fields', () => {
  const blocks = [
    {
      id: 'a',
      title: 'Lista',
      type: 'widget',
      templateId: 'checklist',
      checkedItems: { 0: true },
      hidden: true,
      extra: 7,
    },
    { id: 'b', title: 'B', type: 'text' },
  ];
  const next = duplicateBlock(blocks, 'a');
  assert.equal(next.length, 3);
  assert.equal(next[1].title, 'Lista (cópia)');
  assert.notEqual(next[1].id, 'a');
  assert.deepEqual(next[1].checkedItems, {});
  assert.equal(next[1].hidden, false);
  assert.equal(next[1].extra, 7);
  assert.deepEqual(blocks[0].checkedItems, { 0: true }, 'original untouched');
  assert.equal(duplicateBlock(blocks, 'missing'), blocks);
  assert.equal(duplicateBlock([{ id: 'x', title: 'x'.repeat(80) }], 'x')[1].title.length, 80);
});

test('move stays within bounds', () => {
  const blocks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(
    moveBlock(blocks, 'b', -1).map((b) => b.id),
    ['b', 'a', 'c'],
  );
  assert.deepEqual(
    moveBlock(blocks, 'c', 1).map((b) => b.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    moveBlock(blocks, 'a', -1).map((b) => b.id),
    ['a', 'b', 'c'],
  );
});

test('data blocks store no content of their own beyond a readable description', () => {
  for (const source of Object.keys(DATA_BLOCKS)) {
    const block = newDataBlock(source);
    assert.equal(block.type, 'data');
    assert.equal(block.source, source);
    assert.equal(block.content, DATA_BLOCKS[source].description);
  }
  assert.throws(() => newDataBlock('salary'));
});
