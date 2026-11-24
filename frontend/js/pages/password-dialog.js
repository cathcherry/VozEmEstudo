// Configurações › Trocar senha. Two ways, both already supported by Supabase Auth:
//  - "Definir uma nova senha agora" (accounts that have a password): the current password is
//    checked by signing in again, then auth.updateUser sets the new one;
//  - "Receber um link por e-mail": the same reset link as "Esqueci minha senha"
//    (recuperar-senha.html), also the way for accounts that only use Google or GitHub.
// Each path has visible states: working (button disabled, dialog aria-busy), error (inline,
// focus back on the field) and done (a confirmation that replaces the form).
import { requestPasswordReset, signIn, updatePassword } from '../api/auth.api.js';
import {
  attachPasswordRules,
  passwordProblem,
  translatePasswordError,
} from '../utils/password-policy.js';

/** Access methods of the account ('email', 'google', 'github'…); e-mail when nothing says. */
export function accessMethods(user) {
  const methods = [
    ...new Set((user?.identities || []).map(({ provider }) => provider).filter(Boolean)),
  ];
  if (!methods.length && user?.app_metadata?.provider) methods.push(user.app_metadata.provider);
  return methods.length ? methods : ['email'];
}

/** Portuguese message for an Auth error of these two flows. */
export function passwordErrorMessage(error, flow) {
  const text = `${error?.code || ''} ${error?.message || ''}`;
  if (/rate|security purposes|too many|429/i.test(text) || error?.status === 429)
    return 'Muitos pedidos seguidos. Aguarde um minuto e tente de novo.';
  if (flow === 'update') {
    if (/same_password|different from the old/i.test(text))
      return 'A nova senha precisa ser diferente da atual.';
    if (/reauthenticat/i.test(text))
      return 'Por segurança, use a opção de receber um link por e-mail.';
    const weak = translatePasswordError(error);
    if (weak) return weak;
  }
  if (/fetch|network|failed to/i.test(text))
    return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  return flow === 'link'
    ? 'Não foi possível enviar o link agora. Tente de novo em instantes.'
    : 'Não foi possível trocar a senha agora. Tente de novo em instantes.';
}

export function initPasswordDialog({ user }) {
  const dialog = document.querySelector('[data-password-dialog]');
  if (!dialog) return { open() {} };
  const choose = dialog.querySelector('[data-password-step="choose"]');
  const done = dialog.querySelector('[data-password-step="done"]');
  const doneTitle = done.querySelector('[data-password-done-title]');
  const doneText = done.querySelector('[data-password-done-text]');
  const form = dialog.querySelector('[data-password-update-form]');
  const formStatus = form.querySelector('[data-password-update-status]');
  const submit = form.querySelector('[type="submit"]');
  const sendLink = dialog.querySelector('[data-password-send-link]');
  const linkStatus = dialog.querySelector('[data-password-link-status]');
  const hasPassword = accessMethods(user).includes('email');
  let opener = null;
  let busy = false;

  dialog.querySelector('[data-password-email]').textContent = user.email || '';
  // Google/GitHub-only accounts have no current password: the link creates one.
  form.hidden = !hasPassword;
  dialog.querySelector('[data-password-divider]').hidden = !hasPassword;
  if (!hasPassword)
    dialog.querySelector('[data-password-link-text]').textContent =
      'Você entra com Google ou GitHub. Para também entrar com e-mail e senha, receba um link e crie uma senha. O link chega em:';
  attachPasswordRules(form.senha);

  const setStatus = (node, text, state = '') => {
    node.textContent = text;
    node.dataset.state = state;
    node.setAttribute('role', state === 'error' ? 'alert' : 'status');
  };
  const setBusy = (value) => {
    busy = value;
    dialog.setAttribute('aria-busy', String(value));
    submit.disabled = value;
    sendLink.disabled = value;
  };
  function reset() {
    form.reset();
    dialog
      .querySelectorAll('.password-rules [data-ok]')
      .forEach((item) => (item.dataset.ok = 'false'));
    setStatus(formStatus, '');
    setStatus(linkStatus, '');
    for (const input of form.querySelectorAll('input')) input.removeAttribute('aria-invalid');
    choose.hidden = false;
    done.hidden = true;
    submit.textContent = 'Salvar nova senha';
    sendLink.textContent = 'Enviar link';
    setBusy(false);
  }
  function finish(title, text) {
    choose.hidden = true;
    done.hidden = false;
    doneTitle.textContent = title;
    doneText.textContent = text;
    doneTitle.focus();
  }
  function invalid(input, message) {
    setStatus(formStatus, message, 'error');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    for (const input of form.querySelectorAll('input')) input.removeAttribute('aria-invalid');
    if (!form.atual.value) return invalid(form.atual, 'Digite a senha atual.');
    if (form.senha.value !== form.confirmacao.value)
      return invalid(form.confirmacao, 'As duas senhas novas não são iguais.');
    setBusy(true);
    submit.textContent = 'Conferindo…';
    setStatus(formStatus, 'Conferindo a nova senha…');
    try {
      const problem = await passwordProblem(form.senha.value);
      if (problem) return invalid(form.senha, problem);
      try {
        await signIn(user.email, form.atual.value);
      } catch {
        return invalid(form.atual, 'A senha atual não confere.');
      }
      submit.textContent = 'Salvando…';
      setStatus(formStatus, 'Salvando a nova senha…');
      await updatePassword(form.senha.value);
      form.reset();
      finish(
        'Senha alterada',
        'Use a nova senha na próxima vez que entrar. Você continua conectado neste navegador.',
      );
    } catch (error) {
      setStatus(formStatus, passwordErrorMessage(error, 'update'), 'error');
    } finally {
      submit.textContent = 'Salvar nova senha';
      setBusy(false);
    }
  });

  sendLink.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    sendLink.textContent = 'Enviando…';
    setStatus(linkStatus, 'Enviando o link…');
    try {
      await requestPasswordReset(user.email);
      finish(
        'Link enviado',
        `Abra o e-mail enviado para ${user.email} neste navegador e escolha a nova senha. Se não chegar em alguns minutos, confira o spam.`,
      );
    } catch (error) {
      setStatus(linkStatus, passwordErrorMessage(error, 'link'), 'error');
      sendLink.focus();
    } finally {
      sendLink.textContent = 'Enviar link';
      setBusy(false);
    }
  });

  // Never close while a request runs (Esc included); always come back clean.
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    reset();
    opener?.focus();
  });
  dialog.querySelectorAll('[data-password-close]').forEach((button) =>
    button.addEventListener('click', () => {
      if (!busy) dialog.close();
    }),
  );

  return {
    open(trigger) {
      opener = trigger || null;
      reset();
      dialog.showModal();
      (hasPassword ? form.atual : sendLink).focus();
    },
  };
}
