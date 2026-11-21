// The escrivaninha at the top of Início (3.5, Milestone 5): the atmosphere's window, a shelf, the
// desk surface with the student's objects and Lume. Decoration only: the next action (continue
// the lesson) stays the most prominent thing on the page, and "Estudo silencioso", the
// screen-reader mode and "Contraste reforçado" hide the whole scene (CSS: [data-decoration]).
//
// Arranging the desk works by direct manipulation (drag an object to a place) and with the
// keyboard or a tap (choose the object, then the place). Starter objects are saved in the
// account's appearance preferences; collectible objects with PUT /api/collection/layout.
import { getUiPreferences, setUiPreference } from '../utils/preferences.js';
import { resolveAtmosphere } from '../utils/atmospheres.js';
import {
  DESK_SLOT_LABELS,
  DESK_SLOT_ORDER,
  availableObjects,
  companionState,
  describeDesk,
  mergeDesk,
  objectName,
  placeObject,
  removeObject,
  slotOf,
  splitDesk,
} from '../utils/desk.js';
import { describeCollectible } from '../utils/collectibles.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import * as discoveryApi from '../api/discovery.api.js';

const ART = '/assets/art/';
const objectSrc = (id) => `${ART}objects/${id.replace(/^object\./, '')}.svg`;
const wallpaperSrc = (id) => `${ART}wallpapers/${id.replace(/^wallpaper\./, '')}.svg`;

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.filter(Boolean));
  return node;
}
function objectImage(id, className = 'desk-object-art') {
  const img = el('img', { className, src: objectSrc(id), alt: '', width: 160, height: 160, decoding: 'async', draggable: 'false' });
  return img;
}

const state = {
  owner: '',
  discoveries: false,
  collection: null,
  desk: {},
  available: [],
  picked: null,
  editing: false,
  saving: Promise.resolve(),
  context: { lessonInProgress: false, reviewedToday: false },
};
let scene;
let stage;
let tray;

// ---- Rendering ---------------------------------------------------------------------------

function applyAtmosphere() {
  const prefs = getUiPreferences();
  const theme = document.documentElement.dataset.theme;
  const look = resolveAtmosphere(prefs, { theme });
  scene.dataset.atmosphere = look.atmosphere.id;
  scene.dataset.decor = look.decoration;
  const window_ = stage.querySelector('[data-desk-window]');
  const pane = window_.querySelector('.desk-window-pane');
  const current = pane.querySelector('img');
  if (look.wallpaper) {
    if (current?.dataset.wallpaper !== look.wallpaper) {
      const img = el('img', { src: wallpaperSrc(look.wallpaper), alt: '', decoding: 'async' });
      img.dataset.wallpaper = look.wallpaper;
      pane.replaceChildren(img);
    }
    window_.dataset.wallpaper = 'on';
  } else {
    pane.replaceChildren();
    window_.dataset.wallpaper = 'off';
  }
  window_.querySelector('.desk-weather').dataset.motion = look.motion || 'none';
  const lumeSlot = stage.querySelector('[data-desk-lume]');
  if (look.outfit) lumeSlot.dataset.artOutfit = look.outfit;
  else delete lumeSlot.dataset.artOutfit;
  lumeSlot.dataset.artState = companionState(state.context);
}

function renderSlots() {
  for (const slot of DESK_SLOT_ORDER) {
    const host = stage.querySelector(`[data-desk-slot="${slot}"]`);
    if (!host) continue;
    const id = state.desk[slot];
    const holder = host.querySelector('.desk-slot-object');
    if ((holder?.dataset.objectId || '') !== (id || '')) {
      const next = el('span', { className: 'desk-slot-object' });
      next.dataset.objectId = id || '';
      if (id) next.append(objectImage(id));
      holder ? holder.replaceWith(next) : host.prepend(next);
    }
    host.dataset.filled = String(Boolean(id));
    const target = host.querySelector('.desk-slot-target');
    if (target) {
      const label = `${DESK_SLOT_LABELS[slot]}: ${id ? objectName(id) : 'vazio'}`;
      target.setAttribute('aria-label', state.picked ? `Colocar ${objectName(state.picked)} em ${DESK_SLOT_LABELS[slot].toLocaleLowerCase('pt-BR')}` : label);
      target.title = label;
      target.setAttribute('aria-pressed', String(Boolean(id) && state.picked === id));
    }
  }
  scene.querySelector('[data-desk-summary]').textContent = describeDesk(state.desk);
}

function renderTray() {
  const list = tray.querySelector('[data-desk-objects]');
  // The list is rebuilt: keep keyboard focus on the same object.
  const focused = document.activeElement?.closest?.('[data-desk-object]')?.dataset.deskObject;
  list.replaceChildren(
    ...state.available.map((id) => {
      const slot = slotOf(state.desk, id);
      const button = el(
        'button',
        { type: 'button', className: 'desk-tray-object', 'aria-pressed': String(state.picked === id) },
        objectImage(id, 'desk-tray-art'),
        el(
          'span',
          { className: 'desk-tray-copy' },
          el('strong', { text: objectName(id) }),
          el('small', { text: slot ? DESK_SLOT_LABELS[slot] : 'Na gaveta' }),
        ),
      );
      button.dataset.deskObject = id;
      return el('li', {}, button);
    }),
  );
  if (focused) list.querySelector(`[data-desk-object="${CSS.escape(focused)}"]`)?.focus();
  const storeButton = tray.querySelector('[data-desk-store]');
  storeButton.hidden = !(state.picked && slotOf(state.desk, state.picked));
  if (!storeButton.hidden) storeButton.textContent = `Guardar ${objectName(state.picked).toLocaleLowerCase('pt-BR')} na gaveta`;
  tray.querySelector('[data-desk-found-hint]').hidden = !state.discoveries || state.available.length > 4;
}

function render() {
  renderSlots();
  if (state.editing) renderTray();
  scene.dataset.picking = String(Boolean(state.picked));
}

function announce(text) {
  const box = tray.querySelector('[data-desk-status]');
  box.textContent = '';
  // A fresh node, so the same sentence twice is read again.
  requestAnimationFrame(() => (box.textContent = text));
}

// ---- Persistence -------------------------------------------------------------------------

async function persist(previous) {
  const { starters, items } = splitDesk(state.desk);
  const before = splitDesk(previous);
  if (JSON.stringify(starters) !== JSON.stringify(before.starters)) setUiPreference('deskStarters', starters);
  if (!state.discoveries || !state.collection) return true;
  if (JSON.stringify(items) === JSON.stringify(before.items)) return true;
  try {
    state.collection = await discoveryApi.saveDeskLayout({
      version: state.collection.layout.version,
      requestId: crypto.randomUUID(),
      items,
    });
    return true;
  } catch (failure) {
    announce(failure.message || 'Não foi possível salvar a mesa. Tente de novo.');
    if (failure.code === 'DISCOVERY_VERSION_CONFLICT') {
      state.collection = await discoveryApi.getCollection().catch(() => state.collection);
      state.desk = mergeDesk({ starters, items: state.collection.layout.items, available: state.available });
      render();
    }
    return false;
  }
}

function commit(next, message, placedSlot) {
  const previous = state.desk;
  state.desk = next;
  state.picked = null;
  render();
  if (placedSlot) {
    const art = stage.querySelector(`[data-desk-slot="${placedSlot}"] .desk-slot-object`);
    art?.classList.add('is-placed');
    setTimeout(() => art?.classList.remove('is-placed'), 520);
  }
  state.saving = state.saving.then(() => persist(previous)).then((ok) => ok && announce(message));
}

// ---- Interaction -------------------------------------------------------------------------

function pick(id) {
  state.picked = state.picked === id ? null : id;
  render();
  if (state.picked)
    announce(`${objectName(id)}: escolha um lugar na mesa. Esc cancela.`);
}

function dropOn(slot, id = state.picked) {
  if (!id) return;
  commit(placeObject(state.desk, id, slot), `${objectName(id)} em ${DESK_SLOT_LABELS[slot].toLocaleLowerCase('pt-BR')}. Mesa salva.`, slot);
  stage.querySelector(`[data-desk-slot="${slot}"] .desk-slot-target`)?.focus();
}

function store(id = state.picked) {
  if (!id) return;
  commit(removeObject(state.desk, id), `${objectName(id)} guardado na gaveta. Mesa salva.`);
  tray.querySelector(`[data-desk-object="${CSS.escape(id)}"]`)?.focus();
}

function onSlotActivate(slot) {
  const occupant = state.desk[slot];
  if (state.picked) dropOn(slot);
  else if (occupant) pick(occupant);
  else announce(`${DESK_SLOT_LABELS[slot]}: vazio. Escolha primeiro um objeto da gaveta.`);
}

function setEditing(on) {
  state.editing = on;
  state.picked = null;
  scene.dataset.editing = String(on);
  tray.hidden = !on;
  stage.setAttribute('aria-hidden', String(!on));
  for (const target of stage.querySelectorAll('.desk-slot-target')) {
    target.hidden = !on;
    target.tabIndex = on ? 0 : -1;
  }
  const toggle = scene.querySelector('[data-desk-arrange]');
  toggle.setAttribute('aria-expanded', String(on));
  render();
  if (on) tray.querySelector('.desk-tray-object')?.focus();
  else toggle.focus();
}

/** Pointer drag: a ghost follows the pointer; dropping on a place puts the object there. */
function wireDrag() {
  let drag = null;
  const source = (event) => {
    if (!state.editing) return null;
    const object = event.target.closest('[data-desk-object]');
    if (object) return object.dataset.deskObject;
    const target = event.target.closest('.desk-slot-target');
    if (target) return state.desk[target.closest('[data-desk-slot]').dataset.deskSlot] || null;
    return null;
  };
  scene.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const id = source(event);
    if (!id) return;
    drag = { id, x: event.clientX, y: event.clientY, ghost: null, origin: event.target.closest('button') };
  });
  window.addEventListener('pointermove', (event) => {
    if (!drag) return;
    if (!drag.ghost) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      drag.ghost = objectImage(drag.id, 'desk-drag-ghost');
      document.body.append(drag.ghost);
      scene.dataset.dragging = 'true';
      drag.origin?.setPointerCapture?.(event.pointerId);
    }
    drag.ghost.style.translate = `${event.clientX - 28}px ${event.clientY - 40}px`;
    const over = document.elementFromPoint(event.clientX, event.clientY)?.closest('.desk-slot-target');
    for (const node of stage.querySelectorAll('.desk-slot-target[data-over]')) if (node !== over) delete node.dataset.over;
    if (over) over.dataset.over = 'true';
  });
  window.addEventListener('pointerup', (event) => {
    if (!drag) return;
    const current = drag;
    drag = null;
    if (!current.ghost) return; // a tap: the click handler picks
    current.ghost.remove();
    delete scene.dataset.dragging;
    for (const node of stage.querySelectorAll('.desk-slot-target[data-over]')) delete node.dataset.over;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const target = hit?.closest('.desk-slot-target');
    if (target) dropOn(target.closest('[data-desk-slot]').dataset.deskSlot, current.id);
    else if (hit?.closest('[data-desk-tray]') && slotOf(state.desk, current.id)) store(current.id);
    // The click that follows a drag must not pick the object again.
    scene.dataset.justDragged = 'true';
    setTimeout(() => delete scene.dataset.justDragged, 0);
  });
}

function wire() {
  scene.querySelector('[data-desk-arrange]').addEventListener('click', () => setEditing(!state.editing));
  tray.querySelector('[data-desk-done]').addEventListener('click', () => setEditing(false));
  tray.querySelector('[data-desk-store]').addEventListener('click', () => store());
  scene.addEventListener('click', (event) => {
    if (scene.dataset.justDragged) return;
    const object = event.target.closest('[data-desk-object]');
    if (object) pick(object.dataset.deskObject);
    const target = event.target.closest('.desk-slot-target');
    if (target) onSlotActivate(target.closest('[data-desk-slot]').dataset.deskSlot);
  });
  scene.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !state.editing) return;
    event.preventDefault();
    if (state.picked) {
      const id = state.picked;
      state.picked = null;
      render();
      announce('Escolha cancelada.');
      tray.querySelector(`[data-desk-object="${CSS.escape(id)}"]`)?.focus();
    } else setEditing(false);
  });
  wireDrag();
  window.addEventListener('voz-ui-preferences-change', () => {
    applyAtmosphere();
    // Another device may have moved a starter object.
    const { items } = splitDesk(state.desk);
    state.desk = mergeDesk({ starters: getUiPreferences().deskStarters, items, available: state.available });
    render();
  });
}

/** A stamp pressed on the desk when the collection holds something new since the last visit. */
function showNewUnlocks() {
  const unlocks = state.collection?.unlocks || [];
  const key = `voz-seen-unlocks-v1:${state.owner}`;
  let seen;
  try {
    seen = JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    seen = null;
  }
  const ids = unlocks.map((u) => u.id);
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* the note just appears again next time */
  }
  if (!Array.isArray(seen)) return; // first visit on this device: nothing is "new"
  const fresh = unlocks.filter((u) => !seen.includes(u.id));
  if (!fresh.length) return;
  const first = fresh[0];
  const note = scene.querySelector('[data-desk-unlock]');
  note.replaceChildren(
    el('span', { className: 'desk-unlock-stamp', 'data-art-slot': first.kind, 'data-art-id': first.id, 'aria-hidden': 'true' }),
    el(
      'span',
      { className: 'desk-unlock-copy' },
      el('strong', { text: fresh.length > 1 ? `${fresh.length} novidades no Gabinete` : `Novo no Gabinete: ${describeCollectible(first.id).name}` }),
      el('a', { href: './gabinete.html', text: 'Abrir o Gabinete' }),
    ),
  );
  note.hidden = false;
}

function renderExpedition() {
  const box = document.querySelector('[data-desk-expedition]');
  if (!box || !state.discoveries || !state.collection) return;
  const counts = state.collection.counts || {};
  const found = state.collection.unlocks.length;
  const total = state.collection.catalog?.length || 0;
  box.querySelector('[data-expedition-text]').textContent =
    `${counts.investigations || 0} ${counts.investigations === 1 ? 'investigação concluída' : 'investigações concluídas'} · ${found} de ${total} itens no Gabinete`;
  box.hidden = false;
}

// ---- Public ------------------------------------------------------------------------------

/** Lume reacts to what is happening in the student's study (never to absence). */
export function setDeskContext(context) {
  state.context = { ...state.context, ...context };
  if (scene) applyAtmosphere();
}

export async function initDeskScene({ owner }) {
  scene = document.querySelector('[data-desk-scene]');
  if (!scene) return;
  stage = scene.querySelector('[data-desk-stage]');
  tray = scene.querySelector('[data-desk-tray]');
  state.owner = owner;
  for (const target of stage.querySelectorAll('.desk-slot-target')) {
    target.hidden = true;
    target.tabIndex = -1;
  }
  applyAtmosphere();
  state.available = availableObjects();
  state.desk = mergeDesk({ starters: getUiPreferences().deskStarters, available: state.available });
  render();
  wire();
  scene.dataset.ready = 'true';
  const flags = await getFeatureFlags().catch(() => ({}));
  state.discoveries = Boolean(flags.discoveries);
  if (!state.discoveries) return;
  try {
    state.collection = await discoveryApi.getCollection();
  } catch {
    return; // the starter desk keeps working
  }
  state.available = availableObjects({ unlocks: state.collection.unlocks, discoveries: true });
  state.desk = mergeDesk({
    starters: getUiPreferences().deskStarters,
    items: state.collection.layout?.items || [],
    available: state.available,
  });
  render();
  showNewUnlocks();
  renderExpedition();
}
