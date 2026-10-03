import { AppError, CLEANUP_TASKS, type CleanupTask } from '@go-short/shared';
import { adminListQuery } from '@go-short/validation';
import type { Prisma } from '@go-short/database';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { loadConsoleSession, requireAuth, requirePlatform } from '../middleware/auth';
import { consoleAuthRouter } from './adminAuth';
import { audit } from '../services/audit';
import { registerPlatformRoutes } from './adminPlatform';

/** Prisma's `contains` does not escape LIKE wildcards. */
const escapeLike = (v: string) => v.replace(/[\\%_]/g, '\\$&');

type QueueName = 'analytics' | 'cleanup' | 'webhooks';
const QUEUE_NAMES: readonly QueueName[] = ['analytics', 'cleanup', 'webhooks'];

/**
 * Platform console API. Session-only (API keys never reach it). Roles: MANAGER can read everything,
 * ADMIN can also act (suspend users, retry jobs, run cleanups), SUPER_ADMIN also manages staff.
 * Every response is built from explicit field lists, so password hashes, session/reset tokens, API
 * key hashes and webhook secrets can never leak, and analytics job payloads (which contain raw IPs)
 * are summarized rather than returned.
 */
export function adminRouter(ctx: AppContext): Router {
  const r = Router();
  const { prisma } = ctx;
  // Sign-in/out are public to this router and must not see any app credentials.
  r.use('/auth', consoleAuthRouter(ctx));
  r.use(loadConsoleSession(ctx), requireAuth, requirePlatform('MANAGER'));
  const act = requirePlatform('ADMIN');

  const page = <T extends { id: string }>(rows: T[], limit: number) => ({
    data: rows.slice(0, limit),
    nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
  });
  const cursorArgs = (cursor: string | undefined): { cursor?: { id: string }; skip?: number } =>
    cursor ? { cursor: { id: cursor }, skip: 1 } : {};

  r.get('/stats', async (_req, res) => {
    const [users, workspaces, domains, links, qrCodes, campaigns, est] = await Promise.all([
      prisma.user.count(),
      prisma.workspace.count(),
      prisma.domain.count(),
      prisma.link.count(),
      prisma.qRCode.count(),
      prisma.campaign.count(),
      // count(*) over a huge events table is slow; the planner's estimate is plenty for an operator overview.
      prisma.$queryRaw<
        { n: bigint }[]
      >`SELECT COALESCE(reltuples, 0)::bigint AS n FROM pg_class WHERE relname = 'ClickEvent'`,
    ]);
    const queues = await queueCounts();
    res.json({
      success: true,
      data: {
        users,
        workspaces,
        domains,
        links,
        qrCodes,
        campaigns,
        clickEventsEstimate: Number(est[0]?.n ?? 0),
        queues,
      },
    });
  });

  async function queueCounts() {
    const out: Record<string, Record<string, number>> = {};
    for (const n of QUEUE_NAMES) {
      try {
        out[n] = await ctx.queues[n].getJobCounts(
          'waiting',
          'active',
          'delayed',
          'failed',
          'completed',
        );
      } catch {
        out[n] = { error: 1 };
      }
    }
    return out;
  }

  r.get('/users', async (req, res) => {
    const q = adminListQuery.parse(req.query);
    const where: Prisma.UserWhereInput = {
      ...(q.staff === 'exclude'
        ? { systemRole: 'USER' }
        : q.staff === 'only'
          ? { systemRole: { not: 'USER' } }
          : {}),
      ...(q.q
        ? {
            OR: [
              { email: { contains: escapeLike(q.q), mode: 'insensitive' } },
              { name: { contains: escapeLike(q.q), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          emailVerified: true,
          systemRole: true,
          disabledAt: true,
          createdAt: true,
          _count: { select: { memberships: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        ...cursorArgs(q.cursor),
      }),
    ]);
    const p = page(rows, q.limit);
    res.json({
      success: true,
      data: p.data.map(({ _count, ...u }) => ({ ...u, workspaceCount: _count.memberships })),
      nextCursor: p.nextCursor,
      total,
    });
  });

  r.get('/workspaces', async (req, res) => {
    const q = adminListQuery.parse(req.query);
    const wsWhere: Prisma.WorkspaceWhereInput = q.q
      ? {
          OR: [
            { name: { contains: escapeLike(q.q), mode: 'insensitive' } },
            { slug: { contains: escapeLike(q.q), mode: 'insensitive' } },
          ],
        }
      : {};
    const [total, rows] = await Promise.all([
      prisma.workspace.count({ where: wsWhere }),
      prisma.workspace.findMany({
        where: wsWhere,
        select: {
          id: true,
          name: true,
          slug: true,
          timezone: true,
          retentionDays: true,
          createdAt: true,
          _count: { select: { members: true, links: true, domains: true, campaigns: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        ...cursorArgs(q.cursor),
      }),
    ]);
    const p = page(rows, q.limit);
    res.json({
      success: true,
      total,
      data: p.data.map(({ _count, ...w }) => ({
        ...w,
        memberCount: _count.members,
        linkCount: _count.links,
        domainCount: _count.domains,
        campaignCount: _count.campaigns,
      })),
      nextCursor: p.nextCursor,
    });
  });

  r.get('/domains', async (req, res) => {
    const q = adminListQuery.parse(req.query);
    const where: Prisma.DomainWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
      ...(q.q ? { hostname: { contains: escapeLike(q.q), mode: 'insensitive' } } : {}),
    };
    const rows = await prisma.domain.findMany({
      where,
      select: {
        id: true,
        hostname: true,
        status: true,
        isVerified: true,
        isDefault: true,
        workspaceId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...cursorArgs(q.cursor),
    });
    const p = page(rows, q.limit);
    res.json({
      success: true,
      data: p.data.map((d) => ({ ...d, shared: d.workspaceId === null })),
      nextCursor: p.nextCursor,
    });
  });

  r.get('/links', async (req, res) => {
    const q = adminListQuery.parse(req.query);
    const where: Prisma.LinkWhereInput = {
      ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
      ...(q.q
        ? {
            OR: [
              { slug: { contains: escapeLike(q.q), mode: 'insensitive' } },
              { destinationUrl: { contains: escapeLike(q.q), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const rows = await prisma.link.findMany({
      where,
      select: {
        id: true,
        workspaceId: true,
        slug: true,
        destinationUrl: true,
        isActive: true,
        expiresAt: true,
        createdAt: true,
        passwordHash: true,
        domain: { select: { hostname: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...cursorArgs(q.cursor),
    });
    const p = page(rows, q.limit);
    res.json({
      success: true,
      data: p.data.map(({ passwordHash, domain, ...l }) => ({
        ...l,
        hostname: domain.hostname,
        hasPassword: passwordHash !== null,
      })),
      nextCursor: p.nextCursor,
    });
  });

  r.get('/audit-logs', async (req, res) => {
    const q = adminListQuery.parse(req.query);
    const rows = await prisma.auditLog.findMany({
      where: {
        ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
        ...(q.action ? { action: q.action } : {}),
        ...(q.q
          ? {
              OR: [
                { action: { contains: escapeLike(q.q), mode: 'insensitive' } },
                { user: { email: { contains: escapeLike(q.q), mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { user: { select: { email: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...cursorArgs(q.cursor),
    });
    const p = page(rows, q.limit);
    res.json({
      success: true,
      data: p.data.map(({ user, ...l }) => ({ ...l, actor: user })),
      nextCursor: p.nextCursor,
    });
  });

  // ---- queues and failed jobs (the dead-letter view) ------------------------------------------
  const queueParam = (v: unknown): QueueName => {
    const n = z.enum(['analytics', 'cleanup', 'webhooks']).safeParse(v);
    if (!n.success) throw new AppError('NOT_FOUND', 'Unknown queue');
    return n.data;
  };

  r.get('/queues', async (_req, res) => {
    res.json({ success: true, data: await queueCounts() });
  });

  /** Never return job payloads: analytics events contain raw IP addresses. */
  const summarize = (queue: QueueName, data: Record<string, unknown> | undefined) => {
    if (!data) return {};
    if (queue === 'analytics')
      return { batchId: data.batchId, events: Array.isArray(data.events) ? data.events.length : 0 };
    if (queue === 'webhooks')
      return { webhookId: data.webhookId, deliveryId: data.deliveryId, type: data.type };
    return { task: data.task };
  };

  r.get('/queues/:queue/failed', async (req, res) => {
    const name = queueParam(req.params.queue);
    const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit);
    const jobs = await ctx.queues[name].getFailed(0, limit - 1);
    res.json({
      success: true,
      data: jobs.map((j) => ({
        id: j.id,
        name: j.name,
        attemptsMade: j.attemptsMade,
        failedReason: j.failedReason,
        createdAt: new Date(j.timestamp).toISOString(),
        failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
        summary: summarize(name, j.data as Record<string, unknown>),
      })),
    });
  });

  r.post('/queues/:queue/failed/:jobId/retry', act, async (req, res) => {
    const name = queueParam(req.params.queue);
    const job = await ctx.queues[name].getJob(z.string().parse(req.params.jobId));
    if (!job || !(await job.isFailed())) throw new AppError('NOT_FOUND', 'Failed job not found');
    await job.retry('failed');
    await audit(ctx, {
      userId: req.auth!.user.id,
      action: 'ADMIN_JOB_RETRIED',
      resourceType: 'job',
      resourceId: job.id,
      metadata: { queue: name },
    });
    res.json({ success: true, data: {} });
  });

  r.delete('/queues/:queue/failed/:jobId', act, async (req, res) => {
    const name = queueParam(req.params.queue);
    const job = await ctx.queues[name].getJob(z.string().parse(req.params.jobId));
    if (!job || !(await job.isFailed())) throw new AppError('NOT_FOUND', 'Failed job not found');
    await job.remove();
    await audit(ctx, {
      userId: req.auth!.user.id,
      action: 'ADMIN_JOB_REMOVED',
      resourceType: 'job',
      resourceId: job.id,
      metadata: { queue: name },
    });
    res.json({ success: true, data: {} });
  });

  r.post('/cleanup/:task/run', act, async (req, res) => {
    const task = z.enum(CLEANUP_TASKS).safeParse(req.params.task);
    if (!task.success) throw new AppError('NOT_FOUND', 'Unknown cleanup task');
    const t: CleanupTask = task.data;
    await ctx.queues.cleanup.add(
      'cleanup',
      { task: t },
      { removeOnComplete: { age: 3600 }, removeOnFail: { age: 14 * 86_400 }, attempts: 1 },
    );
    await audit(ctx, {
      userId: req.auth!.user.id,
      action: 'ADMIN_CLEANUP_TRIGGERED',
      resourceType: 'cleanup',
      metadata: { task: t },
    });
    res.status(202).json({ success: true, data: { task: t } });
  });

  registerPlatformRoutes(r, ctx);
  return r;
}
