import { requireSession, signOut } from '../api/auth.api.js';
import { getAvatar } from './avatars.js';
import { setStudyUser } from './study-store.js';
import { initStudySync } from './study-sync.js';
import { readProfileMedia } from './profile-storage.js';
import { initProfileStudySync } from './profile-study-sync.js';
import { initPreferenceCloud } from './preference-cloud.js';
import { getFeatureFlags } from './feature-flags.js';
import { t } from '../i18n/i18n.js';

/** Shows Revisar/Planejar in the navigation when at least one of their tools is enabled. */
export async function revealStudyNavigation() {
  try {
    const flags = await getFeatureFlags();
    const root = document.documentElement;
    root.dataset.navReview = String(Boolean(flags.flashcards || flags.annotations || flags.quiz_v2));
    root.dataset.navPlan = String(Boolean(flags.planning || flags.calendar || flags.study_tracking));
  } catch { /* Navigation keeps the always-available pages. */ }
}

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
  setupAccountMenus(session.user);
  void revealStudyNavigation();
  document.querySelectorAll('.sidebar-settings a[href="./aparencia.html"]').forEach((link) => {
    link.href = './configuracoes.html';
    const label = link.querySelector('span');
    if (label) label.textContent = t('nav.settings');
  });
  setStudyUser(session.user.id);
  // Preferences first: they affect what the user sees, and the sync must track local changes
  // from the earliest point. Study syncs run meanwhile.
  window.VozAppearance?.setUser(session.user.id);
  const preferenceSync = initPreferenceCloud(session.user.id).catch(() => { /* Local preferences remain usable. */ });
  try { await initProfileStudySync(session.user.id); } catch { /* Keep local history available. */ }
  try { await initStudySync(session.user.id); } catch { /* Optional sync must never block access. */ }
  await preferenceSync;
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

let cachedProfileAvatarUrl = null;
export function updateUserIdentity(user) {
  const avatar = getAvatar(user?.user_metadata?.mascot_avatar);
  const render = (src) => document.querySelectorAll('.user-initials').forEach((el) => { const img = document.createElement('img'); img.src = src; img.alt = ''; img.width = 36; img.height = 36; el.replaceChildren(img); });
  render(avatar.src);
  if (!user?.id) return;
  readProfileMedia(user.id, 'avatar').then((blob) => {
    if (!blob) return;
    if (cachedProfileAvatarUrl) URL.revokeObjectURL(cachedProfileAvatarUrl);
    cachedProfileAvatarUrl = URL.createObjectURL(blob);
    render(cachedProfileAvatarUrl);
  }).catch(() => {});
}

function setupAccountMenus(user) {
  const displayName = user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.user_metadata?.name || t('nav.myAccount');
  document.querySelectorAll('.account-link').forEach((oldLink, index) => {
    if (oldLink.dataset.accountMenuReady) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'account-menu-wrap';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'account-link account-menu-trigger';
    trigger.setAttribute('aria-label', t('account.openMenu', { name: displayName }));
    trigger.setAttribute('aria-expanded', 'false');
    const menuId = `account-menu-${index + 1}`;
    trigger.setAttribute('aria-controls', menuId);
    const avatar = oldLink.querySelector('.user-initials');
    if (avatar) trigger.append(avatar.cloneNode(true));
    const menu = document.createElement('div');
    menu.className = 'account-menu';
    menu.id = menuId;
    menu.hidden = true;
    const identity = document.createElement('div');
    identity.className = 'account-menu-identity';
    const name = document.createElement('strong');
    name.textContent = displayName;
    const email = document.createElement('span');
    email.textContent = user?.email || '';
    identity.append(name, email);
    const profile = document.createElement('a');
    profile.href = './conta.html';
    profile.textContent = t('account.profile');
    const settings = document.createElement('a');
    settings.href = './configuracoes.html';
    settings.textContent = t('nav.settings');
    const divider = document.createElement('hr');
    const logout = document.createElement('button');
    logout.type = 'button';
    logout.dataset.logout = '';
    logout.textContent = t('account.logout');
    const message = document.createElement('span');
    message.className = 'account-menu-status';
    message.dataset.logoutMessage = '';
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    menu.append(identity, profile, settings, divider, logout, message);
    wrapper.append(trigger, menu);
    oldLink.replaceWith(wrapper);
    const close = (restoreFocus = false) => {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger.focus();
    };
    trigger.addEventListener('click', () => {
      const open = menu.hidden;
      menu.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      if (open) menu.querySelector('a')?.focus();
    });
    menu.addEventListener('click', (event) => {
      if (event.target.closest('a')) close();
    });
    document.addEventListener('click', (event) => {
      if (!wrapper.contains(event.target)) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault();
        close(true);
      }
    });
  });
}

export function setStatus(element, message, state = '') {
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}
