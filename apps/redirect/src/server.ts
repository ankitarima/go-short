import { loadConfig } from '@go-short/config';
import { disconnectPrisma, getPrisma } from '@go-short/database';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { createRedirectServer } from './handler';
import { Queue } from 'bullmq';
import { QUEUES, createRegistry, startMetricsServer, type AnalyticsBatch } from '@go-short/shared';
import { createRedirectMetrics } from './metrics';
import { BullmqPublisher } from './bullPublisher';

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

// Dedicated connection for the queue: fail fast (no offline queue) so a Redis outage buffers events
// in the publisher instead of stalling anything.
const queueConnection = new Redis(config.REDIS_URL, {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: (n) => Math.min(n * 100, 2000),
});
queueConnection.on('error', () => undefined);
const metrics = createRedirectMetrics(createRegistry('redirect'), () => publisher.pending);
const publisher: BullmqPublisher = new BullmqPublisher({
  queue: new Queue<AnalyticsBatch>(QUEUES.analyticsEvents, { connection: queueConnection }),
  logger,
  flushMs: config.ANALYTICS_BATCH_FLUSH_MS,
  batchMax: config.ANALYTICS_BATCH_MAX,
  bufferMax: config.ANALYTICS_BUFFER_MAX,
  onEvent: (event, n) => metrics.analytics.inc({ event }, n),
});

const server = createRedirectServer({
  config,
  prisma: getPrisma(),
  redis,
  logger,
  publisher,
  metrics,
});
server.listen(config.REDIRECT_PORT, () =>
  logger.info({ port: config.REDIRECT_PORT }, 'redirect listening'),
);

const metricsServer = config.METRICS_ENABLED
  ? startMetricsServer({
      registry: metrics.registry,
      host: config.METRICS_HOST,
      port: config.REDIRECT_METRICS_PORT,
      token: config.METRICS_TOKEN,
      onError: (err) => logger.error({ err }, 'metrics server error'),
    })
  : undefined;

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  // Stop accepting, drop idle keep-alive sockets (otherwise close() waits for them), let in-flight finish.
  server.close();
  metricsServer?.close();
  server.closeIdleConnections();
  await publisher.close();
  const force = setTimeout(() => server.closeAllConnections(), 10_000);
  force.unref();
  await Promise.allSettled([disconnectPrisma(), redis.quit(), queueConnection.quit()]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
