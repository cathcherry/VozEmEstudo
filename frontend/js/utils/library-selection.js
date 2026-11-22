// Biblioteca: the rules of "Selecionar" (3.6), shared by the page and the unit tests. A selectable
// item is a lesson (one id) or a folder (the ids of the lessons inside it). Nothing here touches
// the DOM or the network.

/** 'empty' (nothing to select), 'none', 'some' or 'all' of `ids` in `selected`. */
export function selectionState(ids, selected) {
  if (!ids.length) return 'empty';
  const count = ids.filter((id) => selected.has(id)).length;
  return count === 0 ? 'none' : count === ids.length ? 'all' : 'some';
}

/** Toggles an item: a fully selected item is cleared, anything else becomes fully selected. */
export function toggleItem(selected, ids) {
  const next = new Set(selected);
  const on = selectionState(ids, selected) !== 'all';
  for (const id of ids) on ? next.add(id) : next.delete(id);
  return next;
}

/**
 * Shift-click: every item between the anchor and the target (both included, in screen order)
 * takes the target's new state. `items` is a list of id lists in screen order. Without a usable
 * anchor it is a plain toggle of the target.
 */
export function selectRange(selected, items, anchorIndex, targetIndex) {
  const target = items[targetIndex] || [];
  if (anchorIndex === null || anchorIndex === undefined || anchorIndex < 0 || anchorIndex >= items.length)
    return toggleItem(selected, target);
  const on = selectionState(target, selected) !== 'all';
  const next = new Set(selected);
  const [from, to] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
  for (let index = from; index <= to; index += 1)
    for (const id of items[index]) on ? next.add(id) : next.delete(id);
  return next;
}

/** "3 aulas selecionadas" / the hint when nothing is selected yet. */
export function selectionSummary(count) {
  if (!count) return 'Toque nas aulas ou pastas para selecionar';
  return `${count} ${count === 1 ? 'aula selecionada' : 'aulas selecionadas'}`;
}
