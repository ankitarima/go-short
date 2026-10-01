import { loadConfig } from '@go-short/config';
import { disconnectPrisma, getPrisma } from '@go-short/database';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { Hasher } from './enrich';
import { loadGeo } from './geo';
import { BatchProcessor } from './processBatch';
import { createAnalyticsWorker } from './worker';

const config = loadConfig();
const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.isProd ? {} : { transport: { target: 'pino-pretty' } }),
});

const processor = new BatchProcessor({
  prisma: getPrisma(),
  logger,
  geo: loadGeo(config.GEOIP_DATABASE_PATH, logger),
  hasher: new Hasher(config.SESSION_SECRET),
});

// BullMQ workers need blocking commands: maxRetriesPerRequest must be null.
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (err) => logger.error({ err }, 'redis error'));

const worker = createAnalyticsWorker({
  connection,
  processor,
  concurrency: config.WORKER_CONCURRENCY,
  logger,
});
logger.info({ concurrency: config.WORKER_CONCURRENCY }, 'analytics worker started');

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  await worker.close(); // waits for in-flight jobs
  await Promise.allSettled([disconnectPrisma(), connection.quit()]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
