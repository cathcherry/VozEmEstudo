// Gabinete de curiosidades (3.6, Milestone E): a wooden cabinet with shelves and drawers. Each
// collectible is a memory of a learning event the SERVER recorded (what the student did, when, in
// which lesson); discoveries live in the "Espécimes" drawer as evolving cards. Drawers open with a
// click, Enter or Space; arrow keys move between drawers and between compartments; Esc closes.
// Inspecting an item opens its museum label (dialog). The shelves show what the drawers hold, so
// the cabinet visibly fills as the student investigates. Nothing here grants anything.
import { getUiPreferences, setUiPreference } from '../utils/preferences.js';
import {
  DESK_SLOT_ORDER,
  availableObjects,
  mergeDesk,
  objectName,
  placeObject,
  removeObject,
  slotChoices,
  slotOf,
  splitDesk,
} from '../utils/desk.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { emptyState } from '../utils/material-ui.js';
import { DESK_SLOTS, applyExperienceMode, describeCollectible, formatDay, readExperienceMode } from '../utils/collectibles.js';
import { discoveryCard, el, own, stateLines } from '../utils/discovery-card-ui.js';
import { cardState, describeState } from '../utils/discovery-card.js';
import * as api from '../api/discovery.api.js';

const $ = (selector, root = document) => root.querySelector(selector);
const uuid = () => crypto.randomUUID();
const DRAWERS = [
  { kind: 'stamp', label: 'Selos', about: 'Selos de primeiras vezes: a primeira evidência, a primeira explicação, a primeira ponte entre disciplinas.' },
  { kind: 'object', label: 'Objetos', about: 'Objetos que aparecem com investigações repetidas.' },
  { kind: 'cover', label: 'Capas', about: 'Capas para o caderno de descobertas.' },
  { kind: 'specimen', label: 'Espécimes', about: 'As suas descobertas, como fichas que mudam com o que você acrescenta a elas.' },
];
const KIND_NAME = { stamp: 'Selo', object: 'Objeto', cover: 'Capa', specimen: 'Espécime' };
const SPECIMEN_LIMIT = 12;
const DESK_ON_HOME = false;

let collection = null;
let discoveries = [];
let openKind = null;
let lastInspector = null;

function setStatus(text, kind = 'info') {
  const box = $('[data-cabinet-status]');
  box.textContent = text;
  box.dataset.state = kind;
}
const reducedMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches ||
  ['reducedMotion', 'lowStimulation'].some((key) => document.documentElement.dataset[key] === 'true') ||
  document.documentElement.dataset.motion === 'off';

const unlockedMap = () => new Map(collection.unlocks.map((u) => [u.id, u]));
const itemsOf = (kind) => collection.catalog.filter((item) => item.kind === kind);

/** Progress toward a locked item, from the server's counts (adventure mode only). */
function progressOf(item) {
  const counts = collection.counts || {};
  const have = {
    investigation_completed: counts.investigations,
    evidence_verified: counts.evidence,
    revisit_made: counts.revisits,
    connection_made: counts.connections,
  }[item.event];
  return Number.isInteger(have) && item.count > 1 ? `${Math.min(have, item.count)} de ${item.count}` : '';
}

/** How full a drawer is: drives the paper peeking out of the drawer front. */
function fillOf(kind) {
  if (kind === 'specimen') return discoveries.length ? (discoveries.length >= 6 ? 'full' : 'some') : 'empty';
  const items = itemsOf(kind);
  const found = items.filter((item) => unlockedMap().has(item.id)).length;
  return !found ? 'empty' : found === items.length ? 'full' : 'some';
}
function countText(kind) {
  if (kind === 'specimen')
    return discoveries.length === 1 ? '1 descoberta' : discoveries.length ? `${discoveries.length} descobertas` : 'nenhuma ainda';
  const items = itemsOf(kind);
  return `${items.filter((item) => unlockedMap().has(item.id)).length} de ${items.length}`;
}

// ---- Shelves: the environment changes as the drawers fill --------------------------------
function renderShelves() {
  const unlocked = unlockedMap();
  const objects = itemsOf('object');
  const foundObjects = objects.filter((item) => unlocked.has(item.id));
  $('[data-shelf-row="objects"]').replaceChildren(
    ...objects.map((item) =>
      unlocked.has(item.id)
        ? el('li', { className: 'curio-shelf-item', 'data-found': 'true' },
            el('span', { 'data-art-slot': 'object', 'data-art-id': item.id, 'data-art-size': '72', 'aria-hidden': 'true' }),
            el('span', { className: 'curio-shelf-name', text: describeCollectible(item.id).name }))
        : el('li', { className: 'curio-shelf-item', 'data-found': 'false', 'aria-hidden': 'true' },
            el('span', { 'data-art-slot': 'object', 'data-art-id': item.id, 'data-art-size': '72' })),
    ),
  );
  $('[data-shelf-caption="objects"]').textContent = foundObjects.length
    ? 'Os objetos que você encontrou ficam à vista.'
    : 'Esta prateleira espera o primeiro objeto: ele aparece depois de três investigações registradas.';
  const memories = [...itemsOf('stamp'), ...itemsOf('cover')];
  const foundMemories = memories.filter((item) => unlocked.has(item.id));
  $('[data-shelf-row="memories"]').replaceChildren(
    ...memories.map((item) => {
      const found = unlocked.has(item.id);
      return el(
        'li',
        { className: 'curio-shelf-item', 'data-kind': item.kind, 'data-found': String(found), 'aria-hidden': found ? null : 'true' },
        el('span', { 'data-art-slot': item.kind, 'data-art-id': item.id, 'data-art-size': item.kind === 'cover' ? '52' : '44', 'aria-hidden': 'true' }),
        found ? el('span', { className: 'sr-only', text: describeCollectible(item.id).name }) : null,
      );
    }),
  );
  $('[data-shelf-caption="memories"]').textContent = foundMemories.length
    ? 'Selos e capas presos na parede do gabinete.'
    : 'Os selos aparecem aqui conforme você investiga.';
  const found = foundObjects.length + foundMemories.length + discoveries.length;
  $('[data-curio-cabinet]').dataset.fill = !found ? 'empty' : foundObjects.length >= 3 ? 'full' : 'some';
}

// ---- Drawers --------------------------------------------------------------------------------
function renderDrawers() {
  const host = $('[data-curio-drawers]');
  const focusedKind = document.activeElement?.closest?.('[data-drawer]')?.dataset.drawer;
  const buttons = DRAWERS.map(({ kind, label }) =>
    el(
      'button',
      {
        type: 'button',
        className: 'drawer curio-drawer',
        id: `drawer-${kind}`,
        'data-drawer': kind,
        'data-fill': fillOf(kind),
        'aria-expanded': String(openKind === kind),
        'aria-controls': 'curio-tray',
        tabindex: (openKind || focusedKind || 'stamp') === kind ? '0' : '-1',
      },
      el('span', { className: 'curio-peek', 'aria-hidden': 'true' }),
      el('span', { className: 'label-holder' }, el('span', { className: 'curio-drawer-name', text: label })),
      el('span', { className: 'curio-drawer-count cabinet-count', text: countText(kind) }),
      el('span', { className: 'drawer-pull', 'aria-hidden': 'true' }),
    ),
  );
  const nodes = [];
  for (const button of buttons) {
    nodes.push(button);
    if (button.dataset.drawer === openKind) nodes.push(renderTray(openKind));
  }
  host.replaceChildren(...nodes);
  for (const button of buttons) button.addEventListener('click', () => toggleDrawer(button.dataset.drawer));
  if (focusedKind) host.querySelector(`[data-drawer="${focusedKind}"]`)?.focus();
}

function toggleDrawer(kind, { focusTray = false } = {}) {
  openKind = openKind === kind ? null : kind;
  renderDrawers();
  const tray = $('#curio-tray');
  if (tray && !reducedMotion()) {
    tray.dataset.opening = '';
    setTimeout(() => delete tray.dataset.opening, 360);
  }
  if (openKind) {
    try {
      history.replaceState(null, '', `?gaveta=${openKind}`);
    } catch {
      /* file:// previews */
    }
    if (focusTray) tray?.querySelector('[tabindex="0"]')?.focus();
  } else {
    try {
      history.replaceState(null, '', location.pathname);
    } catch {
      /* ignore */
    }
  }
}

function compartment(kind, item, index) {
  const unlocked = unlockedMap();
  const info = describeCollectible(item.id);
  const unlock = unlocked.get(item.id);
  const progress = unlock ? '' : progressOf(item);
  return el(
    'li',
    {},
    el(
      'button',
      {
        type: 'button',
        className: 'curio-compartment cabinet-item',
        'data-state': unlock ? 'unlocked' : 'locked',
        'data-collectible': item.id,
        tabindex: index === 0 ? '0' : '-1',
        'aria-haspopup': 'dialog',
      },
      el('span', { className: 'curio-art', 'data-art-slot': kind, 'data-art-id': item.id, 'data-art-size': '72', 'aria-hidden': 'true' }),
      el('strong', { className: 'curio-name', text: info.name }),
      unlock
        ? el('time', { className: 'cabinet-origin', datetime: unlock.occurredAt, text: formatDay(unlock.occurredAt) })
        : el('span', { className: 'cabinet-hint', text: info.hint }),
      progress ? el('span', { className: 'cabinet-progress', 'data-adventure-only': true, text: progress }) : null,
      el('span', { className: 'sr-only', text: unlock ? 'Inspecionar' : 'Ainda não encontrado. Ver como encontrar' }),
    ),
  );
}

function specimenCompartment(row, index) {
  const state = cardState(row);
  return el(
    'li',
    {},
    el(
      'button',
      {
        type: 'button',
        className: 'curio-compartment curio-specimen',
        'data-state': 'unlocked',
        'data-discovery': row.id,
        'data-stage': state.stage,
        'data-traits': state.traits.join(' '),
        tabindex: index === 0 ? '0' : '-1',
        'aria-haspopup': 'dialog',
      },
      el('span', { className: 'curio-specimen-card', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')),
      own('strong', row.title, 'curio-name'),
      row.subject ? own('span', row.subject, 'curio-subject') : null,
      el('span', { className: 'curio-stage', text: describeState(state) }),
    ),
  );
}

function renderTray(kind) {
  const drawer = DRAWERS.find((d) => d.kind === kind);
  let list;
  if (kind === 'specimen') {
    const shown = discoveries.slice(0, SPECIMEN_LIMIT);
    list = shown.length
      ? shown.map(specimenCompartment)
      : [0, 1, 2].map((n) =>
          el('li', { className: 'curio-empty-slot', 'aria-hidden': n ? 'true' : null },
            n ? null : el('span', { text: 'A sua primeira descoberta fica neste compartimento.' })),
        );
  } else list = itemsOf(kind).map((item, index) => compartment(kind, item, index));
  return el(
    'section',
    { className: 'curio-tray', id: 'curio-tray', 'data-tray': kind, 'aria-labelledby': `curio-tray-title` },
    el('header', { className: 'curio-tray-head' },
      el('h2', { id: 'curio-tray-title', text: drawer.label }),
      el('p', { text: drawer.about })),
    el('ul', { className: 'curio-compartments', 'data-compartments': kind, 'aria-label': `Compartimentos: ${drawer.label}` }, ...list),
    kind === 'specimen' && discoveries.length
      ? el('p', { className: 'curio-tray-foot' }, el('a', { className: 'text-action', href: './descobertas.html', text: discoveries.length > SPECIMEN_LIMIT ? 'Ver todas no Arquivo de Descobertas' : 'Abrir o Arquivo de Descobertas' }))
      : null,
  );
}

// ---- Keyboard: arrows between neighbours by position (works for any number of columns) ------
function neighbour(items, current, key) {
  const index = items.indexOf(current);
  if (key === 'Home') return items[0];
  if (key === 'End') return items.at(-1);
  if (key === 'ArrowRight') return items[Math.min(items.length - 1, index + 1)];
  if (key === 'ArrowLeft') return items[Math.max(0, index - 1)];
  const box = current.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const down = key === 'ArrowDown';
  let best = null;
  let bestScore = Infinity;
  for (const item of items) {
    if (item === current) continue;
    const other = item.getBoundingClientRect();
    const dy = down ? other.top - box.bottom : box.top - other.bottom;
    if (dy < -4) continue;
    const score = dy * 4 + Math.abs(other.left + other.width / 2 - cx);
    if (score < bestScore) [best, bestScore] = [item, score];
  }
  return best || current;
}
function wireKeyboard() {
  const host = $('[data-curio-drawers]');
  host.addEventListener('keydown', (event) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    const target = event.target;
    if (event.key === 'Escape' && openKind && target.closest('#curio-tray, [data-drawer]')) {
      event.preventDefault();
      const kind = openKind;
      toggleDrawer(kind);
      $(`[data-drawer="${kind}"]`)?.focus();
      return;
    }
    if (!keys.includes(event.key)) return;
    const scope = target.closest('[data-compartments]') ? [...target.closest('[data-compartments]').querySelectorAll('button')] : target.matches('[data-drawer]') ? [...host.querySelectorAll('[data-drawer]')] : null;
    if (!scope) return;
    event.preventDefault();
    const next = neighbour(scope, target, event.key);
    for (const item of scope) item.tabIndex = item === next ? 0 : -1;
    next.focus();
  });
  host.addEventListener('click', (event) => {
    const button = event.target.closest('.curio-compartment');
    if (!button) return;
    lastInspector = button;
    if (button.dataset.discovery) inspectDiscovery(button.dataset.discovery);
    else inspectCollectible(button.dataset.collectible);
  });
}

// ---- The museum label (inspect) ---------------------------------------------------------------
const fact = (term, ...value) => [el('dt', { text: term }), el('dd', {}, ...value)];

function openDialog() {
  const dialog = $('[data-specimen-dialog]');
  if (!dialog.open) dialog.showModal();
  $('[data-specimen-title]').focus({ preventScroll: true });
}

function inspectCollectible(id) {
  const item = collection.catalog.find((c) => c.id === id);
  if (!item) return;
  const info = describeCollectible(id);
  const unlock = unlockedMap().get(id);
  const sheet = $('[data-specimen-sheet]');
  sheet.dataset.kind = item.kind;
  sheet.dataset.state = unlock ? 'unlocked' : 'locked';
  $('[data-specimen-art]').replaceChildren(el('span', { 'data-art-slot': item.kind, 'data-art-id': id, 'data-art-size': item.kind === 'cover' ? '150' : '168', 'aria-hidden': 'true' }));
  $('[data-specimen-kind]').textContent = unlock ? KIND_NAME[item.kind] : `${KIND_NAME[item.kind]} ainda não ${item.kind === 'cover' ? 'encontrada' : 'encontrado'}`;
  const title = $('[data-specimen-title]');
  title.textContent = info.name;
  title.tabIndex = -1;
  $('[data-specimen-description]').textContent = unlock ? info.memory : info.hint;
  const facts = [];
  if (unlock) {
    facts.push(...fact('Quando', el('time', { datetime: unlock.occurredAt, text: formatDay(unlock.occurredAt) })));
    if (unlock.lessonTitle)
      facts.push(...fact('Aula', unlock.materialId ? el('a', { href: `./material.html?id=${encodeURIComponent(unlock.materialId)}`, translate: 'no', text: unlock.lessonTitle }) : own('span', unlock.lessonTitle)));
    if (unlock.currentDiscoveryId) {
      const found = discoveries.find((d) => d.id === unlock.currentDiscoveryId);
      facts.push(...fact('Descoberta', el('a', { href: `./descobertas.html?id=${encodeURIComponent(unlock.currentDiscoveryId)}`, translate: found ? 'no' : null, text: found ? found.title : 'Abrir a descoberta' })));
    }
    facts.push(...fact('Como apareceu', el('span', { text: info.hint })));
  } else {
    const progress = progressOf(item);
    if (progress) facts.push(...fact('Até agora', el('span', { text: progress })));
  }
  $('[data-specimen-facts]').replaceChildren(...facts);
  const actions = [];
  // 3.7: Início is a dashboard again (no desk). Placement data is kept (DESK_ON_HOME restores it).
  if (DESK_ON_HOME && unlock && item.kind === 'object') actions.push(deskAction(id));
  if (unlock && item.kind === 'cover')
    actions.push(el('a', { className: 'secondary-action button-link', href: './aparencia.html#estudio', text: 'Escolher a capa em Aparência' }));
  if (!unlock) actions.push(el('a', { className: 'secondary-action button-link', href: './historico.html', text: 'Escolher uma aula para investigar' }));
  $('[data-specimen-actions]').replaceChildren(...actions);
  openDialog();
}

function inspectDiscovery(id) {
  const row = discoveries.find((d) => d.id === id);
  if (!row) return;
  const sheet = $('[data-specimen-sheet]');
  sheet.dataset.kind = 'specimen';
  sheet.dataset.state = 'unlocked';
  const state = cardState(row);
  $('[data-specimen-art]').replaceChildren(discoveryCard(row, { compact: true, headingLevel: 3 }));
  $('[data-specimen-kind]').textContent = KIND_NAME.specimen;
  const title = $('[data-specimen-title]');
  title.textContent = row.title;
  title.setAttribute('translate', 'no');
  title.tabIndex = -1;
  $('[data-specimen-description]').replaceChildren(el('span', { text: 'Este cartão muda com o que você acrescenta à descoberta.' }));
  const facts = [...fact('Aula', el('a', { href: `./material.html?id=${encodeURIComponent(row.materialId)}`, translate: 'no', text: row.lessonTitle || 'Abrir a aula' }))];
  if (row.subject) facts.push(...fact('Disciplina', own('span', row.subject)));
  facts.push(...fact('Registrada em', el('time', { datetime: row.createdAt, text: formatDay(row.createdAt) })));
  facts.push(...fact('Por que o cartão está assim', stateLines(state)));
  $('[data-specimen-facts]').replaceChildren(...facts);
  $('[data-specimen-actions]').replaceChildren(el('a', { className: 'primary-action button-link', href: `./descobertas.html?id=${encodeURIComponent(id)}`, text: 'Abrir a descoberta' }));
  openDialog();
}

// "Colocar na mesa": the same desk as Arrumar a mesa on Início (utils/desk.js): starters live in
// the appearance preferences, collectibles in the server layout; choosing a taken place swaps.
function currentDesk() {
  const available = availableObjects({ unlocks: collection.unlocks, discoveries: true });
  return { available, desk: mergeDesk({ starters: getUiPreferences().deskStarters, items: collection.layout.items, available }) };
}
function deskAction(objectId) {
  const { desk } = currentDesk();
  const place = slotOf(desk, objectId);
  const slots = collection.slots.filter((slot) => DESK_SLOT_ORDER.includes(slot));
  const select = el('select', { id: 'specimen-desk-slot', name: 'slot' });
  for (const choice of slotChoices(desk, objectId).filter((c) => slots.includes(c.slot)))
    select.append(el('option', {
      value: choice.slot,
      text: choice.occupant ? `${DESK_SLOTS[choice.slot] || choice.label} (troca com ${objectName(choice.occupant).toLocaleLowerCase('pt-BR')})` : DESK_SLOTS[choice.slot] || choice.label,
    }));
  select.value = place || slots.find((slot) => !desk[slot]) || slots[0];
  const form = el(
    'form',
    { className: 'specimen-desk', 'data-specimen-desk': objectId },
    el('p', { className: 'specimen-desk-now', text: place ? `Na mesa: ${DESK_SLOTS[place] || place}.` : 'Guardado no gabinete.' }),
    el('label', { for: 'specimen-desk-slot', text: 'Lugar na mesa' }),
    select,
    el('div', { className: 'specimen-desk-buttons' },
      el('button', { type: 'submit', className: 'primary-action', text: place ? 'Mudar de lugar' : 'Colocar na mesa' }),
      place ? el('button', { type: 'button', className: 'secondary-action', 'data-desk-store': '', text: 'Guardar no gabinete' }) : null),
    el('a', { className: 'text-action', href: './painel.html', text: 'Arrumar a mesa no Início' }),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveDesk(objectId, (d) => placeObject(d, objectId, select.value), `Colocado na mesa: ${DESK_SLOTS[select.value] || select.value}.`);
  });
  form.querySelector('[data-desk-store]')?.addEventListener('click', () => void saveDesk(objectId, (d) => removeObject(d, objectId), 'Guardado no gabinete.'));
  return form;
}
async function saveDesk(objectId, change, message) {
  const { desk, available } = currentDesk();
  const next = change(desk);
  const { starters, items } = splitDesk(next);
  try {
    collection = await api.saveDeskLayout({ version: collection.layout.version, requestId: uuid(), items });
    const before = splitDesk(mergeDesk({ starters: getUiPreferences().deskStarters, available })).starters;
    if (JSON.stringify(before) !== JSON.stringify(starters)) setUiPreference('deskStarters', starters);
    setStatus(message);
    $('[data-specimen-actions]').replaceChildren(deskAction(objectId));
    $('[data-specimen-desk] .specimen-desk-now').setAttribute('role', 'status');
    $('[data-specimen-desk] .specimen-desk-now').textContent = message;
  } catch (failure) {
    setStatus(failure.message || 'Não foi possível salvar a mesa.', 'error');
    if (failure.code === 'DISCOVERY_VERSION_CONFLICT') collection = await api.getCollection();
  }
}

function wireDialog() {
  const dialog = $('[data-specimen-dialog]');
  $('[data-specimen-close]').addEventListener('click', () => dialog.close());
  // A click on the backdrop (outside the sheet) closes, like Esc.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    $('[data-specimen-title]').removeAttribute('translate');
    if (lastInspector?.isConnected) lastInspector.focus();
  });
}

function wireModes() {
  const mode = readExperienceMode();
  for (const input of document.querySelectorAll('input[name="experience-mode"]')) {
    input.checked = input.value === mode;
    input.addEventListener('change', () => {
      // One preference for the account (Aparência shows the same choice); nothing is erased.
      setUiPreference('experience', input.value);
      setStatus({ quiet: 'Modo Estudo silencioso: selos e celebrações ficam ocultos; tudo continua registrado.', cozy: 'Modo Estudo aconchegante.', adventure: 'Modo Estudo aventura: o caminho até os próximos itens fica visível.' }[input.value]);
    });
  }
}

applyExperienceMode();
await initAuthenticatedShell();
const flags = await getFeatureFlags().catch(() => ({}));
if (!flags.discoveries) {
  const box = $('[data-tool-unavailable]');
  box.hidden = false;
  box.append(emptyState('O Gabinete ainda não está ativo', 'Ele aparece aqui quando for ativado neste servidor.', { href: './historico.html', action: 'Voltar à Biblioteca', mascot: 'rest' }));
} else {
  wireModes();
  wireDialog();
  wireKeyboard();
  try {
    [collection, discoveries] = await Promise.all([api.getCollection(), api.listDiscoveries().catch(() => [])]);
    $('[data-cabinet-stage]').hidden = false;
    $('[data-cabinet-guide]').hidden = discoveries.length > 0;
    const asked = new URLSearchParams(location.search).get('gaveta');
    openKind = DRAWERS.some((d) => d.kind === asked) ? asked : null;
    renderShelves();
    renderDrawers();
  } catch (failure) {
    setStatus(failure.message || 'Não foi possível abrir o Gabinete.', 'error');
  }
}
