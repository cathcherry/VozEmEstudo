import { loadCloudState, saveCloudState, retryCloudState, registerCloudMerge } from './profile-cloud.js';
import { applyRemoteStudy, studyFor } from './study-store.js';
let activeOwner = '', timer;

const stamp = (entry) => Number(entry?.stateUpdatedAt || entry?.openedAt || 0);
/**
 * Per-lesson merge of two study histories: lessons known by either side are kept, the newer
 * record of each lesson wins field by field, and answers from both sides are combined. Used at
 * start-up and on every save, so a lesson recorded on another device is never dropped.
 */
export function mergeStudyHistory(remote, local) {
  const merged = { ...(remote || {}) };
  for (const [id, value] of Object.entries(local || {})) {
    const old = merged[id] || {};
    merged[id] = {
      ...(stamp(value) >= stamp(old) ? { ...old, ...value } : { ...value, ...old }),
      answers: { ...(old.answers || {}), ...(value?.answers || {}) },
    };
  }
  return merged;
}
registerCloudMerge('study-history', mergeStudyHistory);
export async function initProfileStudySync(owner) {
  if (activeOwner === owner) return;
  activeOwner = owner;
  let local;
  try { local = JSON.parse(localStorage.getItem(`voz-study-v1:${owner}`) || '{}'); } catch { local = {}; }
  const remote = await loadCloudState(owner,'study-history',null);
  const merged = mergeStudyHistory(remote, local);
  for (const [id,value] of Object.entries(merged)) applyRemoteStudy(id,value);
  await saveCloudState(owner,'study-history',merged);
  const persist = () => {
    const snapshot = {};
    for (const id of Object.keys(merged)) snapshot[id] = studyFor(id);
    return saveCloudState(owner,'study-history',snapshot);
  };
  window.addEventListener('study-state-changed', (event) => {
    if (event.detail.owner !== owner || activeOwner !== owner) return;
    merged[event.detail.id] = event.detail.snapshot;
    clearTimeout(timer); timer = setTimeout(persist,1200);
  });
  window.addEventListener('online', () => { if(activeOwner === owner) void retryCloudState(owner); });
  window.addEventListener('pagehide', () => { if(activeOwner === owner) void persist(); });
}
