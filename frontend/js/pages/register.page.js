import '../utils/preferences.js';
import { signUp } from '../api/auth.api.js';
import { initSocialAuth } from '../utils/social-auth.js';
initSocialAuth();

const form = document.querySelector('.login-form');
import { showAuthToast } from '../utils/auth-toast.js';

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const password = form.senha.value;
  const confirmation = form.confirmacao.value;
  if (password !== confirmation) {
    showAuthToast('As senhas não coincidem.', { type: 'error' });
    return;
  }
  try {
    button.disabled = true;
    showAuthToast('Criando conta...', { type: 'info' });
    const data = await signUp(form.email.value.trim(), password);
    if (data.session) {
      location.href = './painel.html';
    } else {
      showAuthToast('Solicitação recebida. Se o cadastro for possível, enviaremos um e-mail de confirmação. Se você já tem conta, tente entrar ou use “Esqueci minha senha”.', { type: 'success', duration: 12000 });
    }
  } catch (error) {
    showAuthToast(error.message || 'Não foi possível criar a conta.', { type: 'error' });
  } finally {
    button.disabled = false;
  }
});
