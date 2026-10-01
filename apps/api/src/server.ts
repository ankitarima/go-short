import { loadConfig } from '@go-short/config';
import { disconnectPrisma, getPrisma } from '@go-short/database';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { createApp } from './app';
import type { AppContext } from './context';
import { systemDnsResolver } from './services/dns';
import { ensureSharedDomain } from './services/domains';
import { ConsoleEmailProvider } from './services/email';
import { LocalStorageProvider } from './services/storage';

const config = loadConfig();
const logger = pino({
  level: config.LOG_LEVEL,
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    '*.password',
    '*.token',
  ],
  ...(config.isProd ? {} : { transport: { target: 'pino-pretty' } }),
});
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
redis.on('error', (err) => logger.error({ err }, 'redis error'));
const prisma = getPrisma();

const ctx: AppContext = {
  config,
  prisma,
  redis,
  logger,
  email: new ConsoleEmailProvider(logger, config.isProd),
  dns: systemDnsResolver,
  storage: new LocalStorageProvider(config.STORAGE_PATH),
};
await ensureSharedDomain(ctx);
const app = createApp(ctx);
const server = app.listen(config.API_PORT, () =>
  logger.info({ port: config.API_PORT }, 'api listening'),
);

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close();
  await Promise.allSettled([disconnectPrisma(), redis.quit()]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
