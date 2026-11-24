// Conta › "Conta de participante" / "Conta de administradora" (public testing program): what the
// account may still use, from GET /api/testing/me, and — for administrators only, when
// GET /api/testing/overview answers — the program-wide figures. 'legacy' and 'off' accounts see
// nothing new. Loaded only when FEATURE_PUBLIC_TESTING is on.
import { getTestingOverview } from '../api/testing.api.js';
import {
  DEMO_HREF,
  USAGE_KINDS,
  allowance,
  ensureTestingStyles,
  formatSeconds,
  getDemoLessons,
  getTestingStatus,
} from '../utils/public-testing.js';
import { icon } from '../utils/icons.js';

const locale = () => globalThis.VOZ_LOCALE || 'pt-BR';
const number = (value) => Math.round(Number(value) || 0).toLocaleString(locale());

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A labelled bar: the text says everything, the bar repeats it visually. */
function meter({ label, text, ratio, state = '' }) {
  const item = el('li', 'testing-meter');
  if (state) item.dataset.state = state;
  const head = el('div', 'testing-meter__head');
  head.append(el('span', 'testing-meter__label', label), el('span', 'testing-meter__value', text));
  const track = el('div', 'testing-meter__track');
  track.setAttribute('aria-hidden', 'true');
  const fill = el('span', 'testing-meter__fill');
  fill.style.setProperty('--fill', `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`);
  track.append(fill);
  item.append(head, track);
  return item;
}

const stateOf = (left) => (left.remaining <= 0 ? 'used' : left.remaining / Math.max(1, left.limit) <= 0.2 ? 'low' : '');

/** One meter per kind with a limit; a zero limit for participants shows only for Material integrado. */
export function usageMeters(status) {
  const list = el('ul', 'testing-meters');
  list.setAttribute('aria-label', 'Uso no período de testes');
  for (const [kind, label] of USAGE_KINDS) {
    const left = allowance(status, kind);
    if (!left) continue;
    if (left.limit <= 0) {
      if (kind === 'multi_lesson' && status.policy === 'tester') {
        const item = el('li', 'testing-meter testing-meter--off');
        item.dataset.kind = kind;
        item.append(el('span', 'testing-meter__label', `${label}: indisponível durante os testes`));
        list.append(item);
      }
      continue;
    }
    const text =
      kind === 'transcription_seconds'
        ? `${formatSeconds(left.used)} de ${formatSeconds(left.limit)} usados · restam ${formatSeconds(left.remaining)}`
        : `${number(left.used)} de ${number(left.limit)} · restam ${number(left.remaining)}`;
    const item = meter({ label, text, ratio: left.used / left.limit, state: stateOf(left) });
    item.dataset.kind = kind;
    list.append(item);
  }
  return list;
}

function explanation(status) {
  const text = el('p', 'testing-account__intro');
  const limit = allowance(status, 'transcription_seconds')?.limit;
  if (status.policy === 'admin') {
    text.textContent = 'Sua conta administra o programa de testes. Abaixo estão os limites da sua conta e, no painel seguinte, os números de todo o programa.';
    return text;
  }
  if (Number.isFinite(limit)) {
    const minutes = limit % 60 === 0 ? limit / 60 : null;
    text.append(
      el(
        'span',
        '',
        minutes
          ? `Para que mais pessoas possam experimentar o Voz em Estudo gratuitamente, reduzimos temporariamente o limite de transcrição para ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} por participante.`
          : `Para que mais pessoas possam experimentar o Voz em Estudo gratuitamente, reduzimos temporariamente o limite de transcrição para ${limit} segundos por participante.`,
      ),
    );
  }
  return text;
}

// ---- Administrators: the whole program --------------------------------------------------------
const minutesText = (seconds) => formatSeconds(seconds);
function figure(label, value, cap, format = number) {
  const hasCap = cap !== null && cap !== undefined && Number(cap) > 0;
  const ratio = hasCap ? Number(value) / Number(cap) : 0;
  return meter({
    label,
    text: hasCap ? `${format(value)} de ${format(cap)}` : format(value),
    ratio,
    state: hasCap ? (ratio >= 1 ? 'used' : ratio >= 0.8 ? 'low' : '') : 'nocap',
  });
}
function group(title, items) {
  const box = el('section', 'testing-figures');
  const heading = el('h3', 'testing-figures__title', title);
  const list = el('ul', 'testing-meters');
  list.append(...items);
  box.append(heading, list);
  return box;
}
function tile(label, value) {
  const item = el('li', 'testing-tile');
  item.append(el('strong', 'testing-tile__value', number(value)), el('span', 'testing-tile__label', label));
  return item;
}

export function overviewPanel(data) {
  const caps = data.config?.globalLimits || {};
  const tx = data.transcriptionSeconds || {};
  const requests = data.llmRequests || {};
  const tokens = data.llmTokens || {};
  const queue = data.queue || {};
  const panel = el('section', 'study-section testing-overview');
  panel.dataset.testingOverview = '';
  panel.setAttribute('aria-labelledby', 'testing-overview-title');
  const head = el('div', 'testing-account__head');
  const copy = el('div');
  copy.append(el('p', 'testing-account__eyebrow', 'Administração'));
  const heading = el('h2', '', 'Programa de testes');
  heading.id = 'testing-overview-title';
  copy.append(heading);
  const state = el('span', 'testing-chip', data.config?.enabled ? 'Programa ativo' : 'Programa pausado');
  state.dataset.state = data.config?.enabled ? 'on' : 'off';
  head.append(copy, state);
  const tiles = el('ul', 'testing-tiles');
  tiles.setAttribute('aria-label', 'Participação');
  tiles.append(
    tile('participantes', data.participants),
    tile('administradoras', data.admins),
    tile('cópias de demonstração', data.demoCopies),
  );
  const queueTiles = el('ul', 'testing-tiles testing-tiles--queue');
  queueTiles.setAttribute('aria-label', 'Fila de processamento');
  queueTiles.append(
    tile('na fila', queue.PENDENTE),
    tile('em execução', queue.EM_EXECUCAO),
    tile('aguardando nova tentativa', queue.AGUARDANDO_REPETICAO),
  );
  const tc = caps.transcription_seconds || {};
  const rc = caps.llm_requests || {};
  const kc = caps.llm_tokens || {};
  const grid = el('div', 'testing-figures-grid');
  grid.append(
    group('Transcrição', [
      figure('Última hora', tx.hour, tc.hour, minutesText),
      figure('Hoje', tx.day, tc.day, minutesText),
      figure('Total', tx.total, tc.total, minutesText),
    ]),
    group('Pedidos à IA de texto', [
      figure('Última hora', requests.hour, rc.hour),
      figure('Hoje', requests.day, rc.day),
      figure('Total', requests.total, rc.total),
    ]),
    group('Tokens', [
      figure('Última hora', tokens.hour, kc.hour),
      figure('Hoje', tokens.day, kc.day),
      figure('Total', tokens.total, kc.total),
    ]),
  );
  const queueTitle = el('h3', 'testing-figures__title', 'Fila de processamento');
  const note = el('p', 'testing-account__note');
  if (data.config?.registrationEndsAt)
    note.textContent = `Inscrições até ${new Intl.DateTimeFormat(locale(), { dateStyle: 'long' }).format(new Date(data.config.registrationEndsAt))}. Os números não identificam ninguém.`;
  else note.textContent = 'Os números não identificam ninguém.';
  panel.append(head, tiles, grid, queueTitle, queueTiles, note);
  return panel;
}

/** Renders the section after `anchor` (and the admin panel when allowed). */
export async function mountTestingAccount(anchor) {
  if (!anchor) return null;
  const status = await getTestingStatus();
  if (!status || !['tester', 'admin'].includes(status.policy)) return null;
  const [demos] = await Promise.all([status.demoAccess ? getDemoLessons() : [], ensureTestingStyles()]);
  const section = el('section', 'study-section testing-account');
  section.id = 'limites';
  section.tabIndex = -1;
  section.dataset.testingAccount = status.policy;
  section.setAttribute('aria-labelledby', 'testing-account-title');
  const head = el('div', 'testing-account__head');
  const copy = el('div');
  copy.append(el('p', 'testing-account__eyebrow', 'Período de testes'));
  const heading = el('h2', '', status.policy === 'admin' ? 'Conta de administradora' : 'Conta de participante');
  heading.id = 'testing-account-title';
  copy.append(heading);
  const badge = el('span', 'testing-chip', status.policy === 'admin' ? 'Administradora' : 'Participante');
  badge.prepend(icon(status.policy === 'admin' ? 'star' : 'sparkle', { size: 16 }));
  head.append(copy, badge);
  section.append(head, explanation(status), usageMeters(status));
  if (status.demoAccess && demos.length) {
    const link = el('a', 'secondary-action testing-account__demos');
    link.href = DEMO_HREF;
    link.append(icon('open', { size: 18 }), el('span', '', `Ver as aulas de demonstração (${demos.length})`));
    const foot = el('div', 'testing-account__foot');
    foot.append(link);
    section.append(foot);
  }
  anchor.after(section);
  if (location.hash === '#limites') {
    section.scrollIntoView({ block: 'start' });
    section.focus({ preventScroll: true });
  }
  if (status.admin) {
    try {
      const overview = await getTestingOverview();
      if (overview) section.after(overviewPanel(overview));
    } catch {
      // 404 for everyone who is not an administrator: nothing to show.
    }
  }
  return section;
}
