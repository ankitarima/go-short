import type { PrismaClient } from '@go-short/database';

const TTL_MS = 30_000;
const MAX_ENTRIES = 5_000;
const LOOKUPS_PER_SECOND = 50;

/**
 * Answers "is this a verified hostname?" for the cache-miss path only (a cache hit already proves
 * it). Protects Postgres and Redis from Host-header floods: results are cached in-process, the
 * map is bounded, and total lookups are capped, so random hostnames cannot fan out into unbounded
 * queries or negative-cache keys.
 */
export class DomainRegistry {
  private readonly known = new Map<string, { ok: boolean; until: number }>();
  private tokens = LOOKUPS_PER_SECOND;
  private refilledAt = Date.now();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => number = Date.now,
  ) {}

  private takeToken(): boolean {
    const t = this.now();
    const elapsed = (t - this.refilledAt) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(LOOKUPS_PER_SECOND, this.tokens + elapsed * LOOKUPS_PER_SECOND);
      this.refilledAt = t;
    }
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  async isKnown(hostname: string): Promise<boolean> {
    const hit = this.known.get(hostname);
    const t = this.now();
    if (hit && hit.until > t) return hit.ok;
    if (!this.takeToken()) return false; // over budget: treat as unknown, do not touch the DB
    const row = await this.prisma.domain.findFirst({
      where: { hostname, status: 'VERIFIED' },
      select: { id: true },
    });
    if (this.known.size >= MAX_ENTRIES) this.known.delete(this.known.keys().next().value as string);
    this.known.set(hostname, { ok: row !== null, until: t + TTL_MS });
    return row !== null;
  }
}
