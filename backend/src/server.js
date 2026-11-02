import { app } from './app.js';
import { env, missingRuntimeSecrets } from './config/env.js';
import { logger } from './utils/logger.js';

const server = app.listen(env.port, () => {
  const missing = missingRuntimeSecrets();
  logger.info('API_STARTED', { port: env.port, origin: env.appOrigin, missingConfiguration: missing });
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
