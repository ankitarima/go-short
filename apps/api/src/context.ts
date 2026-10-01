import type { Config } from '@go-short/config';
import type { PrismaClient } from '@go-short/database';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { EmailProvider } from './services/email';

/** Everything a route needs; injected so tests can supply real-but-isolated instances. */
export interface AppContext {
  config: Config;
  prisma: PrismaClient;
  redis: Redis;
  logger: Logger;
  email: EmailProvider;
}
