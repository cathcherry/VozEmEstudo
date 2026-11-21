// "Personalizar" on Início: a side sheet that shows or hides optional cards, moves blocks within
// their column and sets the card density. Every change applies at once (the page itself is the
// preview) and is saved to the account; "Restaurar padrão" brings back the default layout.
import { getFeatureFlags } from '../utils/feature-flags.js';
import { t } from '../i18n/i18n.js';
import { cachedCloudState, loadCloudState, saveCloudState } from '../utils/profile-cloud.js';
import {
  DASHBOARD_LAYOUT_KEY,
  DASHBOARD_UNITS,
  DASHBOARD_WIDGETS,
  applyDashboardLayout,
  defaultDashboardLayout,
  isDefaultDashboardLayout,
  moveUnit,
  normalizeDashboardLayout,
  toggleWidget,
} from '../utils/dashboard-layout.js';

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};

/**
 * @param {{ owner: string, root?: Document }} options
 * @returns {Promise<{ layout: () => object }>}
 */
export async function initDashboardCustomize({ owner }) {
  // Paint this account's last known layout immediately, then confirm with the account copy.
  let layout = applyDashboardLayout(cachedCloudState(owner, DASHBOARD_LAYOUT_KEY));
  const trigger = document.querySelector('[data-dashboard-customize]');
  const dialog = document.querySelector('[data-dashboard-customize-dialog]');
  const list = dialog?.querySelector('[data-customize-list]');
  const status = dialog?.querySelector('[data-customize-status]');
  const reset = dialog?.querySelector('[data-customize-reset]');
  let flags = {};
  let saving = Promise.resolve();
  let edited = false;

  function render(focus = null) {
    if (!list) return;
    list.replaceChildren();
    for (const column of ['main', 'rail']) {
      const group = make('section', null, 'customize-group');
      const heading = make(
        'h3',
        t(column === 'main' ? 'customize.mainColumn' : 'customize.sideColumn'),
      );
      heading.id = `customize-${column}`;
      group.setAttribute('aria-labelledby', heading.id);
      const items = make('ol', null, 'customize-units');
      if (column === 'main') {
        const fixed = make('li', null, 'customize-unit is-fixed');
        fixed.append(
          make('strong', t('dashboard.continue')),
          make('span', t('customize.alwaysOnTop'), 'customize-note'),
        );
        items.append(fixed);
      }
      const order = layout.order[column];
      order.forEach((unit, index) => {
        const item = make('li', null, 'customize-unit');
        item.dataset.unit = unit;
        const unitLabel = t(`widget.${unit}`);
        const title = make('strong', unitLabel);
        title.id = `customize-unit-${unit}`;
        const toggles = make('div', null, 'customize-toggles');
        for (const widget of DASHBOARD_WIDGETS.filter((candidate) => candidate.unit === unit)) {
          const available = !widget.flag || Boolean(flags[widget.flag]);
          const label = make('label', null, 'customize-toggle');
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.dataset.widgetToggle = widget.id;
          input.checked = !layout.hidden.includes(widget.id);
          input.disabled = !available;
          input.addEventListener('change', () =>
            update(
              toggleWidget(layout, widget.id, input.checked),
              `[data-widget-toggle="${widget.id}"]`,
            ),
          );
          const caption = make(
            'span',
            unit === 'plan' ? t(`widget.${widget.id}`) : t('customize.show'),
          );
          label.append(input, caption);
          if (!available) label.append(make('span', t('customize.off'), 'customize-note'));
          toggles.append(label);
        }
        const moves = make('div', null, 'customize-moves');
        for (const [direction, key, symbol] of [
          [-1, 'customize.moveUp', '↑'],
          [1, 'customize.moveDown', '↓'],
        ]) {
          const button = make('button', symbol, 'icon-action customize-move');
          button.type = 'button';
          button.dataset.move = `${unit}:${direction}`;
          button.setAttribute('aria-label', t(key, { label: unitLabel }));
          button.disabled = direction < 0 ? index === 0 : index === order.length - 1;
          button.addEventListener('click', () => {
            const next = moveUnit(layout, unit, direction);
            const newIndex = next.order[column].indexOf(unit);
            // Keep focus on the moved block; at an edge, on the button that still works.
            const atEdge = direction < 0 ? newIndex === 0 : newIndex === order.length - 1;
            update(next, `[data-move="${unit}:${atEdge ? -direction : direction}"]`);
          });
          moves.append(button);
        }
        item.append(title, toggles, moves);
        items.append(item);
      });
      group.append(heading, items);
      list.append(group);
    }
    if (reset) reset.disabled = isDefaultDashboardLayout(layout);
    if (focus) dialog.querySelector(focus)?.focus();
  }

  function say(text, state = '') {
    if (!status) return;
    status.textContent = text;
    status.dataset.state = state;
  }

  function update(next, focus) {
    edited = true;
    layout = applyDashboardLayout(next);
    render(focus);
    say(t('common.saving'));
    const copy = structuredClone(layout);
    saving = saving.then(async () => {
      const synced = await saveCloudState(owner, DASHBOARD_LAYOUT_KEY, copy);
      say(
        synced ? t('customize.saved') : t('customize.savedLocal'),
        synced ? 'success' : 'warning',
      );
    });
  }

  reset?.addEventListener('click', () => {
    update(defaultDashboardLayout(), '[data-customize-done]');
    say(t('customize.restored'), 'success');
  });
  trigger?.addEventListener('click', () => {
    say('');
    render();
    dialog.showModal();
    dialog.querySelector('h2')?.focus();
  });
  for (const button of dialog?.querySelectorAll('[data-customize-done]') || [])
    button.addEventListener('click', () => dialog.close());
  dialog?.addEventListener('close', () => trigger?.focus());
  // A click on the dimmed area (outside the sheet) closes it, like Escape.
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  flags = await getFeatureFlags().catch(() => ({}));
  const remote = await loadCloudState(owner, DASHBOARD_LAYOUT_KEY, null);
  // An edit made while the account copy was loading is newer: keep it.
  if (
    !edited &&
    remote &&
    JSON.stringify(normalizeDashboardLayout(remote)) !== JSON.stringify(layout)
  ) {
    layout = applyDashboardLayout(remote);
  }
  if (trigger) trigger.hidden = false;
  if (dialog?.open) render();
  return { layout: () => layout, units: DASHBOARD_UNITS };
}
