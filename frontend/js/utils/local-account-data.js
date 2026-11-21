// What this browser keeps for one account, and how to remove only that. Account data in the
// browser is always namespaced by the user id; device preferences (appearance before signing in)
// and other accounts' data are never touched. Unsynchronized changes are reported so they are
// never deleted silently.

const accountPrefixes = (owner) => [`voz-cloud-v1:${owner}:`, `voz-media-pending:${owner}:`];
const accountKeys = (owner) => [
  `voz-study-v1:${owner}`,
  `voz-study-outbox-v1:${owner}`,
  `voz-profile-blocks-v1:${owner}`,
  `voz-theme-profiles-v1:${owner}`,
  // Focar session, utility panel layout and ambient sound choices.
  `voz-focus-v1:${owner}`,
  `voz-utility-v1:${owner}`,
  `voz-ambient-v1:${owner}`,
];
const PROFILE_DB = 'voz-profile-local-v1';
const PROFILE_STORE = 'media';

function storageKeys() {
  try {
    return Object.keys(localStorage);
  } catch {
    return [];
  }
}
function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

/** Keys of this account kept in localStorage. */
export function accountStorageKeys(owner) {
  if (!owner) return [];
  const exact = new Set(accountKeys(owner));
  const prefixes = accountPrefixes(owner);
  return storageKeys().filter(
    (key) => exact.has(key) || prefixes.some((prefix) => key.startsWith(prefix)),
  );
}

/**
 * Changes made in this browser that the account has not received yet: pending profile_state
 * keys, queued study updates and images waiting to upload.
 */
export function pendingAccountChanges(owner) {
  if (!owner) return [];
  const pending = [];
  for (const key of storageKeys()) {
    if (key.startsWith(`voz-cloud-v1:${owner}:`) && read(key)?.pending)
      pending.push({ kind: 'preferences', key: key.slice(`voz-cloud-v1:${owner}:`.length) });
    if (key.startsWith(`voz-media-pending:${owner}:`)) pending.push({ kind: 'media', key });
  }
  const outbox = read(`voz-study-outbox-v1:${owner}`);
  const queued = Array.isArray(outbox)
    ? outbox.length
    : outbox && typeof outbox === 'object'
      ? Object.keys(outbox).length
      : 0;
  if (queued) pending.push({ kind: 'study', key: 'study-outbox', count: queued });
  return pending;
}

async function removeProfileImages(owner) {
  if (!('indexedDB' in window)) return 0;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(PROFILE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(PROFILE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      let removed = 0;
      const tx = db.transaction(PROFILE_STORE, 'readwrite');
      const cursor = tx.objectStore(PROFILE_STORE).openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        if (String(item.key).startsWith(`${owner}:`)) {
          item.delete();
          removed += 1;
        }
        item.continue();
      };
      tx.oncomplete = () => resolve(removed);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Removes this account's copies from the browser. Refuses when there are unsynchronized changes
 * unless `{ discardPending: true }` is passed after the person confirmed losing them.
 * Returns what was removed.
 */
export async function removeAccountLocalData(owner, { discardPending = false } = {}) {
  if (!owner) throw new Error('Nenhuma conta para limpar.');
  const pending = pendingAccountChanges(owner);
  if (pending.length && !discardPending) {
    const error = new Error('Há alterações ainda não sincronizadas com a conta.');
    error.code = 'PENDING_CHANGES';
    error.pending = pending;
    throw error;
  }
  const keys = accountStorageKeys(owner);
  for (const key of keys) localStorage.removeItem(key);
  if (localStorage.getItem('voz-preferences-owner') === owner)
    localStorage.removeItem('voz-preferences-owner');
  let images = 0;
  try {
    images = await removeProfileImages(owner);
  } catch {
    /* Images stay if the local database is unavailable; the keys above are already removed. */
  }
  return { keys: keys.length, images };
}
