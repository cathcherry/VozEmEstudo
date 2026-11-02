import { env } from '../config/env.js';

export function nextRetryDelayMs(attemptCount) {
  if (attemptCount <= 1) return env.retryDelay1Ms;
  return env.retryDelay2Ms;
}

export function shouldRetry(error, job) {
  return Boolean(error?.retryable) && Number(job.attempt_count) < Number(job.max_attempts);
}
