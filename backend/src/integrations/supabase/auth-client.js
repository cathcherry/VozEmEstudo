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

/** The fields the API reads from `req.user`, rebuilt from verified JWT claims. */
export function userFromClaims(claims) {
  if (!claims?.sub || claims.role !== 'authenticated') return null;
  return {
    id: claims.sub,
    email: claims.email || null,
    role: claims.role,
    app_metadata: claims.app_metadata || {},
    user_metadata: claims.user_metadata || {},
    is_anonymous: Boolean(claims.is_anonymous),
  };
}

/**
 * Accounts the API refuses even with a valid token: anonymous sign-ins (if ever enabled in the
 * project) and e-mail/password accounts whose address was never confirmed. Supabase does not
 * issue sessions to unconfirmed accounts while "Confirm email" is on; this keeps the API closed
 * if that dashboard setting is switched off by mistake. OAuth accounts are confirmed by the
 * provider. Only `server` mode sees the confirmation date (it is not a JWT claim).
 */
export function isAllowedUser(user, { checkConfirmation = true } = {}) {
  if (!user?.id || user.is_anonymous === true) return false;
  const provider = user.app_metadata?.provider;
  if (checkConfirmation && provider === 'email' && !user.email_confirmed_at && !user.confirmed_at) return false;
  return true;
}

/**
 * `server` (default): asks Supabase Auth for the user on every request (`getUser`), so a revoked
 * session stops working at once.
 * `jwks` (SUPABASE_AUTH_VERIFY=jwks): verifies the signature of an asymmetric token against the
 * project's public JWKS (`getClaims`) and only falls back to Auth for symmetric tokens. Used where
 * the Auth server cannot see the user's token (e.g. behind a proxy that injects the server key);
 * a session revoked before its token expires keeps working until `exp`.
 */
export function buildTokenVerifier({ mode = env.supabaseAuthVerify, client = getVerifier } = {}) {
  return async function verify(token) {
    if (mode === 'jwks') {
      const { data, error } = await client().auth.getClaims(token);
      const user = error ? null : userFromClaims(data?.claims);
      if (!user || !isAllowedUser(user, { checkConfirmation: false })) throw errors.authRequired();
      return user;
    }
    const { data, error } = await client().auth.getUser(token);
    if (error || !data?.user || !isAllowedUser(data.user)) throw errors.authRequired();
    return data.user;
  };
}

export const verifyAccessToken = (token) => buildTokenVerifier()(token);
