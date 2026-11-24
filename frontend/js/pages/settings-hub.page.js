// Configurações: one direct list of grouped rows. Every row opens its page, its dialog or its
// action at once (no in-page jumps). "Dados neste navegador" is a sub-view of this page
// (#dados-neste-navegador) because the synchronization panel lives here.
import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { signOut } from '../api/auth.api.js';
import { releaseAccountPreferences } from '../utils/preference-cloud.js';
import { getSoundscape } from '../utils/soundscape-ui.js';
import { startTourFromAnywhere } from '../utils/guided-tour.js';
import { initDeviceDataPanel } from './device-data-panel.js';
import { initPasswordDialog, accessMethods } from './password-dialog.js';

const { user } = await initAuthenticatedShell();
initDeviceDataPanel({ owner: user.id });

// ---- Account ------------------------------------------------------------------------------
const metadata = user.user_metadata || {};
const name = metadata.display_name || metadata.full_name || metadata.name || '';
if (name) document.querySelector('[data-settings-name]').textContent = name;
document.querySelector('[data-settings-email]').textContent = user.email || 'E-mail não informado';
const created = document.querySelector('[data-settings-created]');
if (user.created_at)
  created.textContent = new Date(user.created_at).toLocaleDateString(
    globalThis.VOZ_LOCALE || 'pt-BR',
  );
else created.closest('li').hidden = true;
const methods = accessMethods(user);
document.querySelector('[data-settings-providers]').textContent = methods
  .map(
    (provider) =>
      ({ email: 'E-mail e senha', github: 'GitHub', google: 'Google' })[provider] || provider,
  )
  .join(', ');

// ---- Rows that run an action ---------------------------------------------------------------
const password = initPasswordDialog({ user });
document.querySelector('[data-open-password]')?.addEventListener('click', (event) => {
  password.open(event.currentTarget);
});
document.querySelector('[data-open-soundscape]')?.addEventListener('click', (event) => {
  const soundscape = getSoundscape();
  if (!soundscape) return;
  // The mixer closes on any click outside it: this one must not reach the document.
  event.stopPropagation();
  soundscape.open();
});
document
  .querySelector('[data-start-tour]')
  ?.addEventListener('click', () => startTourFromAnywhere());

const logout = document.querySelector('[data-settings-logout]');
const logoutStatus = document.querySelector('[data-settings-logout-status]');
logout?.addEventListener('click', async () => {
  logout.disabled = true;
  logoutStatus.textContent = 'Saindo…';
  logoutStatus.dataset.state = '';
  try {
    await signOut();
    releaseAccountPreferences({ notify: false });
    location.href = './login.html';
  } catch (error) {
    logoutStatus.textContent = error.message || 'Não foi possível sair. Tente novamente.';
    logoutStatus.dataset.state = 'error';
    logout.disabled = false;
  }
});

// ---- "Dados neste navegador": a sub-view with its own heading and a way back ----------------
const DEVICE_VIEW = '#dados-neste-navegador';
const subview = document.querySelector('[data-settings-subview]');
const mainParts = document.querySelectorAll('[data-settings-main]');
const deviceRow = document.querySelector('[data-open-device-data]');
const baseTitle = document.title;
let shown = null;
function showView({ focus = true } = {}) {
  const device = location.hash === DEVICE_VIEW;
  if (device === shown) return;
  const first = shown === null;
  shown = device;
  subview.hidden = !device;
  mainParts.forEach((node) => (node.hidden = device));
  document.title = device ? `${baseTitle.split('|')[0].trim()} | Dados neste navegador` : baseTitle;
  if (first && !device) return;
  window.scrollTo(0, 0);
  if (!focus) return;
  if (device) subview.querySelector('h1')?.focus();
  else deviceRow?.focus();
}
window.addEventListener('hashchange', () => showView());
showView();

// The row shows the state in a word, so a problem is visible without opening the sub-view.
const panel = document.querySelector('[data-sync-panel]');
const summary = document.querySelector('[data-device-summary]');
const SUMMARY = {
  saved: 'Tudo salvo',
  syncing: 'Sincronizando…',
  pending: 'Envio pendente',
  offline: 'Sem conexão',
};
function renderSummary() {
  if (!summary || !panel) return;
  const state = panel.dataset.state || '';
  summary.textContent = SUMMARY[state] || '';
  summary.dataset.state = state;
}
if (panel) {
  new MutationObserver(renderSummary).observe(panel, {
    attributes: true,
    attributeFilter: ['data-state'],
  });
  renderSummary();
}
