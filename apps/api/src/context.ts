import type { Config } from '@go-short/config';
import type { PrismaClient } from '@go-short/database';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DnsResolver } from './services/dns';
import type { StorageProvider } from '@go-short/shared';
import type { EmailProvider } from './services/email';

/** Everything a route needs; injected so tests can supply real-but-isolated instances. */
/** BullMQ queues the API enqueues to / inspects. */
export interface QueueRegistry {
  analytics: Queue;
  cleanup: Queue;
  webhooks: Queue;
}

export interface AppContext {
  config: Config;
  prisma: PrismaClient;
  redis: Redis;
  logger: Logger;
  email: EmailProvider;
  dns: DnsResolver;
  storage: StorageProvider;
  queues: QueueRegistry;
}
