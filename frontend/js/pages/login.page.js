import '../utils/preferences.js';
import { signIn, getSession } from '../api/auth.api.js';
import { initSocialAuth } from '../utils/social-auth.js';
import { requestedDestination } from '../utils/auth-redirect.js';

const form = document.querySelector('.login-form');
import { showAuthToast } from '../utils/auth-toast.js';

const destination = requestedDestination;
initSocialAuth();

getSession().then((session) => {
  if (session) location.href = destination();
}).catch(() => {});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  try {
    button.disabled = true;
    showAuthToast('Entrando...', { type: 'info' });
    await signIn(form.email.value.trim(), form.senha.value);
    location.href = destination();
  } catch (error) {
    showAuthToast(error.message || 'Não foi possível entrar.', { type: 'error' });
  } finally {
    button.disabled = false;
  }
});
