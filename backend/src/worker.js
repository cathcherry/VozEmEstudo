import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { sleep } from './utils/time.js';
import { claimNextJob } from './repositories/job.repository.js';
import { executeClaimedJob } from './jobs/job-runner.js';
import { AppError } from './domain/errors.js';

let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});

logger.info('WORKER_STARTED', {
  workerId: env.workerId,
  pollMs: env.workerPollMs,
  concurrency: env.workerConcurrency,
});

while (!stopping) {
  try {
    const jobs = [];
    for (let i = 0; i < Math.max(1, env.workerConcurrency); i += 1) {
      const job = await claimNextJob(`${env.workerId}-${i + 1}`);
      if (!job) break;
      jobs.push(executeClaimedJob(job));
    }
    if (jobs.length) await Promise.allSettled(jobs);
    else await sleep(env.workerPollMs);
  } catch (error) {
    logger.error('WORKER_LOOP_ERROR', {
      code: error instanceof AppError ? error.code : 'WORKER_LOOP_FAILED',
      // A short cause (e.g. ENOTFOUND, ECONNRESET, PGRST301) without message text or data.
      cause: String(error?.cause?.code || error?.code || error?.name || 'unknown').slice(0, 40),
    });
    await sleep(env.workerPollMs);
  }
}

logger.info('WORKER_STOPPED', { workerId: env.workerId });
