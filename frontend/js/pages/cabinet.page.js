// Gabinete (3.5, Milestone 6): drawers of collectibles, each a memory of a learning event (what
// the student did, when, in which lesson). The server owns every unlock; this page only shows
// them and lets the student place unlocked desk objects (object id + slot). Art is resolved by id
// through data-art-slot / data-art-id; nothing renders when an asset is missing.
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
import {
  DESK_SLOTS,
  KIND_LABEL,
  applyExperienceMode,
  artSlot,
  describeCollectible,
  formatDay,
  readExperienceMode,
} from '../utils/collectibles.js';
import * as api from '../api/discovery.api.js';

const $ = (selector, root = document) => root.querySelector(selector);
const uuid = () => crypto.randomUUID();
let collection = null;

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}
const own = (tag, text, className) => el(tag, { translate: 'no', className, text });

function setStatus(text, kind = 'info') {
  const box = $('[data-cabinet-status]');
  box.textContent = text;
  box.dataset.state = kind;
}

/** Progress toward a locked item, from the server's counts (shown in adventure mode only). */
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

function renderDrawers() {
  const unlocked = new Map(collection.unlocks.map((u) => [u.id, u]));
  const drawers = Object.entries(KIND_LABEL).map(([kind, label]) => {
    const items = collection.catalog.filter((item) => item.kind === kind);
    const found = items.filter((item) => unlocked.has(item.id)).length;
    const list = el(
      'ul',
      { className: 'cabinet-items' },
      ...items.map((item) => {
        const info = describeCollectible(item.id);
        const unlock = unlocked.get(item.id);
        if (!unlock)
          return el(
            'li',
            { className: 'cabinet-item', 'data-state': 'locked', 'data-collectible': item.id },
            artSlot(document, kind, item.id, 'collectible-art is-locked'),
            el('div', {}, el('strong', { text: info.name }), el('p', { className: 'cabinet-hint', text: info.hint }), progressOf(item) ? el('p', { className: 'cabinet-progress', 'data-adventure-only': true, text: progressOf(item) }) : null),
          );
        const discovery = unlock.currentDiscoveryId
          ? el('a', { href: `./descobertas.html?id=${encodeURIComponent(unlock.currentDiscoveryId)}`, text: 'Abrir a descoberta' })
          : null;
        return el(
          'li',
          { className: 'cabinet-item', 'data-state': 'unlocked', 'data-collectible': item.id },
          artSlot(document, kind, item.id),
          el(
            'div',
            {},
            el('strong', { text: info.name }),
            el('p', { text: info.memory }),
            el(
              'p',
              { className: 'cabinet-origin' },
              el('time', { datetime: unlock.occurredAt, text: formatDay(unlock.occurredAt) }),
              unlock.lessonTitle ? document.createTextNode(' · ') : null,
              unlock.lessonTitle ? own('span', unlock.lessonTitle) : null,
              discovery ? document.createTextNode(' · ') : null,
              discovery,
            ),
          ),
        );
      }),
    );
    return el(
      'details',
      { className: 'cabinet-drawer', 'data-drawer': kind, open: true },
      el('summary', {}, el('span', { text: label }), el('span', { className: 'cabinet-count', text: `${found} de ${items.length}` })),
      list,
    );
  });
  // Opening a drawer pulls its contents out (a short gesture; closing is instant).
  for (const drawer of drawers)
    drawer.addEventListener('toggle', () => {
      if (!drawer.open) return;
      drawer.dataset.opening = '';
      setTimeout(() => delete drawer.dataset.opening, 320);
    });
  $('[data-cabinet-drawers]').replaceChildren(...drawers);
  if (!collection.unlocks.length)
    $('[data-cabinet-drawers]').prepend(
      emptyState('As gavetas ainda estão vazias', 'Investigue uma pergunta de uma aula: a primeira evidência que você guardar já deixa um selo aqui.', {
        href: './historico.html',
        action: 'Abrir a Biblioteca',
        mascot: 'curious',
      }),
    );
}

// "Sua mesa" follows the same rules as Arrumar a mesa on Início (utils/desk.js): one desk made of
// the starter objects (appearance preferences) and the collectibles (server layout); an object is
// in one place; choosing a taken place moves the object that was there (a swap, or back to the
// drawer). Each choice says who is in each place now.
let workingDesk = {};
let available = [];
function loadDesk() {
  available = availableObjects({ unlocks: collection.unlocks, discoveries: true });
  workingDesk = mergeDesk({ starters: getUiPreferences().deskStarters, items: collection.layout.items, available });
}
function renderDesk() {
  const objects = collection.unlocks.filter((u) => u.kind === 'object');
  $('[data-desk-section]').hidden = !objects.length;
  if (!objects.length) return;
  const slots = collection.slots.filter((slot) => DESK_SLOT_ORDER.includes(slot));
  $('[data-desk-preview]').replaceChildren(
    ...slots.map((slot) => {
      const objectId = workingDesk[slot];
      return el(
        'li',
        { className: 'desk-slot', 'data-slot': slot, 'data-filled': String(Boolean(objectId)) },
        el('span', { className: 'desk-slot-art', 'data-art-slot': `desk.${slot}`, 'data-art-id': objectId || '', 'aria-hidden': 'true' }),
        el('span', { className: 'desk-slot-name', text: DESK_SLOTS[slot] || slot }),
        el('span', { className: 'desk-slot-object', text: objectId ? objectName(objectId) : 'vazio' }),
      );
    }),
  );
  const focused = document.activeElement?.id;
  $('[data-desk-choices]').replaceChildren(
    ...[...new Set(objects.map((object) => object.id))].map((objectId, index) => {
      const id = `desk-choice-${index}`;
      const select = el('select', { id, name: objectId, 'data-object': objectId });
      select.append(el('option', { value: '', text: 'Guardado no gabinete' }));
      for (const choice of slotChoices(workingDesk, objectId).filter((c) => slots.includes(c.slot)))
        select.append(
          el('option', {
            value: choice.slot,
            text: choice.occupant ? `${DESK_SLOTS[choice.slot] || choice.label} (troca com ${objectName(choice.occupant).toLocaleLowerCase('pt-BR')})` : DESK_SLOTS[choice.slot] || choice.label,
          }),
        );
      select.value = slotOf(workingDesk, objectId) || '';
      select.addEventListener('change', () => {
        workingDesk = select.value ? placeObject(workingDesk, objectId, select.value) : removeObject(workingDesk, objectId);
        renderDesk();
      });
      return el('div', { className: 'desk-choice' }, el('label', { for: id, text: describeCollectible(objectId).name }), select);
    }),
  );
  if (focused) document.getElementById(focused)?.focus();
}

async function saveDesk(event) {
  event.preventDefault();
  const { starters, items } = splitDesk(workingDesk);
  try {
    collection = await api.saveDeskLayout({ version: collection.layout.version, requestId: uuid(), items });
    // A starter object moved aside by a collectible is saved with the appearance preferences.
    const before = splitDesk(mergeDesk({ starters: getUiPreferences().deskStarters, available })).starters;
    if (JSON.stringify(before) !== JSON.stringify(starters)) setUiPreference('deskStarters', starters);
    loadDesk();
    renderDesk();
    setStatus('Mesa salva.');
  } catch (failure) {
    setStatus(failure.message || 'Não foi possível salvar a mesa.', 'error');
    if (failure.code === 'DISCOVERY_VERSION_CONFLICT') {
      collection = await api.getCollection();
      loadDesk();
      renderDesk();
    }
  }
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
  $('[data-experience-mode-control]').hidden = true;
  box.append(emptyState('O Gabinete ainda não está ativo', 'Ele aparece aqui quando for ativado neste servidor.', { href: './historico.html', action: 'Voltar à Biblioteca', mascot: 'rest' }));
} else {
  wireModes();
  $('[data-desk-form]').addEventListener('submit', (event) => void saveDesk(event));
  try {
    collection = await api.getCollection();
    renderDrawers();
    loadDesk();
    renderDesk();
  } catch (failure) {
    setStatus(failure.message || 'Não foi possível abrir o Gabinete.', 'error');
  }
}
