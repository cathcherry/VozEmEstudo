/** Notificações temporárias de autenticação; sem bibliotecas externas. */
let toast;
let hideTimer;

function ensureToast() {
  if (toast?.isConnected) return toast;
  toast = document.createElement('div');
  toast.className = 'auth-toast';
  toast.hidden = true;
  toast.innerHTML = `<span class="auth-toast__symbol" aria-hidden="true"></span>
    <div class="auth-toast__content">
      <strong class="auth-toast__title"></strong>
      <span class="auth-toast__text"></span>
    </div>
    <button class="auth-toast__close" type="button" aria-label="Fechar notificação">×</button>`;
  toast.querySelector('.auth-toast__close').addEventListener('click', dismissAuthToast);
  document.body.append(toast);
  return toast;
}

export function dismissAuthToast() {
  clearTimeout(hideTimer);
  if (toast) toast.hidden = true;
}

/** "info" permanece visível durante a operação (duration=0); sucesso/erro expiram. */
export function showAuthToast(text, { type = 'info', duration } = {}) {
  const node = ensureToast();
  clearTimeout(hideTimer);
  node.hidden = false;
  node.dataset.type = type;
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  node.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  const title = type === 'error' ? 'Não foi possível concluir' : type === 'success' ? 'Tudo certo' : 'Aguarde';
  node.querySelector('.auth-toast__symbol').textContent = type === 'success' ? '✓' : type === 'error' ? '!' : '…';
  node.querySelector('.auth-toast__title').textContent = title;
  node.querySelector('.auth-toast__text').textContent = text;
  const timeout = duration ?? (type === 'info' ? 0 : type === 'error' ? 12000 : 10000);
  if (timeout > 0) hideTimer = setTimeout(dismissAuthToast, timeout);
  return node;
}
