import { app } from './app.js';
import { env, missingRuntimeSecrets, productionConfigWarnings } from './config/env.js';
import { logger } from './utils/logger.js';
import { autoseedDemoLessons } from './services/demo-seed.service.js';

const server = app.listen(env.port, () => {
  const missing = missingRuntimeSecrets();
  logger.info('API_STARTED', { port: env.port, origin: env.appOrigin, missingConfiguration: missing });
  const unsafe = productionConfigWarnings();
  if (unsafe.length) logger.warn('UNSAFE_PRODUCTION_CONFIG', { warnings: unsafe });
  if (!missing.length) void autoseedDemoLessons();
});

function shutdown() {
  // Stop accepting requests and let the ones in progress finish; idle keep-alive connections
  // would otherwise hold the process open until the platform kills it.
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
  setTimeout(() => {
    logger.warn?.('API_SHUTDOWN_FORCED', { afterMs: 10000 });
    process.exit(0);
  }, 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
