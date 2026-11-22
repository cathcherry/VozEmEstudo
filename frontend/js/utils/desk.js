// The desk on Início (3.5, Milestone 5): pure rules shared by the page and the unit tests.
// Objects are art ids (`object.teacup`); places are the server's slot names. Starter objects are
// for everyone and live in the account's appearance preferences; collectible objects come only
// from verified learning events (GET /api/collection) and are placed with
// PUT /api/collection/layout. Nothing here talks to the network or the DOM.

/** Slot names, in reading order of the scene (desk first, then the wall). */
export const DESK_SLOT_ORDER = Object.freeze([
  'lamp-corner',
  'desk-left',
  'desk-center',
  'desk-right',
  'shelf-left',
  'shelf-right',
  'window',
  'wall',
]);

export const DESK_SLOT_LABELS = Object.freeze({
  'lamp-corner': 'Canto da luminária',
  'desk-left': 'Mesa, à esquerda',
  'desk-center': 'Mesa, ao centro',
  'desk-right': 'Mesa, à direita',
  'shelf-left': 'Prateleira, à esquerda',
  'shelf-right': 'Prateleira, à direita',
  window: 'Janela',
  wall: 'Parede',
});

/** Everyday desk things anyone may place. Not collectibles: never a reward. */
export const STARTER_OBJECTS = Object.freeze([
  'object.teacup',
  'object.inkwell',
  'object.cactus',
  'object.hourglass',
]);

export const OBJECT_NAMES = Object.freeze({
  'object.teacup': 'Xícara de chá',
  'object.inkwell': 'Tinteiro',
  'object.cactus': 'Cacto',
  'object.hourglass': 'Ampulheta',
  'object.magnifying-glass': 'Lupa',
  'object.desk-lamp': 'Luminária de mesa',
  'object.specimen-box': 'Pote de espécimes',
  'object.pressed-flower-jar': 'Flor prensada',
  'object.globe': 'Globo',
});
export const objectName = (id) => OBJECT_NAMES[id] || 'Objeto';

const isStarter = (id) => STARTER_OBJECTS.includes(id);

/**
 * Lume on the desk. Never sad: at night it naps; after a lesson marked as studied today it is
 * happy; with a lesson in progress it reads; otherwise it rests (idle).
 */
export function companionState({ now = new Date(), lessonInProgress = false, reviewedToday = false } = {}) {
  const hour = now.getHours();
  if (hour >= 22 || hour < 6) return 'sleepy';
  if (reviewedToday) return 'happy';
  if (lessonInProgress) return 'reading';
  return 'idle';
}

/** True when the timestamp (ms or ISO) falls on the same local day as `now`. */
export function isToday(value, now = new Date()) {
  if (!value) return false;
  const date = new Date(value);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/**
 * The objects the student may place: starters, plus collectible objects the server says were
 * unlocked (only when the discoveries feature is on). Locked or unknown ids never appear.
 */
export function availableObjects({ unlocks = [], discoveries = false } = {}) {
  const found = discoveries
    ? unlocks.filter((u) => u?.kind === 'object' && typeof u.id === 'string' && u.id.startsWith('object.')).map((u) => u.id)
    : [];
  // A collectible unlocked twice (or listed twice by the server) is still one object.
  return [...new Set([...STARTER_OBJECTS, ...found.filter((id) => !isStarter(id))])];
}

/** What is in the drawer: the objects the student may place that are not on the desk. */
export function drawerObjects(desk, available) {
  const placed = new Set(Object.values(desk || {}));
  return available.filter((id) => !placed.has(id));
}

/**
 * Slot choices for one object in a form (the Gabinete's "Sua mesa"): every place, saying who is
 * there now. Choosing a taken place moves that object (see placeObject).
 */
export function slotChoices(desk, id) {
  return DESK_SLOT_ORDER.map((slot) => {
    const occupant = desk[slot] || null;
    return {
      slot,
      label: DESK_SLOT_LABELS[slot],
      occupant: occupant && occupant !== id ? occupant : null,
      current: occupant === id,
    };
  });
}

/**
 * One desk (slot → object id) from the two stores. Unknown slots, objects that may not be placed,
 * and a second object in a taken slot are dropped; collectible placements win over starters.
 */
export function mergeDesk({ starters = {}, items = [], available = STARTER_OBJECTS } = {}) {
  const desk = {};
  const used = new Set();
  const put = (slot, id) => {
    if (!DESK_SLOT_ORDER.includes(slot) || !available.includes(id) || used.has(id)) return;
    if (desk[slot]) used.delete(desk[slot]);
    desk[slot] = id;
    used.add(id);
  };
  for (const [slot, id] of Object.entries(starters || {})) if (isStarter(id)) put(slot, id);
  for (const item of items || []) if (!isStarter(item?.objectId)) put(item?.slot, item?.objectId);
  return desk;
}

export const slotOf = (desk, id) => Object.keys(desk).find((slot) => desk[slot] === id) || null;

/**
 * Places `id` in `slot`. Moving an object already on the desk onto a taken slot swaps the two;
 * an object coming from the drawer sends the previous occupant back to the drawer.
 */
export function placeObject(desk, id, slot) {
  if (!DESK_SLOT_ORDER.includes(slot)) return { ...desk };
  const next = { ...desk };
  const from = slotOf(next, id);
  const occupant = next[slot];
  if (from) delete next[from];
  if (occupant && occupant !== id && from) next[from] = occupant;
  next[slot] = id;
  return next;
}

export function removeObject(desk, id) {
  const next = { ...desk };
  const from = slotOf(next, id);
  if (from) delete next[from];
  return next;
}

/** Splits a desk into what each store keeps. */
export function splitDesk(desk) {
  const starters = {};
  const items = [];
  for (const slot of DESK_SLOT_ORDER) {
    const id = desk[slot];
    if (!id) continue;
    if (isStarter(id)) starters[slot] = id;
    else items.push({ slot, objectId: id });
  }
  return { starters, items };
}

/** A sentence for assistive technology: what is on the desk now. */
export function describeDesk(desk) {
  const parts = DESK_SLOT_ORDER.filter((slot) => desk[slot]).map(
    (slot) => `${objectName(desk[slot])} (${DESK_SLOT_LABELS[slot].toLocaleLowerCase('pt-BR')})`,
  );
  return parts.length ? `Na sua mesa: ${parts.join(', ')}.` : 'A mesa está vazia.';
}
