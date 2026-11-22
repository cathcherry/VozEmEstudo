// Biblioteca "Selecionar" rules (3.6): toggling lessons and folders, Shift ranges, the summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectionState, toggleItem, selectRange, selectionSummary } from '../js/utils/library-selection.js';

const ids = (set) => [...set].sort();

test('a lesson toggles on and off', () => {
  let selected = toggleItem(new Set(), ['a']);
  assert.deepEqual(ids(selected), ['a']);
  selected = toggleItem(selected, ['a']);
  assert.deepEqual(ids(selected), []);
});

test('a folder selects all its lessons, a partly selected folder completes, a full one clears', () => {
  let selected = new Set(['b']);
  assert.equal(selectionState(['a', 'b', 'c'], selected), 'some');
  selected = toggleItem(selected, ['a', 'b', 'c']);
  assert.deepEqual(ids(selected), ['a', 'b', 'c']);
  assert.equal(selectionState(['a', 'b', 'c'], selected), 'all');
  selected = toggleItem(selected, ['a', 'b', 'c']);
  assert.deepEqual(ids(selected), []);
  assert.equal(selectionState([], selected), 'empty');
  assert.equal(selectionState(['a'], selected), 'none');
});

test('Shift extends from the anchor to the target, in either direction, with the target\'s new state', () => {
  const items = [['a'], ['b'], ['c', 'd'], ['e']];
  let selected = selectRange(new Set(['a']), items, 0, 2);
  assert.deepEqual(ids(selected), ['a', 'b', 'c', 'd']);
  // Upwards, onto an unselected target: the whole range is selected.
  selected = selectRange(new Set(), items, 3, 1);
  assert.deepEqual(ids(selected), ['b', 'c', 'd', 'e']);
  // Target already fully selected: the range is cleared.
  selected = selectRange(selected, items, 3, 2);
  assert.deepEqual(ids(selected), ['b']);
  // No anchor: a plain toggle.
  assert.deepEqual(ids(selectRange(new Set(), items, -1, 2)), ['c', 'd']);
});

test('the bar says what is selected, or how to start', () => {
  assert.equal(selectionSummary(0), 'Toque nas aulas ou pastas para selecionar');
  assert.equal(selectionSummary(1), '1 aula selecionada');
  assert.equal(selectionSummary(4), '4 aulas selecionadas');
});
