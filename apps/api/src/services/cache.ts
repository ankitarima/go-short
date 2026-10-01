import { linkCacheKey } from '@go-short/shared';
import type { AppContext } from '../context';

/**
 * Delete delay for the second pass. A redirect that read the old row from Postgres just before our
 * commit could write the stale value into Redis just after our first DEL; deleting again shortly
 * afterwards closes that window. TTL remains the final backstop.
 */
export const SECOND_DELETE_DELAY_MS = 2000;

async function del(ctx: AppContext, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await ctx.redis.del(...keys);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
  // Mutations must not fail because the cache is down; the TTL bounds how stale an entry can be.
  ctx.logger.error(
    { err: lastErr, keyCount: keys.length },
    'redirect cache invalidation failed; entries expire by TTL',
  );
}

/** Call AFTER the Postgres commit. Also clears negative-cache entries (needed when a link is created). */
export async function invalidateLinkKeys(
  ctx: AppContext,
  pairs: Array<{ hostname: string; slug: string }>,
): Promise<void> {
  const keys = [...new Set(pairs.map((p) => linkCacheKey(p.hostname, p.slug)))];
  await del(ctx, keys);
  setTimeout(() => void del(ctx, keys), SECOND_DELETE_DELAY_MS).unref();
}

/** Drops every cached link under a domain (used when a domain is disabled). */
export async function invalidateDomain(
  ctx: AppContext,
  domainId: string,
  hostname: string,
): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await ctx.prisma.link.findMany({
      where: { domainId },
      select: { id: true, slug: true },
      orderBy: { id: 'asc' },
      take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) return;
    await invalidateLinkKeys(
      ctx,
      rows.map((r) => ({ hostname, slug: r.slug })),
    );
    cursor = rows[rows.length - 1]!.id;
  }
}
