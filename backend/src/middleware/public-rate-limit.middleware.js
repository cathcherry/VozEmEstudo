import { AppError } from '../domain/errors.js';

/**
 * Per-address limit for the unauthenticated endpoints (public share links). Tokens have 256 bits,
 * so this is not about guessing: it caps the database work one address can cause. Counts live in
 * this process's memory, like limitPerAccount. Behind a proxy, set TRUST_PROXY so req.ip is the
 * visitor's address; otherwise every visitor shares the proxy's bucket. `max <= 0` turns it off.
 */
export function limitPerAddress({ max, windowMs, now = () => Date.now(), maxKeys = 10000 }) {
  const hits = new Map();
  return (req, res, next) => {
    if (!(max > 0)) return next();
    const time = now();
    if (hits.size > maxKeys)
      for (const [key, list] of hits) if (!list.some((t) => time - t < windowMs)) hits.delete(key);
    const key = req.ip || 'unknown';
    const recent = (hits.get(key) || []).filter((t) => time - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      res.set('Retry-After', String(Math.max(1, Math.ceil((recent[0] + windowMs - time) / 1000))));
      return next(
        new AppError('RATE_LIMITED', 'Muitas solicitações. Tente novamente em instantes.', 429),
      );
    }
    recent.push(time);
    hits.set(key, recent);
    return next();
  };
}
