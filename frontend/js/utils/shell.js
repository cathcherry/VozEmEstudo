import { requireSession, signOut } from '../api/auth.api.js';
import { getAvatar } from './avatars.js';
import { setStudyUser } from './study-store.js';
import { initStudySync } from './study-sync.js';

export async function initAuthenticatedShell() {
  let session;
  try { session = await requireSession(); }
  catch (error) {
    if (error.message !== 'AUTH_REQUIRED') {
      const banner = document.createElement('section'); banner.className = 'app-error'; banner.setAttribute('role', 'alert');
      const title = document.createElement('strong'); title.textContent = 'Não foi possível carregar seu acesso.';
      const message = document.createElement('p'); message.textContent = error.message;
      const retry = document.createElement('button'); retry.className = 'secondary-action'; retry.textContent = 'Tentar novamente'; retry.addEventListener('click', () => location.reload());
      banner.append(title, message, retry); document.querySelector('main')?.prepend(banner);
      document.querySelectorAll('[aria-busy="true"]').forEach((node) => { node.setAttribute('aria-busy', 'false'); node.textContent = 'Os materiais estarão disponíveis quando o acesso for restabelecido.'; });
    }
    throw error;
  }
  updateUserIdentity(session.user);
  setStudyUser(session.user.id);
  try { await initStudySync(session.user.id); } catch { /* Optional sync must never block access. */ }
  window.VozAppearance?.setUser(session.user.id);
  document.querySelectorAll('[data-logout]').forEach((el) => {
    el.addEventListener('click', async (event) => {
      event.preventDefault();
      el.disabled = true;
      try { await signOut(); location.href = './login.html'; }
      catch (error) { const message = document.querySelector('[data-logout-message]'); if (message) { message.textContent = error.message || 'Não foi possível sair. Tente novamente.'; message.dataset.state = 'error'; } el.disabled = false; }
    });
  });
  return session;
}

export function updateUserIdentity(user) {
  const avatar = getAvatar(user?.user_metadata?.mascot_avatar);
  document.querySelectorAll('.user-initials').forEach((el) => { const img = document.createElement('img'); img.src = avatar.src; img.alt = ''; img.width = 36; img.height = 36; el.replaceChildren(img); });
}

export function setStatus(element, message, state = '') {
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}
