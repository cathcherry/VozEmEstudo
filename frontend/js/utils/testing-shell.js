// Public testing program in the signed-in shell (loaded by shell.js only when the flag is on):
// the welcome note for participants (once per browser session), "Ver meus limites" on refused AI
// actions, and the account label in Configurações. Nothing here blocks the page.
import {
  LIMITS_HREF,
  allowance,
  ensureTestingStyles,
  getDemoLessons,
  getTestingStatus,
} from './public-testing.js';
import { toast } from './toast.js';
import { icon } from './icons.js';

const WELCOME_KEY = 'voz-testing-welcome:';

function readFlag(key) {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeFlag(key) {
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    // Storage blocked: the note may show again on the next page, which is harmless.
  }
}

/** "5 minutos", "1 minuto", or seconds when the limit is not a whole number of minutes. */
function limitSentence(seconds) {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `Para que mais pessoas possam experimentar o Voz em Estudo gratuitamente, reduzimos temporariamente o limite de transcrição para ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} por participante.`;
  }
  return `Para que mais pessoas possam experimentar o Voz em Estudo gratuitamente, reduzimos temporariamente o limite de transcrição para ${seconds} segundos por participante.`;
}
function demoSentence(count) {
  if (count === 1) return 'Também preparamos 1 aula completa para você explorar sem gastar seu limite!';
  if (count > 1) return `Também preparamos ${count} aulas completas para você explorar sem gastar seu limite!`;
  return 'Também preparamos aulas completas para você explorar sem gastar seu limite!';
}

let welcome = null;
function closeWelcome({ restore = false } = {}) {
  if (!welcome) return;
  const node = welcome;
  welcome = null;
  const hadFocus = node.contains(document.activeElement);
  node.remove();
  if (restore || hadFocus) document.querySelector('main')?.focus({ preventScroll: true });
}

/** Builds the welcome note (exported for tests). */
export function buildWelcome({ limitSeconds, demoCount, demoAccess }, doc = document) {
  const card = doc.createElement('aside');
  card.className = 'testing-welcome';
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  card.setAttribute('aria-labelledby', 'testing-welcome-title');
  card.dataset.testingWelcome = '';
  const mark = doc.createElement('span');
  mark.className = 'testing-welcome__mark';
  mark.append(icon('sparkle', { size: 20, document: doc }));
  const body = doc.createElement('div');
  body.className = 'testing-welcome__body';
  const title = doc.createElement('strong');
  title.id = 'testing-welcome-title';
  title.className = 'testing-welcome__title';
  title.textContent = 'Estamos em fase de testes!';
  const text = doc.createElement('p');
  text.className = 'testing-welcome__text';
  const first = doc.createElement('span');
  first.textContent = limitSentence(limitSeconds);
  text.append(first);
  if (demoCount > 0 || demoAccess) {
    const second = doc.createElement('span');
    second.textContent = demoSentence(demoCount);
    text.append(' ', second);
  }
  const actions = doc.createElement('div');
  actions.className = 'testing-welcome__actions';
  const limits = doc.createElement('a');
  limits.className = 'testing-welcome__action';
  limits.href = LIMITS_HREF;
  limits.dataset.testingWelcomeLimits = '';
  limits.textContent = 'Ver meus limites';
  actions.append(limits);
  body.append(title, text, actions);
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'testing-welcome__close';
  close.setAttribute('aria-label', 'Fechar aviso');
  close.append(icon('close', { size: 18, document: doc }));
  card.append(mark, body, close);
  return card;
}

async function showWelcome(user, status) {
  const key = WELCOME_KEY + user.id;
  if (readFlag(key)) return;
  const left = allowance(status, 'transcription_seconds');
  if (!left) return;
  const demos = status.demoAccess ? await getDemoLessons() : [];
  await ensureTestingStyles();
  if (readFlag(key)) return;
  writeFlag(key);
  welcome = buildWelcome({ limitSeconds: left.limit, demoCount: demos.length, demoAccess: status.demoAccess });
  welcome.querySelector('.testing-welcome__close').addEventListener('click', () => closeWelcome({ restore: true }));
  document.body.append(welcome);
}

function onKeydown(event) {
  if (event.key !== 'Escape' || !welcome || event.defaultPrevented) return;
  // An open dialog or menu owns Escape first.
  if (document.querySelector('dialog[open]')) return;
  if (event.target?.closest?.('details[open], [role="menu"], .account-menu, [aria-expanded="true"]')) return;
  closeWelcome();
}

function onQuotaError(event) {
  const { code, message } = event.detail || {};
  if (!message || code === 'TESTING_CAPACITY_REACHED') return;
  toast(message, {
    type: 'error',
    duration: 12000,
    action: { label: 'Ver meus limites', onClick: () => { location.href = LIMITS_HREF; } },
  });
}

function labelSettingsRow(status) {
  const value = document.querySelector('.settings-profile-row .settings-row-value');
  if (!value) return;
  if (status.policy === 'tester') value.textContent = 'Participante';
  else if (status.policy === 'admin') value.textContent = 'Administradora';
}

let started = false;
export async function initTestingShell(user) {
  if (started || !user?.id) return;
  started = true;
  window.addEventListener('voz:quota-error', onQuotaError);
  document.addEventListener('keydown', onKeydown);
  const status = await getTestingStatus();
  if (!status) return;
  labelSettingsRow(status);
  if (status.policy === 'tester') await showWelcome(user, status);
}
