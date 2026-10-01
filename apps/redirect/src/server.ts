import { loadConfig } from '@go-short/config';
import { disconnectPrisma, getPrisma } from '@go-short/database';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { createRedirectServer } from './handler';
import { noopPublisher } from './publisher';

const config = loadConfig();
// Per-request logging at burst rates is expensive; normal requests log at debug, failures at error.
const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.isProd ? {} : { transport: { target: 'pino-pretty' } }),
});
const redis = new Redis(config.REDIS_URL, {
  enableOfflineQueue: false, // fail fast when Redis is down so we can fall back to Postgres
  maxRetriesPerRequest: 1,
  commandTimeout: 250,
  retryStrategy: (n) => Math.min(n * 100, 2000),
});
redis.on('error', () => undefined); // surfaced (throttled) by the resolver

const server = createRedirectServer({
  config,
  prisma: getPrisma(),
  redis,
  logger,
  publisher: noopPublisher,
});
server.listen(config.REDIRECT_PORT, () =>
  logger.info({ port: config.REDIRECT_PORT }, 'redirect listening'),
);

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  // Stop accepting, drop idle keep-alive sockets (otherwise close() waits for them), let in-flight finish.
  server.close();
  server.closeIdleConnections();
  const force = setTimeout(() => server.closeAllConnections(), 10_000);
  force.unref();
  await Promise.allSettled([disconnectPrisma(), redis.quit()]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
