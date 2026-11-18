import { getSupabase } from '../api/supabase-browser.js';
const queues = new Map();
const cacheKey = (owner, key) => `voz-cloud-v1:${owner}:${key}`;
function cached(owner, key) {
  try { return JSON.parse(localStorage.getItem(cacheKey(owner, key)) || 'null'); } catch { return null; }
}
function status(ok) {
  window.dispatchEvent(new CustomEvent('profile-sync-status', { detail:ok ? 'Salvo na conta' : 'Salvo neste dispositivo · sincronização pendente' }));
}
export async function saveCloudState(owner, key, data) {
  const previous = queues.get(`${owner}:${key}`) || Promise.resolve();
  const entry = { data, pending:true, token:crypto.randomUUID() };
  localStorage.setItem(cacheKey(owner, key), JSON.stringify(entry));
  const task = previous.catch(() => {}).then(async () => {
    try {
      const client = await getSupabase();
      const { error } = await client.from('profile_state').upsert({ user_id:owner, key, data, updated_at:new Date().toISOString() });
      if (error) throw error;
      if (cached(owner,key)?.token === entry.token) localStorage.setItem(cacheKey(owner,key), JSON.stringify({...entry,pending:false}));
      status(true); return true;
    } catch { status(false); return false; }
  });
  queues.set(`${owner}:${key}`, task);
  return task;
}
export async function loadCloudState(owner, key, fallback = null) {
  const local = cached(owner,key);
  if (local?.pending) { await saveCloudState(owner,key,local.data); return local.data; }
  try {
    const client = await getSupabase();
    const { data, error } = await client.from('profile_state').select('data').eq('user_id',owner).eq('key',key).maybeSingle();
    if (error) throw error;
    if (data) { localStorage.setItem(cacheKey(owner,key),JSON.stringify({data:data.data,pending:false})); return data.data; }
    if (fallback !== null) await saveCloudState(owner,key,fallback);
    return fallback;
  } catch { status(false); return local?.data ?? fallback; }
}
export async function retryCloudState(owner) {
  const prefix = `voz-cloud-v1:${owner}:`;
  for (const key of Object.keys(localStorage).filter(candidateKey => candidateKey.startsWith(prefix))) {
    const entry = cached(owner,key.slice(prefix.length));
    if (entry?.pending) await saveCloudState(owner,key.slice(prefix.length),entry.data);
  }
}
