import '../utils/preferences.js';
import { signIn, getSession } from '../api/auth.api.js';
import { initSocialAuth } from '../utils/social-auth.js';
import { requestedDestination } from '../utils/auth-redirect.js';
import { releaseAccountPreferences, applyCachedAccountPreferences } from '../utils/preference-cloud.js';

const form = document.querySelector('.login-form');
import { showAuthToast } from '../utils/auth-toast.js';

const destination = requestedDestination;
initSocialAuth();

getSession().then((session) => {
  if (session) location.href = destination();
  // Nobody is signed in: the previous account's look and language leave with it.
  else releaseAccountPreferences();
}).catch(() => {});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  try {
    button.disabled = true;
    showAuthToast('Entrando...', { type: 'info' });
    const signedIn = await signIn(form.email.value.trim(), form.senha.value);
    applyCachedAccountPreferences(signedIn?.user?.id);
    location.href = destination();
  } catch (error) {
    showAuthToast(error.message || 'Não foi possível entrar.', { type: 'error' });
  } finally {
    button.disabled = false;
  }
});
