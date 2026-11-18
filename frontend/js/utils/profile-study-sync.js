import { loadCloudState, saveCloudState, retryCloudState } from './profile-cloud.js';
import { applyRemoteStudy, studyFor } from './study-store.js';
let activeOwner = '', timer;
export async function initProfileStudySync(owner) {
  if (activeOwner === owner) return;
  activeOwner = owner;
  let local = {};
  try { local = JSON.parse(localStorage.getItem(`voz-study-v1:${owner}`) || '{}'); } catch { local = {}; }
  const remote = await loadCloudState(owner,'study-history',null);
  const merged = {...(remote || {})};
  for (const [id,value] of Object.entries(local)) {
    const old = merged[id] || {};
    merged[id] = { ...(Number(value.stateUpdatedAt || value.openedAt || 0) >= Number(old.stateUpdatedAt || old.openedAt || 0) ? {...old,...value} : {...value,...old}), answers:{...(old.answers || {}),...(value.answers || {})} };
  }
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
