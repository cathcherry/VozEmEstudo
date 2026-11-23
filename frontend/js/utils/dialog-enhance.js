// One behaviour for every modal dialog of the app (3.7 review), applied when a <dialog> opens with
// showModal(), whoever built it:
// - a visible close button (×) in the title bar when the dialog has none of its own;
// - Esc closes (native), the × closes, and a click on the backdrop closes when it is safe:
//   never while an operation runs (aria-busy="true") or after the person typed something
//   (the dialog has unsaved input), and never for dialogs marked data-light-dismiss="off".
//   Esc and × are deliberate and close as before (dialogs with drafts guard them themselves).
// Dialogs that already handle `cancel` themselves keep doing so: we only ever dispatch the same
// cancelable `cancel` event the browser sends for Esc, then close if nobody prevented it.
import { t } from '../i18n/i18n.js';

const CLOSE_SELECTOR =
  '[data-dialog-close], .dialog-close, [class$="-dialog-close"], [data-customize-done].dialog-close';
const enhanced = new WeakSet();
const dirty = new WeakSet();

function label(key, fallback) {
  const text = t(key);
  return text && text !== key ? text : fallback;
}

function hasUnsavedInput(dialog) {
  return dirty.has(dialog) && dialog.dataset.unsavedGuard !== 'off';
}

/** Same path as Esc: a cancelable `cancel`, then close unless a handler prevented it. */
export function requestDialogClose(dialog) {
  if (!dialog?.open) return;
  if (dialog.getAttribute('aria-busy') === 'true') return;
  const event = new Event('cancel', { cancelable: true });
  dialog.dispatchEvent(event);
  if (!event.defaultPrevented && dialog.open) dialog.close();
}

/** A close control of the dialog's own: a known class, a *-close data attribute or a "Fechar" label. */
function hasOwnClose(dialog) {
  if (dialog.querySelector(CLOSE_SELECTOR)) return true;
  return [...dialog.querySelectorAll('button')].some((button) => {
    if (/(^|[\s-])close(\s|$)/.test(button.className)) return true;
    if ([...button.attributes].some((attr) => /^data-[\w-]*close$/.test(attr.name))) return true;
    const name = (button.getAttribute('aria-label') || button.textContent || '').trim();
    return /^(fechar|close|cerrar|关闭)$/i.test(name);
  });
}

function addCloseButton(dialog) {
  if (hasOwnClose(dialog)) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dialog-close';
  button.dataset.dialogClose = 'auto';
  button.setAttribute('aria-label', label('common.close', 'Fechar'));
  button.textContent = '×';
  dialog.prepend(button);
}

function enhance(dialog) {
  if (enhanced.has(dialog)) return;
  enhanced.add(dialog);
  // Typing marks the dialog as having unsaved input until it closes or a form inside is submitted.
  dialog.addEventListener('input', (event) => {
    if (event.target?.closest?.('[data-no-unsaved]')) return;
    if (event.target?.matches?.('input[type="search"], input[type="checkbox"], input[type="radio"], select')) return;
    dirty.add(dialog);
  });
  dialog.addEventListener('submit', () => dirty.delete(dialog), true);
  dialog.addEventListener('close', () => dirty.delete(dialog));
  dialog.addEventListener('click', (event) => {
    const closer = event.target.closest?.('[data-dialog-close="auto"], [data-dialog-cancel]');
    if (closer && dialog.contains(closer)) requestDialogClose(dialog);
  });
  // Backdrop: the press and the release both on the dialog element itself, outside its box.
  let downOnBackdrop = false;
  const outside = (event) => {
    if (event.target !== dialog) return false;
    const box = dialog.getBoundingClientRect();
    return (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    );
  };
  dialog.addEventListener('pointerdown', (event) => {
    downOnBackdrop = outside(event);
  });
  dialog.addEventListener('pointerup', (event) => {
    const release = downOnBackdrop && outside(event);
    downOnBackdrop = false;
    if (!release || dialog.dataset.lightDismiss === 'off') return;
    if (hasUnsavedInput(dialog) || dialog.getAttribute('aria-busy') === 'true') return;
    requestDialogClose(dialog);
  });
}

export function prepareDialog(dialog) {
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (dialog.dataset.enhance === 'off') return;
  addCloseButton(dialog);
  enhance(dialog);
}

// Patch showModal once per page so dialogs built anywhere get the same behaviour.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.__vozEnhanced) {
  const original = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function showModal(...args) {
    try {
      prepareDialog(this);
    } catch {
      // Enhancement is optional; the dialog still opens.
    }
    return original.apply(this, args);
  };
  Object.defineProperty(HTMLDialogElement.prototype, '__vozEnhanced', { value: true });
}
