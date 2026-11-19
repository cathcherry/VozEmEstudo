import { loadCloudState, saveCloudState } from './profile-cloud.js';

/**
 * Mirrors appearance/reading preferences to the account.
 * Local writes are flagged `voz-preferences-dirty` by theme-init's storage helper, even before
 * the session resolves. A dirty device pushes its values; a clean device pulls the account's.
 * This prevents a remote snapshot from silently undoing a change made moments earlier.
 */
export async function initPreferenceCloud(owner) {
  const appearance = window.VozAppearance;
  if (!appearance) return;
  const keys = [...appearance.syncedKeys, `voz-theme-profiles-v1:${owner}`];
  const snapshot = () =>
    Object.fromEntries(
      keys
        .filter((key) => localStorage.getItem(key) !== null)
        .map((key) => [key, localStorage.getItem(key)]),
    );
  const isDirty = () => localStorage.getItem('voz-preferences-dirty') === 'true';
  const push = async () => {
    if (await saveCloudState(owner, 'preferences', snapshot()))
      localStorage.removeItem('voz-preferences-dirty');
  };
  let ready = false;
  const original = appearance.storage.set.bind(appearance.storage);
  appearance.storage.set = (key, value) => {
    const result = original(key, value);
    if (ready && keys.includes(key)) void push();
    return result;
  };
  if (isDirty()) {
    ready = true;
    await push();
    return;
  }
  const remote = await loadCloudState(owner, 'preferences', snapshot());
  ready = true;
  // A change made while the request was in flight wins over the older remote snapshot.
  if (isDirty()) {
    await push();
    return;
  }
  let changed = false;
  for (const key of keys)
    if (typeof remote?.[key] === 'string' && localStorage.getItem(key) !== remote[key]) {
      localStorage.setItem(key, remote[key]);
      changed = true;
    }
  if (changed) window.dispatchEvent(new Event('voz-preferences-change'));
}
