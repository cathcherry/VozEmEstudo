// Tabs for the Revisar and Planejar pages. Each tab is a link-able section (#hash), only enabled
// tools get a tab, and the arrow keys move between tabs (WAI-ARIA tabs pattern).

/**
 * @param {HTMLElement} tablist element with role="tablist" holding buttons[data-tab]
 * @param {string[]} available ids of the sections whose tools are enabled
 * @returns {{select: (id: string, focus?: boolean) => void, current: () => string}}
 */
export function initToolTabs(tablist, available) {
  const tabs = [...tablist.querySelectorAll('[role="tab"][data-tab]')];
  const visible = tabs.filter((tab) => available.includes(tab.dataset.tab));
  for (const tab of tabs) {
    const show = visible.includes(tab);
    tab.hidden = !show;
    if (!show) document.getElementById(tab.dataset.tab)?.setAttribute('hidden', '');
  }
  tablist.hidden = visible.length < 2;
  let current = '';

  function select(id, focus = false) {
    const target = visible.find((tab) => tab.dataset.tab === id) || visible[0];
    if (!target) return;
    current = target.dataset.tab;
    for (const tab of visible) {
      const active = tab === target;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(tab.dataset.tab);
      if (panel) panel.hidden = !active;
    }
    if (location.hash.slice(1) !== current)
      history.replaceState(null, '', `${location.search}#${current}`);
    if (focus) target.focus();
  }
  for (const tab of visible) {
    tab.addEventListener('click', () => select(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      const index = visible.indexOf(tab);
      const next = {
        ArrowRight: index + 1,
        ArrowLeft: index - 1,
        Home: 0,
        End: visible.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select(visible[(next + visible.length) % visible.length].dataset.tab, true);
    });
  }
  window.addEventListener('hashchange', () => select(location.hash.slice(1)));
  select(location.hash.slice(1));
  return { select, current: () => current };
}
