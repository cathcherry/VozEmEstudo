import { loadCloudState, saveCloudState, queueCloudState } from './profile-cloud.js';

/** Account whose preferences are currently stored in this browser's shared appearance keys. */
export const PREFERENCES_OWNER_KEY = 'voz-preferences-owner';

/**
 * Mirrors appearance/reading preferences to the account.
 * Local writes are flagged `voz-preferences-dirty` by theme-init's storage helper, even before
 * the session resolves. A dirty device pushes its values; a clean device pulls the account's.
 * This prevents a remote snapshot from silently undoing a change made moments earlier.
 *
 * Appearance keys are shared by every account that signs in on this browser, so the browser also
 * remembers which account they belong to. When a different account signs in, unsynced changes of
 * the previous account are parked under that account (pushed when it signs in again) and are
 * never written into the new account.
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
  const previousOwner = localStorage.getItem(PREFERENCES_OWNER_KEY);
  if (previousOwner && previousOwner !== owner && isDirty()) {
    queueCloudState(previousOwner, 'preferences', snapshot());
    localStorage.removeItem('voz-preferences-dirty');
  }
  localStorage.setItem(PREFERENCES_OWNER_KEY, owner);
  if (isDirty()) {
    ready = true;
    await push();
    return;
  }
  // Seed a new account with this browser's preferences only if they are not another account's.
  const seed = previousOwner && previousOwner !== owner ? null : snapshot();
  const remote = await loadCloudState(owner, 'preferences', seed);
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
