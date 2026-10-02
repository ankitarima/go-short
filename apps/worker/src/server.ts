import { loadConfig } from '@go-short/config';
import { disconnectPrisma, getPrisma } from '@go-short/database';
import { LocalStorageProvider, QUEUES, startMetricsServer } from '@go-short/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { Hasher } from './enrich';
import { createWorkerMetrics } from './metrics';
import { loadGeo } from './geo';
import { BatchProcessor } from './processBatch';
import { createCleanupWorker, scheduleCleanup } from './cleanupWorker';
import { createWebhookWorker } from './webhooks';
import { createAnalyticsWorker } from './worker';

const config = loadConfig();
const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.isProd ? {} : { transport: { target: 'pino-pretty' } }),
});
const prisma = getPrisma();

// BullMQ workers need blocking commands: maxRetriesPerRequest must be null.
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (err) => logger.error({ err }, 'redis error'));
// Ordinary commands (cache purges, queue maintenance) use their own connection.
const commands = new Redis(config.REDIS_URL);
commands.on('error', (err) => logger.error({ err }, 'redis error'));

const analytics = createAnalyticsWorker({
  connection,
  processor: new BatchProcessor({
    prisma,
    logger,
    geo: loadGeo(config.GEOIP_DATABASE_PATH, logger),
    hasher: new Hasher(config.SESSION_SECRET),
  }),
  concurrency: config.WORKER_CONCURRENCY,
  logger,
});

const webhooks = createWebhookWorker({
  connection,
  deps: {
    prisma,
    logger,
    masterSecret: config.SESSION_SECRET,
    allowInsecure: config.WEBHOOK_ALLOW_INSECURE,
  },
});
if (config.WEBHOOK_ALLOW_INSECURE) {
  logger.warn(
    'WEBHOOK_ALLOW_INSECURE is on: http:// and private-network webhook targets are allowed (dev/test only)',
  );
}

const metrics = createWorkerMetrics();
metrics.watchAnalytics(analytics);
metrics.watchWebhooks(webhooks);

const closers: Array<() => Promise<unknown>> = [() => analytics.close(), () => webhooks.close()];
const queues = [
  new Queue(QUEUES.analyticsEvents, { connection: commands }),
  new Queue(QUEUES.webhooks, { connection: commands }),
];
const cleanupQueue = new Queue(QUEUES.cleanup, { connection: commands });

metrics.watchQueues({
  [QUEUES.analyticsEvents]: queues[0]!,
  [QUEUES.webhooks]: queues[1]!,
  [QUEUES.cleanup]: cleanupQueue,
});

if (config.CLEANUP_ENABLED) {
  await scheduleCleanup(cleanupQueue);
  const cleanup = createCleanupWorker({
    connection,
    deps: {
      prisma,
      redis: commands,
      storage: new LocalStorageProvider(config.STORAGE_PATH),
      logger,
      queues,
      config: {
        AUDIT_LOG_RETENTION_DAYS: config.AUDIT_LOG_RETENTION_DAYS,
        EXPIRED_LINK_DELETE_AFTER_DAYS: config.EXPIRED_LINK_DELETE_AFTER_DAYS,
        BUCKET_RETENTION_DAYS: config.BUCKET_RETENTION_DAYS,
      },
    },
  });
  metrics.watchCleanup(cleanup);
  closers.push(
    () => cleanup.close(),
    () => cleanupQueue.close(),
  );
} else {
  logger.warn('CLEANUP_ENABLED=false: scheduled cleanup and retention jobs are disabled');
}

const metricsServer = config.METRICS_ENABLED
  ? startMetricsServer({
      registry: metrics.registry,
      host: config.METRICS_HOST,
      port: config.WORKER_METRICS_PORT,
      token: config.METRICS_TOKEN,
      onError: (err) => logger.error({ err }, 'metrics server error'),
    })
  : undefined;

logger.info(
  { concurrency: config.WORKER_CONCURRENCY, cleanup: config.CLEANUP_ENABLED },
  'worker started (analytics, webhooks, cleanup)',
);

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  metricsServer?.close();
  await Promise.allSettled(closers.map((c) => c())); // waits for in-flight jobs
  await Promise.allSettled([
    ...queues.map((q) => q.close()),
    cleanupQueue.close(),
    disconnectPrisma(),
    connection.quit(),
    commands.quit(),
  ]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
