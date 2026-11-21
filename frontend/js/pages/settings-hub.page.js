import '../utils/preferences.js';
import { initAuthenticatedShell, setStatus } from '../utils/shell.js';
import { requestPasswordReset } from '../api/auth.api.js';
import { initDeviceDataPanel } from './device-data-panel.js';

const { user } = await initAuthenticatedShell();
initDeviceDataPanel({ owner: user.id });
const email = document.querySelector('[data-settings-email]');
const created = document.querySelector('[data-settings-created]');
const providers = document.querySelector('[data-settings-providers]');
const resetEmail = document.querySelector('#settings-reset-email');
const resetForm = document.querySelector('[data-password-reset-form]');
const resetMessage = document.querySelector('[data-password-reset-message]');

email.textContent = user.email || 'Não informado';
resetEmail.value = user.email || '';
if (user.created_at) {
  const date = new Date(user.created_at);
  created.textContent = date.toLocaleDateString((globalThis.VOZ_LOCALE || 'pt-BR'));
}
const methods = [...new Set((user.identities || []).map(({ provider }) => provider).filter(Boolean))];
if (!methods.length && user.app_metadata?.provider) methods.push(user.app_metadata.provider);
providers.textContent = methods.length
  ? methods.map((provider) => ({ email: 'E-mail e senha', github: 'GitHub', google: 'Google' }[provider] || provider)).join(', ')
  : 'E-mail e senha';

resetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = resetForm.querySelector('[type="submit"]');
  button.disabled = true;
  setStatus(resetMessage, 'Enviando…');
  try {
    await requestPasswordReset(user.email);
    setStatus(resetMessage, 'Se esse endereço puder redefinir a senha, você receberá um link por e-mail.', 'success');
  } catch (error) {
    setStatus(resetMessage, error.message || 'Não foi possível enviar o link. Tente novamente.', 'error');
  } finally {
    button.disabled = false;
  }
});
