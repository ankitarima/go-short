import type { PrismaClient } from '@go-short/database';
import {
  NEGATIVE_CACHE_VALUE,
  buildCacheEntry,
  linkCacheKey,
  type RedirectCacheEntry,
} from '@go-short/shared';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DomainRegistry } from './domainRegistry';
import type { CacheResult } from './metrics';

export type Resolution =
  { kind: 'entry'; entry: RedirectCacheEntry } | { kind: 'missing' } | { kind: 'unavailable' };

export const LINK_SELECT = {
  id: true,
  workspaceId: true,
  campaignId: true,
  destinationUrl: true,
  isActive: true,
  expiresAt: true,
  passwordHash: true,
  redirectStatus: true,
  utmSource: true,
  utmMedium: true,
  utmCampaign: true,
  utmTerm: true,
  utmContent: true,
} as const;

const NEGATIVE_TTL_SECONDS = 60;

interface Options {
  prisma: PrismaClient;
  redis: Redis;
  logger: Logger;
  domains: DomainRegistry;
  ttlSeconds: number;
  onCache?: (result: CacheResult) => void;
  /** Seconds spent in the Postgres lookup (connection wait included), for cache misses. */
  onDbLookup?: (seconds: number) => void;
}

/** Redis first, Postgres on miss or Redis failure. Never throws. */
export class LinkResolver {
  private readonly inflight = new Map<string, Promise<Resolution>>();
  private lastRedisLog = 0;

  constructor(private readonly o: Options) {}

  private redisFailed(err: unknown, op: string): void {
    // At thousands of req/s a Redis outage must not also flood the logs: one line per 5 s.
    const t = Date.now();
    if (t - this.lastRedisLog > 5000) {
      this.lastRedisLog = t;
      this.o.logger.error({ err, op }, 'redis unavailable, falling back to postgres');
    }
  }

  async resolve(hostname: string, slug: string): Promise<Resolution> {
    const key = linkCacheKey(hostname, slug);
    let raw: string | null = null;
    try {
      raw = await this.o.redis.get(key);
    } catch (err) {
      this.o.onCache?.('redis_error');
      this.redisFailed(err, 'get');
    }
    if (raw !== null) {
      const parsed = parseEntry(raw);
      if (parsed === 'missing') return (this.o.onCache?.('negative_hit'), { kind: 'missing' });
      if (parsed) return (this.o.onCache?.('hit'), { kind: 'entry', entry: parsed });
      // Corrupt value: fall through and overwrite it from Postgres.
    }
    // Single-flight: a cold, popular link produces ONE database query, not one per concurrent request.
    if (raw === null) this.o.onCache?.('miss');
    let p = this.inflight.get(key);
    if (!p) {
      p = this.load(key, hostname, slug).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  private async load(key: string, hostname: string, slug: string): Promise<Resolution> {
    try {
      const started = process.hrtime.bigint();
      const link = await this.o.prisma.link.findFirst({
        where: { slug, domain: { hostname, status: 'VERIFIED' } },
        select: LINK_SELECT,
      });
      this.o.onDbLookup?.(Number(process.hrtime.bigint() - started) / 1e9);
      if (!link) {
        // Negative-cache only for hostnames we know; random Host values must not create Redis keys.
        if (await this.o.domains.isKnown(hostname))
          await this.write(key, NEGATIVE_CACHE_VALUE, NEGATIVE_TTL_SECONDS);
        return { kind: 'missing' };
      }
      const entry = buildCacheEntry(link);
      // ±10% jitter so entries populated together do not all expire (and stampede) together.
      await this.write(
        key,
        JSON.stringify(entry),
        Math.round(this.o.ttlSeconds * (0.9 + Math.random() * 0.2)),
      );
      return { kind: 'entry', entry };
    } catch (err) {
      this.o.logger.error({ err }, 'link lookup failed');
      return { kind: 'unavailable' };
    }
  }

  private async write(key: string, value: string, ttl: number): Promise<void> {
    try {
      await this.o.redis.set(key, value, 'EX', ttl);
    } catch (err) {
      this.redisFailed(err, 'set');
    }
  }
}

function parseEntry(raw: string): RedirectCacheEntry | 'missing' | null {
  try {
    const v = JSON.parse(raw) as Partial<RedirectCacheEntry> & { missing?: boolean };
    if (v.missing === true) return 'missing';
    if (
      typeof v.linkId === 'string' &&
      typeof v.workspaceId === 'string' &&
      typeof v.active === 'boolean'
    ) {
      return v as RedirectCacheEntry;
    }
  } catch {
    /* corrupt */
  }
  return null;
}
