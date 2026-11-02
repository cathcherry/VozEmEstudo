import { signInWithProvider } from '../api/auth.api.js';
import { showAuthToast } from './auth-toast.js';
import { getPublicConfig } from '../api/config.js';
import { requestedDestination } from './auth-redirect.js';
export function initSocialAuth() {
  const buttons = [...document.querySelectorAll('[data-oauth-provider]')];

  getPublicConfig().then((config) => {
    if (Array.isArray(config.oauthProviders)) buttons.forEach((b) => { b.hidden = !config.oauthProviders.includes(b.dataset.oauthProvider); });
    const group = document.querySelector('.social-auth');
    if (group && buttons.every((b) => b.hidden)) { group.hidden = true; document.querySelector('.auth-divider').hidden = true; }
  }).catch(() => {});
  buttons.forEach((button) => button.addEventListener('click', async () => {
    buttons.forEach((b) => { b.disabled = true; });
    showAuthToast('Abrindo seu provedor de acesso…', { type: 'info' });
    try { await signInWithProvider(button.dataset.oauthProvider, requestedDestination()); }
    catch (error) {
      showAuthToast(/provider|disabled|not enabled|unsupported/i.test(error.message) ? 'Este provedor ainda não está disponível. Entre com e-mail e senha.' : error.message || 'Não foi possível iniciar o login. Tente novamente.', { type: 'error' });
      buttons.forEach((b) => { b.disabled = false; });
    }
  }));
}
