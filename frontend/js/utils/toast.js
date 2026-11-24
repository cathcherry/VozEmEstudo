/** Brief, non-blocking notifications for the app pages. One toast at a time. */
let node;
let timer;

function ensure() {
  if (node?.isConnected) return node;
  node = document.createElement('div');
  node.className = 'app-toast';
  node.hidden = true;
  node.innerHTML = `<span class="app-toast__dot" aria-hidden="true"></span>
    <span class="app-toast__text"></span>
    <button class="app-toast__action" type="button" hidden></button>
    <button class="app-toast__close" type="button" aria-label="Fechar aviso">×</button>`;
  node.querySelector('.app-toast__close').addEventListener('click', dismissToast);
  document.body.append(node);
  return node;
}

export function dismissToast() {
  clearTimeout(timer);
  if (node) node.hidden = true;
}

/**
 * @param {string} text
 * @param {{ type?: 'info'|'success'|'error', duration?: number, action?: { label: string, onClick: () => void } }} [options]
 */
export function toast(text, { type = 'info', duration, action } = {}) {
  const element = ensure();
  // The same message is already on screen with an action (e.g. "Ver meus limites" added for a
  // program limit): keep that richer toast instead of replacing it with a plain copy.
  const current = element.querySelector('.app-toast__action');
  if (!action && !element.hidden && !current.hidden && element.querySelector('.app-toast__text').textContent === text) {
    clearTimeout(timer);
    const keep = duration ?? (type === 'error' ? 9000 : 5000);
    if (keep > 0) timer = setTimeout(dismissToast, keep);
    return element;
  }
  clearTimeout(timer);
  element.dataset.type = type;
  element.setAttribute('role', type === 'error' ? 'alert' : 'status');
  element.querySelector('.app-toast__text').textContent = text;
  const button = element.querySelector('.app-toast__action');
  button.hidden = !action;
  button.textContent = action?.label || '';
  button.onclick = action
    ? () => {
        dismissToast();
        action.onClick();
      }
    : null;
  element.hidden = false;
  const timeout = duration ?? (type === 'error' ? 9000 : 5000);
  if (timeout > 0) timer = setTimeout(dismissToast, timeout);
  return element;
}
