// Início customization: which optional cards are shown and in which order. The default layout
// stays the reference; a saved layout only lists differences the person chose. It is stored per
// account in `profile_state` (key `dashboard-layout`) through profile-cloud.js, the same
// synchronization used by the profile and preferences, so there is no second widget store.
// "Continuar estudando", the navigation and the account menu are not part of the layout and can
// never be hidden.

export const DASHBOARD_LAYOUT_KEY = 'dashboard-layout';

/** Optional cards. `unit` is the block that moves; `flag` hides the card when the tool is off. */
export const DASHBOARD_WIDGETS = Object.freeze([
  { id: 'tasks', label: 'Próximas tarefas', unit: 'plan', flag: 'planning' },
  { id: 'cards', label: 'Flashcards', unit: 'plan', flag: 'flashcards' },
  { id: 'recent', label: 'Aulas recentes', unit: 'recent' },
  { id: 'week', label: 'Sua semana', unit: 'week', flag: 'study_tracking' },
  { id: 'agenda', label: 'Agenda do mês', unit: 'agenda', flag: 'calendar' },
  { id: 'subjects', label: 'Suas disciplinas', unit: 'subjects' },
  { id: 'notes', label: 'Anotações', unit: 'notes', flag: 'annotations' },
]);

/** Blocks that can be reordered, per column, in their default order. */
export const DASHBOARD_UNITS = Object.freeze({
  main: Object.freeze(['plan', 'recent']),
  rail: Object.freeze(['week', 'agenda', 'subjects', 'notes']),
});
export const UNIT_LABELS = Object.freeze({
  plan: 'Tarefas e flashcards',
  recent: 'Aulas recentes',
  week: 'Sua semana',
  agenda: 'Agenda do mês',
  subjects: 'Suas disciplinas',
  notes: 'Anotações',
});

const WIDGET_IDS = new Set(DASHBOARD_WIDGETS.map((widget) => widget.id));

export function defaultDashboardLayout() {
  return {
    version: 1,
    hidden: [],
    order: { main: [...DASHBOARD_UNITS.main], rail: [...DASHBOARD_UNITS.rail] },
  };
}

/**
 * Accepts anything (an old, partial or tampered copy) and returns a valid layout: unknown ids are
 * dropped, duplicates removed, and blocks missing from a saved order keep their default place.
 */
export function normalizeDashboardLayout(raw) {
  const layout = defaultDashboardLayout();
  if (!raw || typeof raw !== 'object') return layout;
  if (Array.isArray(raw.hidden))
    layout.hidden = [...new Set(raw.hidden.filter((id) => WIDGET_IDS.has(id)))];
  for (const column of ['main', 'rail']) {
    const allowed = DASHBOARD_UNITS[column];
    const saved = Array.isArray(raw.order?.[column]) ? raw.order[column] : [];
    const kept = [...new Set(saved.filter((id) => allowed.includes(id)))];
    for (const id of allowed) {
      if (kept.includes(id)) continue;
      // A block added in a later version goes back to its default neighbour.
      const index = allowed.indexOf(id);
      const before = allowed
        .slice(0, index)
        .reverse()
        .find((other) => kept.includes(other));
      kept.splice(before ? kept.indexOf(before) + 1 : 0, 0, id);
    }
    layout.order[column] = kept;
  }
  return layout;
}

export function isDefaultDashboardLayout(layout) {
  const normal = normalizeDashboardLayout(layout);
  const reference = defaultDashboardLayout();
  return (
    normal.hidden.length === 0 &&
    normal.order.main.join() === reference.order.main.join() &&
    normal.order.rail.join() === reference.order.rail.join()
  );
}

export function toggleWidget(layout, id, visible) {
  const normal = normalizeDashboardLayout(layout);
  const hidden = new Set(normal.hidden);
  if (visible) hidden.delete(id);
  else if (WIDGET_IDS.has(id)) hidden.add(id);
  return { ...normal, hidden: [...hidden] };
}

/** Moves a block one place up (-1) or down (+1) inside its column. */
export function moveUnit(layout, unit, direction) {
  const normal = normalizeDashboardLayout(layout);
  const column = DASHBOARD_UNITS.main.includes(unit) ? 'main' : 'rail';
  const order = [...normal.order[column]];
  const index = order.indexOf(unit);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return normal;
  [order[index], order[target]] = [order[target], order[index]];
  return { ...normal, order: { ...normal.order, [column]: order } };
}

/** Applies a layout to the Início page: hidden cards get `data-user-hidden`; blocks are moved
 * in the DOM (not only visually) so reading and keyboard order follow what is on screen. */
export function applyDashboardLayout(layout, root = document) {
  const normal = normalizeDashboardLayout(layout);
  for (const widget of DASHBOARD_WIDGETS) {
    const node = root.querySelector(`[data-widget="${widget.id}"]`);
    if (node) node.toggleAttribute('data-user-hidden', normal.hidden.includes(widget.id));
  }
  for (const column of ['main', 'rail']) {
    const nodes = normal.order[column]
      .map((unit) => root.querySelector(`[data-widget-unit="${unit}"]`))
      .filter(Boolean);
    const parent = nodes[0]?.parentElement;
    if (!parent) continue;
    // Keep anything that is not a movable block (e.g. "Continuar estudando") where it was.
    const anchor = [...parent.children].findLast(
      (child) => !child.hasAttribute('data-widget-unit'),
    );
    let reference = anchor ? anchor.nextSibling : parent.firstChild;
    for (const node of nodes) {
      if (node !== reference) parent.insertBefore(node, reference);
      reference = node.nextSibling;
    }
    parent.classList.toggle(
      'has-custom-order',
      normal.order[column].join() !== DASHBOARD_UNITS[column].join(),
    );
  }
  return normal;
}
