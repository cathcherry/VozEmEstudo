import test from 'node:test';
import assert from 'node:assert/strict';
import { lookFor, contrastRatio, NOTE_TYPES, templateLabels, templateNameTaken } from '../js/utils/card-looks.js';

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

test('templates with the same name are told apart by base, then by day, then by number', () => {
  const labels = templateLabels([
    { id: 'a', name: 'Matcha', base: 'notebook', updated_at: '2026-11-20T12:00:00Z' },
    { id: 'b', name: 'matcha ', base: 'sticky', updated_at: '2026-11-19T12:00:00Z' },
    { id: 'c', name: 'Prova', base: 'classic' },
    { id: 'd', name: 'Matcha', base: 'notebook', updated_at: '2026-11-18T12:00:00Z' },
    { id: 'e', name: 'Lousa', base: 'window', updated_at: '2026-11-18T12:00:00Z' },
    { id: 'f', name: 'Lousa', base: 'window', updated_at: '2026-11-18T12:00:00Z' },
  ]);
  assert.equal(labels.get('c'), 'Prova', 'a unique name shows alone');
  assert.equal(labels.get('b'), 'matcha · Post-it');
  assert.equal(labels.get('a'), 'Matcha · Caderno · 20/11/2026');
  assert.equal(labels.get('d'), 'Matcha · Caderno · 18/11/2026');
  assert.equal(labels.get('e'), 'Lousa · Janela · 18/11/2026 · 1');
  assert.equal(labels.get('f'), 'Lousa · Janela · 18/11/2026 · 2');
  assert.equal(new Set(labels.values()).size, 6, 'every option is distinct');
  assert.equal(templateNameTaken(' MATCHA', [{ id: 'a', name: 'Matcha' }]), true);
  assert.equal(templateNameTaken('Matcha', [{ id: 'a', name: 'Matcha' }], 'a'), false, 'renaming itself is fine');
});
