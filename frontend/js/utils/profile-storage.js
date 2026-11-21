import { getSupabase } from '../api/supabase-browser.js';
import { loadCloudState, saveCloudState } from './profile-cloud.js';
const DB_NAME = 'voz-profile-local-v1';
const STORE_NAME = 'media';
let databasePromise;

function database() {
  if (!('indexedDB' in window))
    return Promise.reject(new Error('Este navegador não oferece armazenamento local para imagens.'));
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento local.'));
    });
  }
  return databasePromise;
}

async function saveLocalMedia(userId, slot, blob) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, `${userId}:${slot}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Não foi possível salvar a imagem.'));
  });
}

async function readLocalMedia(userId, slot) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(`${userId}:${slot}`);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Não foi possível carregar a imagem.'));
  });
}

async function removeLocalMedia(userId, slot) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(`${userId}:${slot}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Não foi possível remover a imagem.'));
  });
}

export function profileBlocksKey(userId) {
  return `voz-profile-blocks-v1:${userId}`;
}

const pendingKey = (userId,slot) => `voz-media-pending:${userId}:${slot}`;
async function syncMedia(userId,slot) {
  const pending = localStorage.getItem(pendingKey(userId,slot));
  if (!pending) return;
  const client = await getSupabase();
  const bucket = client.storage.from('profile-media');
  const path = `${userId}/${slot}`;
  const result = pending === 'remove'
    ? await bucket.remove([path])
    : await bucket.upload(path,await readLocalMedia(userId,slot),{upsert:true,cacheControl:'0'});
  if (result.error) throw result.error;
  await saveCloudState(userId,`media-${slot}`,{ removed:pending === 'remove' });
  localStorage.removeItem(pendingKey(userId,slot));
}
function mediaStatus(ok) {
  window.dispatchEvent(new CustomEvent('profile-sync-status',{detail:ok ? 'Salvo na conta' : 'Imagem salva neste dispositivo · sincronização pendente'}));
}
export async function saveProfileMedia(userId,slot,blob) {
  await saveLocalMedia(userId,slot,blob);
  localStorage.setItem(pendingKey(userId,slot),'upload');
  try { await syncMedia(userId,slot); mediaStatus(true); } catch { mediaStatus(false); }
}
export async function removeProfileMedia(userId,slot) {
  await removeLocalMedia(userId,slot);
  localStorage.setItem(pendingKey(userId,slot),'remove');
  try { await syncMedia(userId,slot); mediaStatus(true); } catch { mediaStatus(false); }
}
export async function readProfileMedia(userId,slot) {
  try {
    await syncMedia(userId,slot);
    const state = await loadCloudState(userId,`media-${slot}`,null);
    if (state?.removed) { await removeLocalMedia(userId,slot); return null; }
    const client = await getSupabase();
    const {data,error} = await client.storage.from('profile-media').download(`${userId}/${slot}`);
    if (!error && data) { await saveLocalMedia(userId,slot,data); return data; }
    const local = await readLocalMedia(userId,slot);
    if (local && ['404','400'].includes(String(error?.statusCode))) await saveProfileMedia(userId,slot,local);
    return local;
  } catch { return readLocalMedia(userId,slot); }
}
/** This device's copy only (no network): for things shown on every page, like the wallpaper. */
export async function readLocalProfileMedia(userId, slot) {
  try {
    return await readLocalMedia(userId, slot);
  } catch {
    return null;
  }
}
