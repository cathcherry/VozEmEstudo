// Thematic collections the student makes in the Arquivo de Descobertas (3.6, Milestone E). They
// are only a way of ORGANIZING: a name and the ids of discoveries the student put in it. Stored
// with the account's appearance preferences (`discoveryCollections`, synced like the desk
// starters), so no migration is needed. A discovery may be in several collections; deleting a
// collection never touches a discovery. Pure: no DOM, no storage.

export const COLLECTION_LIMIT = 24;
export const COLLECTION_ITEMS_LIMIT = 200;
export const COLLECTION_NAME_MAX = 60;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^c-[a-z0-9]{1,24}$/;

const cleanName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, COLLECTION_NAME_MAX);

/** Valid collections only (same rules as theme-init's normalizeUi): bad entries are dropped. */
export function normalizeCollections(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of value) {
    if (result.length >= COLLECTION_LIMIT) break;
    const id = String(entry?.id || '');
    const name = cleanName(entry?.name);
    if (!KEY.test(id) || seen.has(id) || !name) continue;
    seen.add(id);
    const ids = [...new Set((Array.isArray(entry.ids) ? entry.ids : []).filter((x) => typeof x === 'string' && ID.test(x)))];
    result.push({ id, name, ids: ids.slice(0, COLLECTION_ITEMS_LIMIT) });
  }
  return result;
}

/** A new collection (name required; the same name twice is refused, ignoring case). */
export function createCollection(collections, name, makeId = () => Math.random().toString(36).slice(2, 12)) {
  const list = normalizeCollections(collections);
  const clean = cleanName(name);
  if (!clean) return { collections: list, error: 'Dê um nome à coleção.' };
  if (list.length >= COLLECTION_LIMIT) return { collections: list, error: `Você chegou ao limite de ${COLLECTION_LIMIT} coleções.` };
  if (list.some((c) => c.name.toLocaleLowerCase('pt-BR') === clean.toLocaleLowerCase('pt-BR')))
    return { collections: list, error: 'Já existe uma coleção com esse nome.' };
  const created = { id: `c-${String(makeId()).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || 'x'}`, name: clean, ids: [] };
  return { collections: [...list, created], created };
}

/** Puts a discovery in a collection, or takes it out (`inside` = the wanted state). */
export function setMembership(collections, collectionId, discoveryId, inside) {
  return normalizeCollections(collections).map((c) => {
    if (c.id !== collectionId) return c;
    const ids = c.ids.filter((x) => x !== discoveryId);
    if (inside && ID.test(discoveryId) && ids.length < COLLECTION_ITEMS_LIMIT) ids.push(discoveryId);
    return { ...c, ids };
  });
}

export const removeCollection = (collections, collectionId) =>
  normalizeCollections(collections).filter((c) => c.id !== collectionId);

/** The discoveries of a collection that still exist, in the archive's order. */
export function collectionItems(collection, rows = []) {
  const ids = new Set(collection?.ids || []);
  return rows.filter((row) => ids.has(row.id));
}
