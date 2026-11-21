import test from 'node:test';
import assert from 'node:assert/strict';
import { lookFor, contrastRatio, NOTE_TYPES } from '../js/utils/card-looks.js';

test('a set shows one look: its own template, a base, or the favourite', () => {
  const templates = [{ id: 't1', base: 'notebook', tokens: { accent: '#7aae62' }, variants: { cloze: { layout: 'left' } } }];
  assert.deepEqual(lookFor({ template_id: 't1' }, templates), { base: 'notebook', tokens: { accent: '#7aae62' }, variants: { cloze: { layout: 'left' } } });
  assert.deepEqual(lookFor({ template_base: 'sticky' }, templates), { base: 'sticky', tokens: {}, variants: {} });
  assert.equal(lookFor({ template_id: 'gone' }, templates), null, 'a deleted template falls back to the favourite');
  assert.equal(lookFor(null, templates), null);
});

test('contrast ratio follows WCAG and the eight note types are offered', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  assert(contrastRatio('#eeeeee', '#ffffff') < 4.5);
  assert.equal(NOTE_TYPES.length, 8);
});
