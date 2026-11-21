import { AppError } from '../domain/errors.js';

/**
 * Per-account limit for costly requests (paid transcription and text generation, CPU-bound media
 * conversion). Counts live in this process's memory: with one API instance (the recommended
 * prototype setup, see docs/HOSPEDAGEM.md) this is a real cap per account; with several instances
 * each one counts separately, so the effective limit is multiplied. A shared store (Redis or a
 * database table) would be needed for a cluster-wide limit. `max <= 0` turns the limit off.
 */
export function limitPerAccount({ name, max, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  let lastSweep = now();
  return (req, res, next) => {
    if (!(max > 0)) return next();
    const key = req.user?.id;
    if (!key) return next(); // Unauthenticated requests are rejected by requireAuth first.
    const time = now();
    if (time - lastSweep > windowMs) {
      for (const [user, list] of hits) if (!list.some((t) => time - t < windowMs)) hits.delete(user);
      lastSweep = time;
    }
    const recent = (hits.get(key) || []).filter((t) => time - t < windowMs);
    if (recent.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((recent[0] + windowMs - time) / 1000));
      res.set('Retry-After', String(retryAfter));
      hits.set(key, recent);
      return next(new AppError('RATE_LIMITED', `Muitas solicitações deste tipo. Tente novamente em ${Math.ceil(retryAfter / 60)} min.`, 429, { name }));
    }
    recent.push(time);
    hits.set(key, recent);
    return next();
  };
}
