import '../utils/preferences.js';
import { getSupabase } from '../api/supabase-browser.js';
import { requestPasswordReset, updatePassword } from '../api/auth.api.js';
import { attachPasswordRules, passwordProblem, translatePasswordError } from '../utils/password-policy.js';

const requestForm = document.querySelector('[data-recovery-request]');
const updateForm = document.querySelector('[data-recovery-update]');
attachPasswordRules(updateForm?.senha);
import { showAuthToast } from '../utils/auth-toast.js';
const description = document.querySelector('[data-recovery-description]');
const params = new URLSearchParams(location.search);
const code = params.get('code');
const hash = new URLSearchParams(location.hash.slice(1));

async function initRecovery() {
  if (params.has('error') || hash.has('error')) {
    showAuthToast('O link de recuperação não pôde ser utilizado. Solicite um novo e-mail.', { type: 'error' });
    return;
  }
  if (!code) return;

  requestForm.hidden = true;
  description.textContent = 'Validando seu link de recuperação...';
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data.user) throw (userError || new Error('Sessão não encontrada.'));
    history.replaceState(null, '', location.pathname);
    updateForm.hidden = false;
    description.textContent = 'Escolha uma nova senha para sua conta.';
  } catch {
    showAuthToast('O link expirou ou não pôde ser validado neste navegador. Solicite outro e abra-o no mesmo navegador em que fez o pedido.', { type: 'error' });
    description.textContent = 'Não foi possível confirmar o link.';
    requestForm.hidden = false;
  }
}
await initRecovery();

requestForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = requestForm.querySelector('button[type="submit"]');
  button.disabled = true;
  showAuthToast('Enviando solicitação...', { type: 'info' });
  try {
    await requestPasswordReset(requestForm.email.value.trim());
    showAuthToast('Se houver uma conta com este e-mail, você receberá instruções para recuperar a senha. Verifique também a caixa de spam.', { type: 'success', duration: 12000 });
  } catch (error) {
    showAuthToast(error.message || 'Não foi possível enviar o e-mail. Tente novamente mais tarde.', { type: 'error' });
  } finally {
    button.disabled = false;
  }
});

updateForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (updateForm.senha.value !== updateForm.confirmacao.value) {
    showAuthToast('As senhas não coincidem.', { type: 'error' });
    return;
  }
  const button = updateForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    showAuthToast('Conferindo a senha...', { type: 'info' });
    const problem = await passwordProblem(updateForm.senha.value);
    if (problem) {
      showAuthToast(problem, { type: 'error', duration: 10000 });
      updateForm.senha.focus();
      return;
    }
    showAuthToast('Atualizando senha...', { type: 'info' });
    await updatePassword(updateForm.senha.value);
    const supabase = await getSupabase();
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      showAuthToast('Senha alterada. Por segurança, saia da conta e entre novamente.', { type: 'success', duration: 12000 });
      updateForm.hidden = true;
      description.textContent = 'Senha alterada com sucesso.';
      return;
    }
    updateForm.hidden = true;
    description.textContent = 'Senha alterada com sucesso. Volte ao login e entre com sua nova senha.';
    showAuthToast('Senha atualizada. Volte ao login e entre com sua nova senha.', { type: 'success' });
  } catch (error) {
    showAuthToast(translatePasswordError(error) || error.message || 'Não foi possível alterar a senha.', { type: 'error' });
  } finally {
    button.disabled = false;
  }
});
