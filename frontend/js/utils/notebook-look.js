// Cover and paper of each lesson notebook (3.6). The notebook body (Notes 3.0) is validated
// strictly by the server (`title` and `doc` only), so the look is NOT stored in it: it lives in
// the account's synced preferences (profile_state, key 'notebook-looks'), keyed by lesson id:
//   { [materialId]: { cover: 'cover.*', paper: 'ruled|grid|…', at: ISO time } }
// Nothing about existing notebook data changes; a lesson without an entry gets the default look.
import { cachedCloudState, loadCloudState, registerCloudMerge, saveCloudState } from './profile-cloud.js';
import { COVER_CHOICES, DEFAULT_COVER, PAPER_IDS } from './scrapbook.js';

export const NOTEBOOK_LOOKS_KEY = 'notebook-looks';
export const DEFAULT_LOOK = Object.freeze({ cover: DEFAULT_COVER, paper: 'ruled' });

/** Per lesson, the most recent choice wins (two devices may each change a different notebook). */
export function mergeLooks(remote, local) {
  const out = { ...(remote || {}) };
  for (const [id, look] of Object.entries(local || {}))
    if (!out[id] || String(look?.at || '') >= String(out[id]?.at || '')) out[id] = look;
  return out;
}
registerCloudMerge(NOTEBOOK_LOOKS_KEY, mergeLooks);

/** A valid look (unknown values fall back to the default, never to arbitrary strings). */
export function normalizeLook(look) {
  return {
    cover: COVER_CHOICES.includes(look?.cover) ? look.cover : DEFAULT_LOOK.cover,
    paper: PAPER_IDS.includes(look?.paper) ? look.paper : DEFAULT_LOOK.paper,
  };
}

/** This browser's copy at once (no network), for the first paint. */
export function cachedLook(owner, materialId) {
  if (!owner || owner === 'anon') return { ...DEFAULT_LOOK };
  return normalizeLook(cachedCloudState(owner, NOTEBOOK_LOOKS_KEY)?.[materialId]);
}

export async function loadLook(owner, materialId) {
  if (!owner || owner === 'anon') return { ...DEFAULT_LOOK };
  const all = await loadCloudState(owner, NOTEBOOK_LOOKS_KEY, null).catch(() => null);
  return normalizeLook(all?.[materialId]);
}

export async function saveLook(owner, materialId, look) {
  if (!owner || owner === 'anon') return false;
  const all = { ...(cachedCloudState(owner, NOTEBOOK_LOOKS_KEY) || {}) };
  all[materialId] = { ...normalizeLook(look), at: new Date().toISOString() };
  return saveCloudState(owner, NOTEBOOK_LOOKS_KEY, all);
}
