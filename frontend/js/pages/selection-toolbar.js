import { icon as uiIcon } from '../utils/icons.js';
// Floating toolbar over a text selection in the lesson transcript (3.5, Milestone 8).
//
// It appears next to the selection (above it, or below when there is no room or when the
// selection came from touch, where the system's own menu sits above) and never covers it. It is a
// real toolbar: Shift+F10 or the context-menu key opens it from the selection and moves focus to
// its first action; arrows, Home and End move between actions; Escape closes it and returns focus.
// For keyboard users who do not know the shortcut there is a fallback button right before the
// text ("Ações do trecho selecionado"), shown only while there is a usable selection.
//
// The toolbar knows nothing about annotations: the caller resolves the selection into an anchor
// and supplies the actions (Destacar, Anotar, Investigar…).

const GAP = 10;
const EDGE = 8;

// Shared icon sprite (frontend/js/utils/icons.js, Phosphor duotone).
const ICONS = { highlight: 'highlight', note: 'note', investigate: 'investigation' };

function svgIcon(name) {
  const span = document.createElement('span');
  span.className = 'selection-toolbar-icon';
  span.setAttribute('aria-hidden', 'true');
  span.append(uiIcon(ICONS[name] || 'note', { size: 18 }));
  return span;
}

/**
 * Picks where the toolbar goes for a selection rectangle: above when it fits (and the selection
 * was not made by touch), otherwise below; when neither fits (a selection taller than the
 * window), it docks at the bottom of the window. Pure, so it can be tested without a browser.
 * @returns {{left:number, top:number, side:'above'|'below'|'docked'}}
 */
export function placeToolbar(selection, toolbar, viewport, { preferBelow = false, topInset = 0 } = {}) {
  const left = Math.max(EDGE, Math.min(viewport.width - toolbar.width - EDGE, selection.left + selection.width / 2 - toolbar.width / 2));
  const aboveTop = selection.top - toolbar.height - GAP;
  const belowTop = selection.bottom + GAP;
  const fitsAbove = aboveTop >= EDGE + topInset;
  const fitsBelow = belowTop + toolbar.height <= viewport.height - EDGE;
  const order = preferBelow ? ['below', 'above'] : ['above', 'below'];
  for (const side of order) {
    if (side === 'above' && fitsAbove) return { left, top: aboveTop, side };
    if (side === 'below' && fitsBelow) return { left, top: belowTop, side };
  }
  return { left: (viewport.width - toolbar.width) / 2, top: viewport.height - toolbar.height - EDGE * 2, side: 'docked' };
}

/**
 * @param {object} options
 * @param {HTMLElement} options.container   where the text is selected
 * @param {() => boolean} options.isActive   whether selections count right now (reading mode)
 * @param {() => {error?: string, quote?: string}} options.resolve  the current selection's anchor
 * @param {(error: string) => string} options.errorText  why a selection cannot be used
 * @param {Array<{id: string, label: string, icon?: string, available?: () => boolean,
 *   href?: (result: object) => string, run?: (result: object) => void}>} options.actions
 */
export function createSelectionToolbar({ container, isActive, resolve, errorText, actions }) {
  const toolbar = document.createElement('div');
  toolbar.className = 'selection-popover selection-toolbar';
  toolbar.hidden = true;
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Ações do trecho selecionado');
  toolbar.setAttribute('aria-orientation', 'horizontal');
  toolbar.setAttribute('aria-keyshortcuts', 'Shift+F10');
  const items = actions.map((action) => {
    const node = document.createElement(action.href ? 'a' : 'button');
    if (!action.href) node.type = 'button';
    node.className = 'selection-toolbar-action';
    node.dataset.action = action.id;
    node.append(svgIcon(action.icon || action.id), Object.assign(document.createElement('span'), { textContent: action.label }));
    toolbar.append(node);
    return { action, node };
  });
  const note = document.createElement('span');
  note.className = 'selection-popover-note';
  note.hidden = true;
  toolbar.append(note);
  document.body.append(toolbar);

  // The fallback for keyboard users: right before the text, only while a selection is usable.
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'selection-toolbar-trigger text-action';
  trigger.hidden = true;
  trigger.textContent = 'Ações do trecho selecionado';
  trigger.setAttribute('aria-keyshortcuts', 'Shift+F10');
  container.before(trigger);

  let pending = null;
  let returnFocus = null;
  let lastPointer = 'mouse';

  const visibleItems = () => items.filter(({ node }) => !node.hidden).map(({ node }) => node);

  function hide({ restoreFocus = false } = {}) {
    const wasFocused = toolbar.contains(document.activeElement);
    toolbar.hidden = true;
    pending = null;
    if (restoreFocus && wasFocused) (returnFocus?.isConnected ? returnFocus : trigger.hidden ? container : trigger).focus?.();
    returnFocus = null;
  }

  function currentRect() {
    const selection = globalThis.getSelection?.();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const rects = [...range.getClientRects()].filter((r) => r.width || r.height);
    if (!rects.length) return range.getBoundingClientRect();
    // The first and last lines matter: place against the line the toolbar sits next to.
    const box = range.getBoundingClientRect();
    return { left: box.left, width: box.width, top: rects[0].top, bottom: rects.at(-1).bottom };
  }

  function selectionInside() {
    const selection = globalThis.getSelection?.();
    if (!selection?.rangeCount || selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    return container.contains(range.commonAncestorContainer);
  }

  /** Shows the toolbar for the current selection; returns whether it is shown. */
  function show() {
    if (!isActive() || !selectionInside()) {
      trigger.hidden = true;
      hide();
      return false;
    }
    const result = resolve();
    if (result.error === 'empty') {
      trigger.hidden = true;
      hide();
      return false;
    }
    pending = result.error ? null : result;
    for (const { action, node } of items) {
      node.hidden = Boolean(result.error) || (action.available ? !action.available() : false);
      if (!node.hidden && action.href) node.href = action.href(result);
    }
    note.textContent = result.error ? errorText(result.error) : '';
    note.hidden = !result.error;
    trigger.hidden = Boolean(result.error);
    toolbar.hidden = false;
    const rect = currentRect();
    if (!rect) return true;
    const topbar = document.querySelector('.app-topbar');
    const topInset = topbar ? Math.max(0, topbar.getBoundingClientRect().bottom) : 0;
    const place = placeToolbar(
      rect,
      { width: toolbar.offsetWidth || 220, height: toolbar.offsetHeight || 44 },
      { width: document.documentElement.clientWidth || innerWidth, height: innerHeight },
      { preferBelow: lastPointer === 'touch', topInset },
    );
    toolbar.dataset.side = place.side;
    toolbar.style.left = `${Math.round(place.left)}px`;
    toolbar.style.top = `${Math.round(place.top)}px`;
    // The little caret points at the middle of the selection.
    const caret = Math.max(16, Math.min((toolbar.offsetWidth || 220) - 16, rect.left + rect.width / 2 - place.left));
    toolbar.style.setProperty('--caret-x', `${Math.round(caret)}px`);
    return true;
  }

  function openWithKeyboard() {
    returnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    if (!show() || !pending) return false;
    const first = visibleItems()[0];
    for (const node of visibleItems()) node.tabIndex = node === first ? 0 : -1;
    first?.focus();
    return true;
  }

  // Pointer and keyboard selections inside the text.
  container.addEventListener('pointerdown', (event) => (lastPointer = event.pointerType || 'mouse'));
  container.addEventListener('mouseup', () => setTimeout(show, 0));
  container.addEventListener('touchend', () => setTimeout(show, 350), { passive: true });
  container.addEventListener('keyup', (event) => {
    if (event.shiftKey && event.key !== 'F10') show();
  });
  // Touch selections are adjusted with handles after touchend: follow them while they change.
  let settle = 0;
  document.addEventListener('selectionchange', () => {
    if (lastPointer !== 'touch' && toolbar.hidden) {
      // Keyboard and mouse: only keep the fallback button in step with the selection.
      trigger.hidden = !(isActive() && selectionInside());
      return;
    }
    clearTimeout(settle);
    settle = setTimeout(() => {
      if (toolbar.contains(document.activeElement)) return;
      if (selectionInside()) show();
      else if (!toolbar.hidden) hide();
    }, 180);
  });
  document.addEventListener('keydown', (event) => {
    const shortcut = (event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu';
    if (shortcut && selectionInside() && isActive()) {
      if (openWithKeyboard()) event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && !toolbar.hidden) hide({ restoreFocus: true });
  });
  trigger.addEventListener('click', () => {
    if (!openWithKeyboard()) trigger.hidden = true;
  });
  toolbar.addEventListener('keydown', (event) => {
    const list = visibleItems();
    const index = list.indexOf(document.activeElement);
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = list[(index + 1) % list.length];
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = list[(index - 1 + list.length) % list.length];
    else if (event.key === 'Home') next = list[0];
    else if (event.key === 'End') next = list.at(-1);
    else if (event.key === 'Tab') hide();
    if (!next) return;
    event.preventDefault();
    for (const node of list) node.tabIndex = node === next ? 0 : -1;
    next.focus();
  });
  document.addEventListener('mousedown', (event) => {
    if (!toolbar.contains(event.target) && event.target !== trigger) hide();
  });
  globalThis.addEventListener?.('scroll', () => {
    if (!toolbar.hidden && !toolbar.contains(document.activeElement)) hide();
  }, { passive: true });
  globalThis.addEventListener?.('resize', () => !toolbar.hidden && show());

  for (const { action, node } of items) {
    node.addEventListener('click', (event) => {
      const result = pending;
      if (!result) {
        event.preventDefault();
        return hide();
      }
      if (action.run) {
        event.preventDefault();
        hide();
        trigger.hidden = true;
        action.run(result);
      }
      // Links (Investigar) simply navigate with the selection in the address.
    });
  }

  return { element: toolbar, trigger, show, hide, openWithKeyboard };
}
