import { mkdtempSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageProvider, QUEUES } from '@go-short/shared';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLEANUP_SCHEDULE, CLEANUP_TASKS, type CleanupDeps, runCleanup } from '../src/cleanup';
import { createCleanupWorker, scheduleCleanup } from '../src/cleanupWorker';
import { prisma, resetDb, seed } from './helpers';

const redis = new Redis(process.env.REDIS_URL!);
const dir = mkdtempSync(join(tmpdir(), 'go-short-cleanup-'));
const storage = new LocalStorageProvider(dir);
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

const deps = (over: Partial<CleanupDeps> = {}): CleanupDeps => ({
  prisma,
  redis,
  storage,
  logger: pino({ level: 'silent' }),
  config: { BUCKET_RETENTION_DAYS: 400 },
  batchSize: 2,
  ...over,
});

beforeEach(async () => {
  await resetDb();
  await prisma.$executeRawUnsafe('TRUNCATE "Session","AuthToken","Invitation","AuditLog" CASCADE');
  await redis.flushdb();
});
afterAll(async () => {
  await redis.quit();
  await prisma.$disconnect();
});

describe('sessions and tokens', () => {
  it('removes expired sessions, old used/expired tokens and old invitations, keeping live ones', async () => {
    const { workspace } = await seed();
    const user = await prisma.user.create({
      data: { email: 'c@example.com', name: 'c', passwordHash: 'x' },
    });
    const sess = (h: string, d: number) =>
      prisma.session.create({
        data: { userId: user.id, tokenHash: h, csrfToken: 'c', expiresAt: ago(d) },
      });
    await sess('expired', 1);
    await sess('live', -5);
    const tok = (h: string, extra: object) =>
      prisma.authToken.create({
        data: {
          userId: user.id,
          type: 'PASSWORD_RESET',
          tokenHash: h,
          expiresAt: ago(-1),
          ...extra,
        },
      });
    await tok('old-expired', { expiresAt: ago(8) });
    await tok('old-used', { usedAt: ago(8) });
    await tok('recent-used', { usedAt: ago(1) });
    await tok('live-token', {});
    const inv = (h: string, extra: object) =>
      prisma.invitation.create({
        data: {
          workspaceId: workspace.id,
          email: `${h}@example.com`,
          role: 'VIEWER',
          tokenHash: h,
          expiresAt: ago(-3),
          ...extra,
        },
      });
    await inv('inv-old', { expiresAt: ago(40) });
    await inv('inv-accepted-old', { acceptedAt: ago(40) });
    await inv('inv-live', {});
    expect(await runCleanup(deps(), 'sessions')).toEqual({
      sessions: 1,
      authTokens: 2,
      invitations: 2,
    });
    expect((await prisma.session.findMany()).map((s) => s.tokenHash)).toEqual(['live']);
    expect(
      (await prisma.authToken.findMany({ orderBy: { tokenHash: 'asc' } })).map((t) => t.tokenHash),
    ).toEqual(['live-token', 'recent-used']);
    expect((await prisma.invitation.findMany()).map((i) => i.tokenHash)).toEqual(['inv-live']);
  });
});

describe('stale domains', () => {
  it('releases only old unverified claims; keeps verified, fresh and the shared domain', async () => {
    const { workspace } = await seed();
    const mk = (hostname: string, extra: object) =>
      prisma.domain.create({
        data: { workspaceId: workspace.id, hostname, verificationToken: 't', ...extra },
      });
    await mk('old-pending.example.com', { createdAt: ago(10) });
    await mk('fresh-pending.example.com', {});
    await mk('old-verified.example.com', {
      createdAt: ago(10),
      isVerified: true,
      status: 'VERIFIED',
    });
    await prisma.domain.create({
      data: {
        hostname: 'shared.example.com',
        workspaceId: null,
        verificationToken: 's',
        createdAt: ago(100),
      },
    });
    expect((await runCleanup(deps(), 'stale-domains')).domains).toBe(1);
    const left = (await prisma.domain.findMany()).map((d) => d.hostname).sort();
    expect(left.includes('old-pending.example.com')).toBe(false);
    expect(left).toEqual(
      expect.arrayContaining([
        'fresh-pending.example.com',
        'old-verified.example.com',
        'shared.example.com',
      ]),
    );
  });
});

describe('click retention', () => {
  it('applies each workspace’s own retention (in batches); unlimited workspaces keep everything; rollups stay', async () => {
    const a = await seed({}, { retentionDays: 30 });
    const b = await seed({ slug: 'b' }, { retentionDays: null });
    const c = await seed({ slug: 'c' }, { retentionDays: 7 });
    let n = 0;
    const row = (ws: string, link: string, days: number) => ({
      id: `e${n++}`,
      workspaceId: ws,
      linkId: link,
      timestamp: ago(days),
      visitorHash: 'v',
      device: 'DESKTOP' as const,
    });
    await prisma.clickEvent.createMany({
      data: [
        ...[40, 41, 42, 45, 50].map((d) => row(a.workspace.id, a.link.id, d)), // 5 old for A
        ...[1, 10].map((d) => row(a.workspace.id, a.link.id, d)), // kept
        ...[400, 900].map((d) => row(b.workspace.id, b.link.id, d)), // unlimited: kept
        ...[8, 9, 20].map((d) => row(c.workspace.id, c.link.id, d)), // 3 old for C
        row(c.workspace.id, c.link.id, 2),
      ],
    });
    await prisma.analyticsDaily.create({
      data: {
        date: ago(60),
        workspaceId: a.workspace.id,
        linkId: a.link.id,
        isBot: false,
        clicks: 99,
      },
    });
    const r = await runCleanup(deps({ batchSize: 2 }), 'click-retention');
    expect(r).toEqual({ workspaces: 2, clickEvents: 8 });
    const left = (await prisma.clickEvent.findMany()).reduce<Record<string, number>>(
      (m, e) => ((m[e.workspaceId] = (m[e.workspaceId] ?? 0) + 1), m),
      {},
    );
    expect(left).toEqual({ [a.workspace.id]: 2, [b.workspace.id]: 2, [c.workspace.id]: 1 });
    expect((await prisma.analyticsDaily.findFirstOrThrow()).clicks).toBe(99);
  });
});

describe('visitor dedupe and bucket retention', () => {
  it('drops old DailyVisitor rows and buckets beyond the retention window', async () => {
    const { workspace, link } = await seed();
    const d = (days: number) => ago(days).toISOString().slice(0, 10);
    await prisma.dailyVisitor.createMany({
      data: [d(10), d(5), d(4), d(0)].map((date) => ({
        date: new Date(date),
        linkId: link.id,
        visitorHash: 'h',
      })),
    });
    const bucket = (days: number) => ({
      bucket: ago(days),
      linkId: link.id,
      isBot: false,
      workspaceId: workspace.id,
      clicks: 1,
    });
    await prisma.analyticsBucket.createMany({
      data: [bucket(500), bucket(401), bucket(399), bucket(1)],
    });
    expect(await runCleanup(deps({ batchSize: 2 }), 'visitors-and-buckets')).toEqual({
      dailyVisitors: 3,
      buckets: 2,
    });
    expect(await prisma.dailyVisitor.count()).toBe(1);
    expect(await prisma.analyticsBucket.count()).toBe(2);
  });
});

describe('audit logs', () => {
  it('keeps everything by default; deletes old entries only when a retention is configured', async () => {
    const { workspace } = await seed();
    await prisma.auditLog.createMany({
      data: [400, 100, 40, 5].map((d, i) => ({
        workspaceId: workspace.id,
        action: `A${i}`,
        resourceType: 'x',
        createdAt: ago(d),
      })),
    });
    expect(await runCleanup(deps(), 'audit-logs')).toEqual({ auditLogs: 0 });
    expect(await prisma.auditLog.count()).toBe(4);
    expect(
      await runCleanup(
        deps({ config: { BUCKET_RETENTION_DAYS: 400, AUDIT_LOG_RETENTION_DAYS: 30 } }),
        'audit-logs',
      ),
    ).toEqual({ auditLogs: 3 });
    expect((await prisma.auditLog.findMany()).map((a) => a.action)).toEqual(['A3']);
  });
});

describe('expired links', () => {
  it('is off by default; when enabled it deletes long-expired links (and cached redirects) only', async () => {
    const { workspace, domain, link } = await seed({ expiresAt: ago(40), slug: 'long-gone' });
    const mk = (slug: string, extra: object) =>
      prisma.link.create({
        data: {
          workspaceId: workspace.id,
          domainId: domain.id,
          slug,
          destinationUrl: 'https://example.org',
          ...extra,
        },
      });
    await mk('recent-expired', { expiresAt: ago(10) });
    await mk('never-expires', {});
    await mk('future', { expiresAt: ago(-10) });
    await redis.set(`link:${domain.hostname}:long-gone`, 'cached');
    await redis.set(`link:${domain.hostname}:recent-expired`, 'cached');
    expect(await runCleanup(deps(), 'expired-links')).toEqual({ links: 0 });
    expect(await prisma.link.count()).toBe(4);
    const r = await runCleanup(
      deps({ config: { BUCKET_RETENTION_DAYS: 400, EXPIRED_LINK_DELETE_AFTER_DAYS: 30 } }),
      'expired-links',
    );
    expect(r).toEqual({ links: 1 });
    expect(
      (await prisma.link.findMany({ select: { slug: true }, orderBy: { slug: 'asc' } })).map(
        (l) => l.slug,
      ),
    ).toEqual(['future', 'never-expires', 'recent-expired']);
    expect(await redis.exists(`link:${domain.hostname}:long-gone`)).toBe(0);
    expect(await redis.exists(`link:${domain.hostname}:recent-expired`)).toBe(1);
    void link;
  });
});

describe('orphan logos', () => {
  it('removes unreferenced logos older than a day; keeps referenced and fresh ones', async () => {
    const { workspace, link } = await seed();
    const put = async (key: string, ageDays: number) => {
      await storage.put(key, Buffer.from('png'));
      const t = new Date(Date.now() - ageDays * DAY);
      utimesSync(join(dir, key), t, t);
    };
    await put('logos/w/referenced.png', 5);
    await put('logos/w/orphan-old.png', 5);
    await put('logos/w/orphan-fresh.png', 0);
    await prisma.qRCode.create({
      data: {
        workspaceId: workspace.id,
        linkId: link.id,
        name: 'Q',
        logoPath: 'logos/w/referenced.png',
      },
    });
    expect(await runCleanup(deps(), 'orphan-logos')).toEqual({ orphanLogos: 1 });
    expect(await storage.exists('logos/w/referenced.png')).toBe(true);
    expect(await storage.exists('logos/w/orphan-old.png')).toBe(false);
    expect(await storage.exists('logos/w/orphan-fresh.png')).toBe(true);
  });
});

describe('failed jobs and scheduling (real BullMQ)', () => {
  const closers: Array<() => Promise<unknown>> = [];
  afterEach(async () => {
    for (const c of closers.splice(0)) await c().catch(() => undefined);
  });
  const conn = (o = {}) => new Redis(process.env.REDIS_URL!, o);

  it('asks each queue to trim failed jobs older than 14 days, and does not remove fresh ones', async () => {
    const clean = vi.fn().mockResolvedValue(['1', '2']);
    expect(
      await runCleanup(
        deps({
          queues: [
            { name: 'a', clean },
            { name: 'b', clean },
          ],
        }),
        'failed-jobs',
      ),
    ).toEqual({ failedJobs: 4 });
    expect(clean).toHaveBeenCalledWith(14 * DAY, 10_000, 'failed');

    const q = new Queue(QUEUES.analyticsEvents, { connection: conn() });
    closers.push(() => q.close());
    const w = new Worker(
      QUEUES.analyticsEvents,
      async () => {
        throw new Error('boom');
      },
      { connection: conn({ maxRetriesPerRequest: null }) },
    );
    closers.push(() => w.close());
    await q.add('batch', { batchId: 'x', events: [] }, { attempts: 1 });
    for (let i = 0; i < 100 && (await q.getFailedCount()) === 0; i++)
      await new Promise((r) => setTimeout(r, 50));
    expect(await runCleanup(deps({ queues: [q] }), 'failed-jobs')).toEqual({ failedJobs: 0 });
    expect(await q.getFailedCount()).toBe(1);
  });

  it('schedules every task exactly once, idempotently, on its UTC cron', async () => {
    const q = new Queue(QUEUES.cleanup, { connection: conn() });
    closers.push(() => q.close());
    await scheduleCleanup(q);
    await scheduleCleanup(q); // restart-safe
    const schedulers = await q.getJobSchedulers();
    expect(schedulers).toHaveLength(CLEANUP_TASKS.length);
    for (const s of schedulers)
      expect(s.pattern).toBe(
        CLEANUP_SCHEDULE[s.key.replace('cleanup:', '') as keyof typeof CLEANUP_SCHEDULE],
      );
  });

  it('the cleanup worker runs a queued task and rejects unknown ones', async () => {
    const user = await prisma.user.create({
      data: { email: 'w@example.com', name: 'w', passwordHash: 'x' },
    });
    await prisma.session.create({
      data: { userId: user.id, tokenHash: 'dead', csrfToken: 'c', expiresAt: ago(2) },
    });
    const q = new Queue(QUEUES.cleanup, { connection: conn() });
    closers.push(() => q.close());
    const worker = createCleanupWorker({
      connection: conn({ maxRetriesPerRequest: null }),
      deps: deps(),
    });
    closers.push(() => worker.close());
    await q.add('cleanup', { task: 'sessions' });
    for (let i = 0; i < 100 && (await prisma.session.count()) > 0; i++)
      await new Promise((r) => setTimeout(r, 50));
    expect(await prisma.session.count()).toBe(0);
    await q.add('cleanup', { task: 'drop-everything' }, { attempts: 1 });
    for (let i = 0; i < 100 && (await q.getFailedCount()) === 0; i++)
      await new Promise((r) => setTimeout(r, 50));
    expect((await q.getFailed())[0]?.failedReason).toMatch(/Unknown cleanup task/);
  });
});
