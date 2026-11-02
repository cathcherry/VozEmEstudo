import { errors } from '../domain/errors.js';

/** A public configuration response may contain only a publishable or anon key. */
export function assertPublicSupabaseKey(key) {
  // Empty configuration remains usable for public pages and setup diagnostics.
  if (!key || key.startsWith('sb_publishable_')) return;
  if (key.startsWith('eyJ')) {
    try {
      const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
      if (claims.role === 'anon') return;
    } catch {
      // Invalid JWT metadata must not be echoed in a response or log.
    }
  }
  throw errors.configuration(['SUPABASE_PUBLISHABLE_KEY']);
}
