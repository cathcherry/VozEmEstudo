/**
 * Per-account key/value documents in `profile_state`, written directly by the browser.
 * Row-level security limits every read and write to the signed-in account (user_id = auth.uid()).
 *
 * Each write is a compare-and-set on `updated_at`, so a stale device never blindly overwrites a
 * newer account copy:
 *  - keys with a registered merge (study history, folder icons) re-read the account copy and
 *    combine both before writing;
 *  - other keys keep the most recent edit, judged by when the edit was made (not when it reached
 *    the server): an older offline edit loses to a newer one from another device.
 * A failed write stays in this browser as "pending" and is retried later; it is never dropped.
 */
import { getSupabase } from '../api/supabase-browser.js';

const queues = new Map();
const merges = new Map();
const MAX_ATTEMPTS = 3;
let clientFactory = getSupabase;

/** Test hook: replaces the Supabase client factory. */
export function configureProfileCloud({ getClient } = {}) {
  clientFactory = getClient || getSupabase;
}

/** Declares how two copies of a key are combined, e.g. union of per-lesson records. */
export function registerCloudMerge(key, merge) {
  merges.set(key, merge);
}

const cacheKey = (owner, key) => `voz-cloud-v1:${owner}:${key}`;
function cached(owner, key) {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(owner, key)) || 'null');
  } catch {
    return null;
  }
}
function remember(owner, key, entry) {
  try {
    localStorage.setItem(cacheKey(owner, key), JSON.stringify(entry));
  } catch {
    /* Full or blocked storage: the account copy remains the source of truth. */
  }
}
function status(ok) {
  window.dispatchEvent(
    new CustomEvent('profile-sync-status', {
      detail: ok ? 'Salvo na conta' : 'Salvo neste dispositivo · sincronização pendente',
    }),
  );
}
const time = (value) => Date.parse(value || '') || 0;

/** One compare-and-set round trip. Returns the value now stored in the account. */
async function writeEntry(owner, key, entry) {
  const client = await clientFactory();
  const table = () => client.from('profile_state');
  const merge = merges.get(key);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { data: remote, error } = await table()
      .select('data,updated_at')
      .eq('user_id', owner)
      .eq('key', key)
      .maybeSingle();
    if (error) throw error;
    if (!remote) {
      const inserted = await table().insert({
        user_id: owner,
        key,
        data: entry.data,
        updated_at: entry.editedAt,
      });
      if (!inserted.error) return entry.data;
      if (inserted.error.code === '23505') continue; // Another device created it first.
      throw inserted.error;
    }
    let next;
    let stamp;
    if (merge) {
      next = merge(remote.data, entry.data);
      stamp = new Date(Math.max(Date.now(), time(remote.updated_at) + 1)).toISOString();
    } else {
      // The account already holds a newer edit: keep it instead of overwriting.
      if (time(remote.updated_at) > time(entry.editedAt)) return remote.data;
      next = entry.data;
      stamp = entry.editedAt;
    }
    const updated = await table()
      .update({ data: next, updated_at: stamp })
      .eq('user_id', owner)
      .eq('key', key)
      .eq('updated_at', remote.updated_at)
      .select('updated_at');
    if (updated.error) throw updated.error;
    if (updated.data?.length) return next;
    // Someone else wrote between the read and the update: read again.
  }
  throw new Error('profile_state: escrita concorrente persistente');
}

function sync(owner, key, entry) {
  const queueKey = `${owner}:${key}`;
  const previous = queues.get(queueKey) || Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(async () => {
      try {
        const stored = await writeEntry(owner, key, entry);
        // A newer local edit made meanwhile keeps its own pending entry.
        if (cached(owner, key)?.token === entry.token)
          remember(owner, key, { data: stored, pending: false, editedAt: entry.editedAt });
        status(true);
        return true;
      } catch {
        status(false);
        return false;
      }
    });
  queues.set(queueKey, task);
  return task;
}

/** Saves locally at once (pending) and then to the account. Resolves true when synchronized. */
export async function saveCloudState(owner, key, data) {
  const entry = {
    data,
    pending: true,
    token: crypto.randomUUID(),
    editedAt: new Date().toISOString(),
  };
  remember(owner, key, entry);
  return sync(owner, key, entry);
}

/**
 * Records an edit for `owner` in this browser only, without contacting the server. It is pushed
 * the next time that account loads or retries this key (used when another account signs in).
 */
export function queueCloudState(owner, key, data) {
  remember(owner, key, {
    data,
    pending: true,
    token: crypto.randomUUID(),
    editedAt: new Date().toISOString(),
  });
}

/** Account copy (after pushing any pending local edit), the local copy offline, or fallback. */
export async function loadCloudState(owner, key, fallback = null) {
  const local = cached(owner, key);
  if (local?.pending) {
    // Older caches have no edit time; treat them as made now so they are not lost.
    const entry = { ...local, editedAt: local.editedAt || new Date().toISOString() };
    if (!local.editedAt) remember(owner, key, entry);
    await sync(owner, key, entry);
    return cached(owner, key)?.data ?? local.data;
  }
  try {
    const client = await clientFactory();
    const { data, error } = await client
      .from('profile_state')
      .select('data,updated_at')
      .eq('user_id', owner)
      .eq('key', key)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      remember(owner, key, { data: data.data, pending: false, editedAt: data.updated_at });
      return data.data;
    }
    if (fallback !== null) await saveCloudState(owner, key, fallback);
    return fallback;
  } catch {
    status(false);
    return local?.data ?? fallback;
  }
}

/** Retries every pending key of this account (e.g. when the browser comes back online). */
export async function retryCloudState(owner) {
  const prefix = `voz-cloud-v1:${owner}:`;
  for (const name of Object.keys(localStorage).filter((candidate) =>
    candidate.startsWith(prefix),
  )) {
    const key = name.slice(prefix.length);
    const entry = cached(owner, key);
    if (entry?.pending)
      await sync(owner, key, { ...entry, editedAt: entry.editedAt || new Date().toISOString() });
  }
}
