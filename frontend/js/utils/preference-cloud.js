import {
  loadCloudState,
  saveCloudState,
  queueCloudState,
  cachedCloudState,
} from './profile-cloud.js';

/** Account whose preferences are currently stored in this browser's shared appearance keys. */
export const PREFERENCES_OWNER_KEY = 'voz-preferences-owner';
/** Preferences chosen while signed out (the device's own), restored when an account leaves. */
export const DEVICE_PREFERENCES_KEY = 'voz-preferences-device';
// Needs that must keep working on the sign-in page even if never chosen there.
const ACCESSIBILITY_FIELDS = [
  'textSize',
  'highContrast',
  'reducedMotion',
  'screenReaderMode',
  'readingFont',
  'readableFont',
  'lowStimulation',
  'readingSpacing',
];

/**
 * Puts the device preferences back in the shared appearance keys (without marking them as an
 * account change). Without a device copy yet, only accessibility needs stay; theme, language,
 * density and the rest go back to the defaults, so the next person never inherits them.
 */
export function applyDevicePreferences({ notify = true } = {}) {
  const appearance = window.VozAppearance;
  if (!appearance) return;
  let device;
  try {
    device = JSON.parse(localStorage.getItem(DEVICE_PREFERENCES_KEY) || 'null');
  } catch {
    device = null;
  }
  if (!device) {
    const ui = appearance.loadUi();
    const kept = Object.fromEntries(
      ACCESSIBILITY_FIELDS.filter((key) => key in ui).map((key) => [key, ui[key]]),
    );
    device = { 'audioestudo-ui-preferences': JSON.stringify(kept) };
    localStorage.setItem(DEVICE_PREFERENCES_KEY, JSON.stringify(device));
  }
  for (const key of appearance.syncedKeys) {
    if (typeof device[key] === 'string') localStorage.setItem(key, device[key]);
    else localStorage.removeItem(key);
  }
  localStorage.removeItem('voz-active-theme-profile');
  // When the page is about to leave (sign out), it is not refreshed for the new look.
  if (notify) window.dispatchEvent(new Event('voz-preferences-change'));
}

/**
 * Called when an account leaves this browser (sign out, or a signed-out page finds a previous
 * owner): unsynced preference changes are kept for that account and pushed when it returns;
 * the shared keys go back to the device preferences.
 */
export function releaseAccountPreferences({ notify = true } = {}) {
  const owner = localStorage.getItem(PREFERENCES_OWNER_KEY);
  if (!owner) return;
  const appearance = window.VozAppearance;
  if (appearance && localStorage.getItem('voz-preferences-dirty') === 'true') {
    const keys = [...appearance.syncedKeys, `voz-theme-profiles-v1:${owner}`];
    queueCloudState(
      owner,
      'preferences',
      Object.fromEntries(
        keys
          .filter((key) => localStorage.getItem(key) !== null)
          .map((key) => [key, localStorage.getItem(key)]),
      ),
    );
  }
  localStorage.removeItem('voz-preferences-dirty');
  localStorage.removeItem(PREFERENCES_OWNER_KEY);
  applyDevicePreferences({ notify });
}

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
  if (previousOwner && previousOwner !== owner) {
    // Another account was here: its unsynced changes wait for it, and this account starts from
    // the device preferences, never from the other account's look or language.
    releaseAccountPreferences();
  }
  localStorage.setItem(PREFERENCES_OWNER_KEY, owner);
  if (isDirty()) {
    ready = true;
    await push();
    return;
  }
  // A new account starts from this device's preferences (the shared keys hold no other
  // account's choices at this point).
  const seed = snapshot();
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

/**
 * Right after signing in: if this browser already knows the account's preferences, apply them
 * before the next page loads, so the device look does not flash first. The account copy is
 * still fetched by initPreferenceCloud and wins if it is newer.
 */
export function applyCachedAccountPreferences(owner) {
  const appearance = window.VozAppearance;
  const cached = cachedCloudState(owner, 'preferences');
  if (!appearance || !owner) return false;
  const previous = localStorage.getItem(PREFERENCES_OWNER_KEY);
  if (previous && previous !== owner) releaseAccountPreferences();
  if (!cached || typeof cached !== 'object') return false;
  for (const key of appearance.syncedKeys)
    if (typeof cached[key] === 'string') localStorage.setItem(key, cached[key]);
  localStorage.setItem(PREFERENCES_OWNER_KEY, owner);
  return true;
}
