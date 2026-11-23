// "⋯" menus built as <details class="row-menu"> (Biblioteca, question lists…) or any
// <details data-floating-menu>: the options open in the top layer (popover), so no card,
// scrolling list or rounded container can cut them, and they open where there is room —
// below or above the button, aligned to its right or left edge, always inside the viewport.
// Click outside or Esc closes them (focus returns to the button); arrow keys move between options.
const MENU = 'details.row-menu, details[data-floating-menu]';
const CONTENT = ':scope > :is(.row-menu-content, [data-floating-menu-content])';
const GAP = 6;
const MARGIN = 8;
const supportsPopover = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

function contentOf(menu) {
  return menu.querySelector(CONTENT);
}

function place(menu) {
  const content = contentOf(menu);
  const summary = menu.querySelector(':scope > summary');
  if (!content || !summary || !menu.open) return;
  const anchor = summary.getBoundingClientRect();
  content.style.position = 'fixed';
  content.style.margin = '0';
  content.style.inset = 'auto';
  content.style.right = 'auto';
  content.style.bottom = 'auto';
  content.style.maxHeight = '';
  const width = content.offsetWidth;
  const height = content.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  // Horizontal: align the menu's right edge with the button's when it fits, else its left edge.
  let left = anchor.right - width;
  if (left < MARGIN) left = anchor.left;
  left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN));
  // Vertical: below when there is room, else above, else wherever there is more room (scrolls).
  const below = vh - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;
  let top;
  if (height <= below || below >= above) {
    top = anchor.bottom + GAP;
    if (height > below) content.style.maxHeight = `${Math.max(120, below)}px`;
    menu.dataset.menuSide = 'below';
  } else {
    const usable = Math.min(height, above);
    top = anchor.top - GAP - usable;
    if (height > above) content.style.maxHeight = `${Math.max(120, above)}px`;
    menu.dataset.menuSide = 'above';
  }
  content.style.left = `${Math.round(left)}px`;
  content.style.top = `${Math.round(Math.max(MARGIN, top))}px`;
}

function open(menu) {
  const content = contentOf(menu);
  if (!content) return;
  content.classList.add('floating-menu-content');
  if (supportsPopover) {
    content.popover = 'manual';
    try {
      if (!content.matches(':popover-open')) content.showPopover();
    } catch {
      // Not connected or already shown elsewhere: fixed positioning still applies.
    }
  }
  place(menu);
  requestAnimationFrame(() => place(menu));
}

function close(menu) {
  const content = contentOf(menu);
  if (!content) return;
  if (supportsPopover && content.matches?.(':popover-open')) content.hidePopover();
  for (const prop of ['position', 'left', 'top', 'inset', 'right', 'bottom', 'margin', 'maxHeight'])
    content.style[prop] = '';
}

function openMenus() {
  return document.querySelectorAll(`:is(${MENU})[open]`);
}

document.addEventListener(
  'toggle',
  (event) => {
    const menu = event.target;
    if (!(menu instanceof HTMLDetailsElement) || !menu.matches(MENU)) return;
    if (menu.open) {
      for (const other of openMenus()) if (other !== menu) other.open = false;
      open(menu);
    } else close(menu);
  },
  true,
);

document.addEventListener('click', (event) => {
  for (const menu of openMenus()) if (!menu.contains(event.target)) menu.open = false;
});

document.addEventListener('keydown', (event) => {
  const menu = event.target.closest?.(MENU);
  if (event.key === 'Escape') {
    for (const other of openMenus()) {
      other.open = false;
      other.querySelector(':scope > summary')?.focus();
    }
    return;
  }
  if (!menu?.open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [...(contentOf(menu)?.querySelectorAll(':scope > :is(button, a):not([disabled], [hidden])') || [])];
  if (!items.length) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? (index + 1) % items.length
          : (index - 1 + items.length) % items.length;
  items[next].focus();
});

const reposition = () => {
  for (const menu of openMenus()) place(menu);
};
window.addEventListener('resize', reposition);
window.addEventListener('scroll', reposition, true);
