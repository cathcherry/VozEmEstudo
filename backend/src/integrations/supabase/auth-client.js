import { createClient } from '@supabase/supabase-js';
import { env } from '../../config/env.js';
import { errors } from '../../domain/errors.js';

let verifier;

function getVerifier() {
  if (!env.supabaseUrl || !env.supabasePublishableKey) {
    throw errors.configuration(['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']);
  }
  if (!verifier) {
    verifier = createClient(env.supabaseUrl, env.supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return verifier;
}

export async function verifyAccessToken(token) {
  const { data, error } = await getVerifier().auth.getUser(token);
  if (error || !data?.user) throw errors.authRequired();
  return data.user;
}
