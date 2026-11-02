import { createClient } from '@supabase/supabase-js';
import { env } from '../../config/env.js';
import { errors } from '../../domain/errors.js';

let client;

export function getAdminSupabase() {
  if (!env.supabaseUrl || !env.supabaseSecretKey) {
    throw errors.configuration(['SUPABASE_URL', 'SUPABASE_SECRET_KEY']);
  }
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
