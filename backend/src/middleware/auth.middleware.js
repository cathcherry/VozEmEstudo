import { verifyAccessToken } from '../integrations/supabase/auth-client.js';
import { errors } from '../domain/errors.js';

export async function requireAuth(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) throw errors.authRequired();
    req.accessToken = match[1];
    req.user = await verifyAccessToken(req.accessToken);
    next();
  } catch (error) {
    next(error);
  }
}
