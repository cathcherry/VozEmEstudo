import { createClient } from '../vendor/supabase.min.js';
import { getPublicConfig } from './config.js';

let client;

export async function getSupabase() {
  if (client) return client;
  const config = await getPublicConfig();
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    throw new Error('Preencha SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no arquivo .env do servidor.');
  }
  client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
  });
  return client;
}
