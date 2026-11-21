// Início on narrow screens (3.5, Milestone 5): the margin notes (week, agenda, subjects, notes)
// become one compact panel with tabs instead of a long stack at the end of the page. On wide
// screens nothing changes. Blocks hidden by a feature flag or by "Personalizar" get no tab.

const NAMES = { week: 'Semana', agenda: 'Agenda', subjects: 'Disciplinas', notes: 'Anotações' };
const NARROW = '(max-width: 700px)';

export function initRailTabs(doc = document) {
  const rail = doc.querySelector('.dash-rail');
  if (!rail || typeof matchMedia !== 'function') return null;
  const media = matchMedia(NARROW);
  const list = doc.createElement('div');
  list.className = 'dash-rail-tabs';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Semana, agenda e disciplinas');
  list.hidden = true;
  rail.before(list);
  let active = null;

  const sections = () =>
    [...rail.querySelectorAll(':scope > .dash-card[data-widget]')].filter(
      (section) => !section.hidden && !section.hasAttribute('data-user-hidden'),
    );

  function select(widget, focus = false) {
    active = widget;
    for (const section of rail.querySelectorAll(':scope > .dash-card[data-widget]')) {
      const on = section.dataset.widget === widget;
      if (on) section.dataset.tabActive = '';
      else delete section.dataset.tabActive;
    }
    for (const tab of list.querySelectorAll('[role="tab"]')) {
      const on = tab.dataset.tab === widget;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    }
  }

  function build() {
    const narrow = media.matches;
    const visible = sections();
    list.replaceChildren();
    list.hidden = !narrow || visible.length < 2;
    rail.toggleAttribute('data-tabbed', !list.hidden);
    for (const section of rail.querySelectorAll(':scope > .dash-card[data-widget]')) {
      if (list.hidden) {
        section.removeAttribute('role');
        section.removeAttribute('aria-labelledby');
        delete section.dataset.tabActive;
        continue;
      }
    }
    if (list.hidden) return;
    for (const section of visible) {
      const widget = section.dataset.widget;
      section.id ||= `dash-rail-${widget}`;
      const tab = doc.createElement('button');
      tab.type = 'button';
      tab.id = `dash-rail-tab-${widget}`;
      tab.className = 'dash-rail-tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', section.id);
      tab.dataset.tab = widget;
      tab.textContent = NAMES[widget] || section.querySelector('h2')?.textContent.trim() || widget;
      section.setAttribute('role', 'tabpanel');
      section.setAttribute('aria-labelledby', tab.id);
      list.append(tab);
    }
    select(visible.some((s) => s.dataset.widget === active) ? active : visible[0].dataset.widget);
  }

  list.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) select(tab.dataset.tab);
  });
  list.addEventListener('keydown', (event) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const index = tabs.findIndex((tab) => tab.dataset.tab === active);
    const move = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index }[event.key];
    if (move === undefined || !tabs.length) return;
    event.preventDefault();
    select(tabs[(index + move + tabs.length) % tabs.length].dataset.tab, true);
  });
  media.addEventListener('change', build);
  // Widgets appear when their data arrives (or are hidden by "Personalizar").
  new MutationObserver(() => queueMicrotask(build)).observe(rail, {
    subtree: false,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'data-user-hidden'],
  });
  for (const section of rail.querySelectorAll(':scope > .dash-card'))
    new MutationObserver(() => queueMicrotask(build)).observe(section, { attributes: true, attributeFilter: ['hidden', 'data-user-hidden'] });
  build();
  return { rebuild: build };
}
