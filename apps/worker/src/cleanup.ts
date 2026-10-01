import type { PrismaClient } from '@go-short/database';
import { CLEANUP_TASKS, type CleanupTask, type StorageProvider } from '@go-short/shared';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

export { CLEANUP_TASKS, type CleanupTask };

/** UTC cron schedule per task. Spread out so they never run at once. */
export const CLEANUP_SCHEDULE: Record<CleanupTask, string> = {
  sessions: '7 * * * *',
  'stale-domains': '10 3 * * *',
  'click-retention': '30 3 * * *',
  'visitors-and-buckets': '50 3 * * *',
  'audit-logs': '10 4 * * *',
  'expired-links': '30 4 * * *',
  'orphan-logos': '50 4 * * *',
  'failed-jobs': '10 5 * * *',
};

export interface CleanupDeps {
  prisma: PrismaClient;
  redis: Redis;
  storage: StorageProvider;
  logger: Logger;
  /** Queues whose old failed jobs are trimmed. */
  queues?: Array<Pick<Queue, 'clean' | 'name'>>;
  config: {
    AUDIT_LOG_RETENTION_DAYS?: number;
    EXPIRED_LINK_DELETE_AFTER_DAYS?: number;
    BUCKET_RETENTION_DAYS: number;
  };
  now?: () => number;
  /** Rows per DELETE statement; small values are used in tests to exercise the loop. */
  batchSize?: number;
}

const DAY = 24 * 60 * 60 * 1000;
export type CleanupResult = Record<string, number>;

export async function runCleanup(deps: CleanupDeps, task: CleanupTask): Promise<CleanupResult> {
  const started = Date.now();
  const result = await TASKS[task](deps);
  deps.logger.info({ task, ...result, ms: Date.now() - started }, 'cleanup finished');
  return result;
}

const now = (d: CleanupDeps) => (d.now ?? Date.now)();
const cutoff = (d: CleanupDeps, days: number) => new Date(now(d) - days * DAY);

/** Deletes in bounded batches so a big purge never holds long locks or blows memory. */
async function batched(batch: number, run: (limit: number) => Promise<number>): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await run(batch);
    total += n;
    if (n < batch) return total;
  }
}

const TASKS: Record<CleanupTask, (d: CleanupDeps) => Promise<CleanupResult>> = {
  async sessions(d) {
    const t = new Date(now(d));
    const week = cutoff(d, 7);
    const month = cutoff(d, 30);
    const sessions = await d.prisma.session.deleteMany({ where: { expiresAt: { lt: t } } });
    // Used or expired single-use tokens are kept a week (support/debugging), then removed.
    const tokens = await d.prisma.authToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: week } }, { usedAt: { lt: week } }] },
    });
    const invitations = await d.prisma.invitation.deleteMany({
      where: { OR: [{ expiresAt: { lt: month } }, { acceptedAt: { lt: month } }] },
    });
    return { sessions: sessions.count, authTokens: tokens.count, invitations: invitations.count };
  },

  /** Releases hostnames claimed but never verified (squatting), after 7 days. Verified domains are never touched. */
  async 'stale-domains'(d) {
    const r = await d.prisma.domain.deleteMany({
      where: {
        workspaceId: { not: null },
        isVerified: false,
        status: 'PENDING',
        createdAt: { lt: cutoff(d, 7) },
        links: { none: {} },
      },
    });
    return { domains: r.count };
  },

  /** Per-workspace raw event retention. Workspaces without a retention setting keep everything. */
  async 'click-retention'(d) {
    const batch = d.batchSize ?? 10_000;
    const workspaces = await d.prisma.workspace.findMany({
      where: { retentionDays: { not: null } },
      select: { id: true, retentionDays: true },
    });
    let deleted = 0;
    for (const w of workspaces) {
      const before = cutoff(d, w.retentionDays!);
      deleted += await batched(
        batch,
        (limit) =>
          d.prisma.$executeRaw`DELETE FROM "ClickEvent" WHERE "id" IN (
          SELECT "id" FROM "ClickEvent" WHERE "workspaceId" = ${w.id} AND "timestamp" < ${before} LIMIT ${limit})`,
      );
    }
    // Aggregated rollups contain no personal data and are intentionally kept.
    return { workspaces: workspaces.length, clickEvents: deleted };
  },

  async 'visitors-and-buckets'(d) {
    const batch = d.batchSize ?? 10_000;
    // The dedupe table only matters for the current day (plus a little slack for late events).
    const visitorCutoff = cutoff(d, 3);
    const visitors = await batched(
      batch,
      (limit) =>
        d.prisma
          .$executeRaw`DELETE FROM "DailyVisitor" WHERE ctid IN (SELECT ctid FROM "DailyVisitor" WHERE "date" < ${visitorCutoff}::date LIMIT ${limit})`,
    );
    const bucketCutoff = cutoff(d, d.config.BUCKET_RETENTION_DAYS);
    const buckets = await batched(
      batch,
      (limit) =>
        d.prisma
          .$executeRaw`DELETE FROM "AnalyticsBucket" WHERE ctid IN (SELECT ctid FROM "AnalyticsBucket" WHERE "bucket" < ${bucketCutoff} LIMIT ${limit})`,
    );
    return { dailyVisitors: visitors, buckets };
  },

  async 'audit-logs'(d) {
    const days = d.config.AUDIT_LOG_RETENTION_DAYS;
    if (!days) return { auditLogs: 0 }; // unset: keep forever
    const batch = d.batchSize ?? 10_000;
    const before = cutoff(d, days);
    const n = await batched(
      batch,
      (limit) =>
        d.prisma
          .$executeRaw`DELETE FROM "AuditLog" WHERE "id" IN (SELECT "id" FROM "AuditLog" WHERE "createdAt" < ${before} LIMIT ${limit})`,
    );
    return { auditLogs: n };
  },

  /** Opt-in: delete links that expired more than N days ago, and their cached redirects. */
  async 'expired-links'(d) {
    const days = d.config.EXPIRED_LINK_DELETE_AFTER_DAYS;
    if (!days) return { links: 0 };
    const before = cutoff(d, days);
    const batch = d.batchSize ?? 500;
    let deleted = 0;
    for (;;) {
      const rows = await d.prisma.link.findMany({
        where: { expiresAt: { lt: before } },
        select: { id: true, slug: true, domain: { select: { hostname: true } } },
        take: batch,
      });
      if (rows.length === 0) break;
      await d.prisma.link.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      await d.redis
        .del(...rows.map((r) => `link:${r.domain.hostname.toLowerCase()}:${r.slug}`))
        .catch((err) => d.logger.warn({ err }, 'could not purge cached redirects'));
      deleted += rows.length;
      if (rows.length < batch) break;
    }
    return { links: deleted };
  },

  /** Logo files that no QR code references and that are older than a day (failed/abandoned uploads). */
  async 'orphan-logos'(d) {
    const files = await d.storage.list('logos');
    const old = files.filter((f) => now(d) - f.modifiedAt.getTime() > DAY);
    if (old.length === 0) return { orphanLogos: 0 };
    const used = new Set<string>();
    for (let i = 0; i < old.length; i += 1000) {
      const rows = await d.prisma.qRCode.findMany({
        where: { logoPath: { in: old.slice(i, i + 1000).map((f) => f.key) } },
        select: { logoPath: true },
      });
      for (const r of rows) if (r.logoPath) used.add(r.logoPath);
    }
    let removed = 0;
    for (const f of old) {
      if (used.has(f.key)) continue;
      await d.storage.delete(f.key);
      removed++;
    }
    return { orphanLogos: removed };
  },

  /** Trims old failed jobs (the dead-letter set) so they cannot grow without bound. */
  async 'failed-jobs'(d) {
    let removed = 0;
    for (const q of d.queues ?? []) removed += (await q.clean(14 * DAY, 10_000, 'failed')).length;
    return { failedJobs: removed };
  },
};
