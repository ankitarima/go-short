import type { Server } from 'node:http';
import { loadConfig, type Config } from '@go-short/config';
import { getPrisma, type PrismaClient } from '@go-short/database';
import type { AnalyticsEvent } from '@go-short/shared';
import argon2 from 'argon2';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { createRedirectServer } from '../src/handler';
import type { AnalyticsPublisher } from '../src/publisher';

export class CapturingPublisher implements AnalyticsPublisher {
  events: AnalyticsEvent[] = [];
  publish(e: AnalyticsEvent) {
    this.events.push(e);
  }
}

export const prisma = getPrisma();
export const redis = new Redis(process.env.REDIS_URL!);

export function makeRedirect(
  over: Partial<{
    config: Partial<Config>;
    prisma: PrismaClient;
    redis: Redis;
    publisher: AnalyticsPublisher;
    now: () => number;
    metrics: import('../src/metrics').RedirectMetrics;
  }> = {},
) {
  const publisher = (over.publisher ?? new CapturingPublisher()) as CapturingPublisher;
  const server: Server = createRedirectServer({
    config: { ...loadConfig(), ...over.config },
    prisma: over.prisma ?? prisma,
    redis: over.redis ?? redis,
    logger: pino({ level: 'silent' }),
    publisher,
    now: over.now,
    metrics: over.metrics,
  });
  return { server, publisher };
}

export async function resetDb() {
  await prisma.$executeRawUnsafe('TRUNCATE "User","Workspace","Domain" CASCADE');
  await redis.flushdb();
  await prisma.domain.create({
    data: {
      hostname: 'localhost:4001',
      workspaceId: null,
      status: 'VERIFIED',
      isVerified: true,
      isDefault: true,
      verificationToken: 'shared',
    },
  });
}

export async function seedWorkspace(name = 'W') {
  const user = await prisma.user.create({
    data: { email: `${name}-${Math.random()}@example.com`, name, passwordHash: 'x' },
  });
  const ws = await prisma.workspace.create({
    data: {
      name,
      slug: `${name}-${Math.random().toString(36).slice(2, 8)}`.toLowerCase(),
      members: { create: { userId: user.id, role: 'OWNER' } },
    },
  });
  return { user, ws };
}

export async function sharedDomain() {
  return prisma.domain.findFirstOrThrow({ where: { workspaceId: null } });
}

export async function customDomain(workspaceId: string, hostname: string, extra: object = {}) {
  return prisma.domain.create({
    data: {
      workspaceId,
      hostname,
      status: 'VERIFIED',
      isVerified: true,
      verificationToken: 't',
      ...extra,
    },
  });
}

export async function seedLink(
  workspaceId: string,
  domainId: string,
  slug: string,
  extra: Record<string, unknown> = {},
) {
  const { password, ...rest } = extra as { password?: string };
  return prisma.link.create({
    data: {
      workspaceId,
      domainId,
      slug,
      destinationUrl: 'https://example.org/landing',
      ...(password ? { passwordHash: await argon2.hash(password) } : {}),
      ...rest,
    },
  });
}

/** Wraps prisma so tests can count / break link lookups. */
export function countingPrisma() {
  const calls = { linkFindFirst: 0 };
  const p = new Proxy(prisma, {
    get(t, k) {
      if (k === 'link') {
        return new Proxy(t.link, {
          get(l, m) {
            if (m === 'findFirst')
              return (...a: Parameters<typeof l.findFirst>) => {
                calls.linkFindFirst++;
                return l.findFirst(...a);
              };
            return Reflect.get(l, m);
          },
        });
      }
      return Reflect.get(t, k);
    },
  }) as PrismaClient;
  return { prisma: p, calls };
}

export const brokenPrisma = {
  link: { findFirst: () => Promise.reject(new Error('postgres down')) },
  domain: { findFirst: () => Promise.reject(new Error('postgres down')) },
  $queryRaw: () => Promise.reject(new Error('postgres down')),
} as unknown as PrismaClient;

export function deadRedis(): Redis {
  const r = new Redis('redis://127.0.0.1:1', {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    lazyConnect: true,
  });
  r.on('error', () => undefined);
  return r;
}

/** For concurrent tests: one listening server (supertest would try to listen once per request). */
export async function listen(server: Server): Promise<{ url: string; close: () => Promise<void> }> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
