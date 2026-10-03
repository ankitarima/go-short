import {
  AppError,
  PLATFORM_CAPABILITIES,
  STAFF_ROLES,
  platformAtLeast,
  type PlatformRole,
} from '@go-short/shared';
import {
  addStaffSchema,
  monitoringRangeQuery,
  teamsQuery,
  updateStaffSchema,
  usageQuery,
} from '@go-short/validation';
import type { Prisma } from '@go-short/database';
import type { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { requirePlatform } from '../middleware/auth';
import { audit } from '../services/audit';
import { METRICS, metricByName, metricRange, metricsSummary } from '../services/monitoring';

const escapeLike = (v: string) => v.replace(/[\\%_]/g, '\\$&');
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Zero-filled daily series over the last `days` days (UTC), oldest first. */
function fill(days: number, rows: Array<{ d: string; n: number }>) {
  const by = new Map(rows.map((r) => [r.d, r.n]));
  const out: Array<{ date: string; count: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = isoDay(new Date(Date.now() - i * 86_400_000));
    out.push({ date, count: by.get(date) ?? 0 });
  }
  return out;
}

/**
 * Console endpoints beyond the original operator area: identity, usage analytics, user/workspace
 * detail, account suspension, teams, platform staff, and metrics. Roles: MANAGER reads, ADMIN
 * changes users, SUPER_ADMIN manages staff. Every change is audited.
 */
export function registerPlatformRoutes(r: Router, ctx: AppContext): void {
  const { prisma } = ctx;

  r.get('/me', async (req, res) => {
    const u = req.auth!.user;
    const role = u.systemRole as Exclude<PlatformRole, 'USER'>;
    res.json({
      success: true,
      data: {
        user: { id: u.id, email: u.email, name: u.name },
        role,
        capabilities: PLATFORM_CAPABILITIES[role],
        links: {
          grafana: ctx.config.CONSOLE_GRAFANA_URL ?? null,
          prometheus: ctx.config.CONSOLE_PROMETHEUS_URL ?? null,
        },
        metricsConfigured: Boolean(ctx.config.PROMETHEUS_URL),
      },
    });
  });

  // ---- usage analytics --------------------------------------------------------------------------
  r.get('/usage', async (req, res) => {
    const { days } = usageQuery.parse(req.query);
    const since = new Date(Date.now() - days * 86_400_000);
    const sinceDay = isoDay(since);
    const daily = (table: 'User' | 'Workspace' | 'Link') =>
      prisma.$queryRawUnsafe<{ d: string; n: number }[]>(
        `SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS d, count(*)::int AS n
         FROM "${table}" WHERE "createdAt" >= $1 GROUP BY 1`,
        since,
      );
    const [signups, workspaces, links, clicks, top, active] = await Promise.all([
      daily('User'),
      daily('Workspace'),
      daily('Link'),
      prisma.$queryRaw<{ d: string; n: number }[]>`
        SELECT to_char("date", 'YYYY-MM-DD') AS d, SUM("clicks")::int AS n
        FROM "AnalyticsDaily" WHERE "date" >= ${sinceDay}::date GROUP BY 1`,
      prisma.$queryRaw<{ workspaceId: string; clicks: number }[]>`
        SELECT "workspaceId", SUM("clicks")::int AS clicks
        FROM "AnalyticsDaily" WHERE "date" >= ${sinceDay}::date
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      prisma.$queryRaw<{ n: number }[]>`
        SELECT count(DISTINCT "workspaceId")::int AS n FROM "AnalyticsDaily" WHERE "date" >= ${sinceDay}::date`,
    ]);
    const names = await prisma.workspace.findMany({
      where: { id: { in: top.map((t) => t.workspaceId) } },
      select: { id: true, name: true, slug: true },
    });
    const clickSeries = fill(days, clicks);
    res.json({
      success: true,
      data: {
        days,
        totals: {
          signups: signups.reduce((a, b) => a + b.n, 0),
          workspacesCreated: workspaces.reduce((a, b) => a + b.n, 0),
          linksCreated: links.reduce((a, b) => a + b.n, 0),
          clicks: clickSeries.reduce((a, b) => a + b.count, 0),
          activeWorkspaces: active[0]?.n ?? 0,
        },
        signups: fill(days, signups),
        workspacesCreated: fill(days, workspaces),
        linksCreated: fill(days, links),
        clicks: clickSeries,
        topWorkspaces: top.map((t) => ({
          workspaceId: t.workspaceId,
          name: names.find((n) => n.id === t.workspaceId)?.name ?? '(deleted)',
          slug: names.find((n) => n.id === t.workspaceId)?.slug ?? '',
          clicks: t.clicks,
        })),
      },
    });
  });

  // ---- user and workspace detail ------------------------------------------------------------------
  r.get('/users/:userId', async (req, res) => {
    const id = z.string().parse(req.params.userId);
    const u = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        emailVerified: true,
        systemRole: true,
        disabledAt: true,
        createdAt: true,
        memberships: {
          select: {
            role: true,
            createdAt: true,
            workspace: { select: { id: true, name: true, slug: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 100,
        },
        _count: { select: { sessions: true, apiKeys: true } },
      },
    });
    if (!u) throw new AppError('NOT_FOUND', 'User not found');
    const { memberships, _count, ...rest } = u;
    res.json({
      success: true,
      data: {
        ...rest,
        activeSessions: _count.sessions,
        apiKeyCount: _count.apiKeys,
        workspaces: memberships.map((m) => ({
          ...m.workspace,
          role: m.role,
          joinedAt: m.createdAt,
        })),
      },
    });
  });

  const setDisabled = (disable: boolean) =>
    [
      requirePlatform('ADMIN'),
      async (req: import('express').Request, res: import('express').Response) => {
        const id = z.string().parse(req.params.userId);
        const actor = req.auth!.user;
        if (id === actor.id)
          throw new AppError('FORBIDDEN', 'You cannot change your own account status');
        const target = await prisma.user.findUnique({
          where: { id },
          select: { id: true, email: true, systemRole: true, disabledAt: true },
        });
        if (!target) throw new AppError('NOT_FOUND', 'User not found');
        // Staff accounts can only be suspended by a super admin (an admin must not lock out their superiors).
        if (target.systemRole !== 'USER' && !platformAtLeast(actor.systemRole, 'SUPER_ADMIN'))
          throw new AppError('FORBIDDEN', 'Only a super admin can change a staff account');
        if (disable && target.systemRole === 'SUPER_ADMIN') await assertAnotherSuperAdmin(id);
        await prisma.$transaction([
          prisma.user.update({ where: { id }, data: { disabledAt: disable ? new Date() : null } }),
          // Suspension ends every session immediately; API keys stop working through the creator check.
          ...(disable ? [prisma.session.deleteMany({ where: { userId: id } })] : []),
        ]);
        await audit(ctx, {
          userId: actor.id,
          action: disable ? 'ADMIN_USER_DISABLED' : 'ADMIN_USER_ENABLED',
          resourceType: 'user',
          resourceId: id,
          metadata: { email: target.email },
        });
        res.json({ success: true, data: { id, disabled: disable } });
      },
    ] as const;
  r.post('/users/:userId/disable', ...setDisabled(true));
  r.post('/users/:userId/enable', ...setDisabled(false));

  r.get('/workspaces/:workspaceId', async (req, res) => {
    const id = z.string().parse(req.params.workspaceId);
    const w = await prisma.workspace.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        timezone: true,
        retentionDays: true,
        hashIps: true,
        filterBots: true,
        createdAt: true,
        members: {
          select: {
            role: true,
            createdAt: true,
            user: { select: { id: true, email: true, name: true, disabledAt: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 200,
        },
        domains: { select: { id: true, hostname: true, status: true }, take: 50 },
        _count: {
          select: { links: true, campaigns: true, qrCodes: true, apiKeys: true, webhooks: true },
        },
      },
    });
    if (!w) throw new AppError('WORKSPACE_NOT_FOUND', 'Workspace not found');
    const since = isoDay(new Date(Date.now() - 30 * 86_400_000));
    const [c] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COALESCE(SUM("clicks"), 0)::int AS n FROM "AnalyticsDaily"
      WHERE "workspaceId" = ${id} AND "date" >= ${since}::date`;
    const { members, domains, _count, ...rest } = w;
    res.json({
      success: true,
      data: {
        ...rest,
        clicksLast30Days: c?.n ?? 0,
        counts: {
          links: _count.links,
          campaigns: _count.campaigns,
          qrCodes: _count.qrCodes,
          apiKeys: _count.apiKeys,
          webhooks: _count.webhooks,
        },
        members: members.map((m) => ({
          userId: m.user.id,
          email: m.user.email,
          name: m.user.name,
          disabled: m.user.disabledAt !== null,
          role: m.role,
          joinedAt: m.createdAt,
        })),
        domains,
      },
    });
  });

  // ---- teams: every membership on the platform -----------------------------------------------------
  r.get('/teams', async (req, res) => {
    const q = teamsQuery.parse(req.query);
    const where: Prisma.WorkspaceMemberWhereInput = {
      ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
      ...(q.role ? { role: q.role } : {}),
      ...(q.q
        ? {
            OR: [
              { user: { email: { contains: escapeLike(q.q), mode: 'insensitive' } } },
              { user: { name: { contains: escapeLike(q.q), mode: 'insensitive' } } },
              { workspace: { name: { contains: escapeLike(q.q), mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const rows = await prisma.workspaceMember.findMany({
      where,
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true, disabledAt: true } },
        workspace: { select: { id: true, name: true, slug: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const data = rows.slice(0, q.limit).map((m) => ({
      id: m.id,
      role: m.role,
      joinedAt: m.createdAt,
      user: {
        id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        disabled: m.user.disabledAt !== null,
      },
      workspace: m.workspace,
    }));
    res.json({
      success: true,
      data,
      nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
    });
  });

  // ---- platform staff -------------------------------------------------------------------------------
  const staffSelect = {
    id: true,
    email: true,
    name: true,
    systemRole: true,
    disabledAt: true,
    createdAt: true,
  } as const;
  const staffDto = (u: {
    id: string;
    email: string;
    name: string;
    systemRole: string;
    disabledAt: Date | null;
    createdAt: Date;
  }) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.systemRole,
    disabled: u.disabledAt !== null,
    createdAt: u.createdAt,
  });

  async function assertAnotherSuperAdmin(excludeId: string) {
    const others = await prisma.user.count({
      where: { systemRole: 'SUPER_ADMIN', disabledAt: null, id: { not: excludeId } },
    });
    if (others < 1)
      throw new AppError('CONFLICT', 'There must always be at least one active super admin');
  }

  r.get('/staff', async (_req, res) => {
    const rows = await prisma.user.findMany({
      where: { systemRole: { in: [...STAFF_ROLES] } },
      select: staffSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    res.json({ success: true, data: rows.map(staffDto) });
  });

  r.post('/staff', requirePlatform('SUPER_ADMIN'), async (req, res) => {
    const { email, role } = addStaffSchema.parse(req.body);
    const target = await prisma.user.findUnique({ where: { email }, select: staffSelect });
    if (!target)
      throw new AppError(
        'NOT_FOUND',
        'There is no account with that email. They must register first.',
      );
    if (target.systemRole !== 'USER')
      throw new AppError('CONFLICT', 'That person is already platform staff');
    if (target.disabledAt) throw new AppError('CONFLICT', 'That account is disabled');
    const u = await prisma.user.update({
      where: { id: target.id },
      data: { systemRole: role },
      select: staffSelect,
    });
    await audit(ctx, {
      userId: req.auth!.user.id,
      action: 'STAFF_ADDED',
      resourceType: 'user',
      resourceId: u.id,
      metadata: { email: u.email, role },
    });
    res.status(201).json({ success: true, data: staffDto(u) });
  });

  r.patch('/staff/:userId', requirePlatform('SUPER_ADMIN'), async (req, res) => {
    const id = z.string().parse(req.params.userId);
    const { role } = updateStaffSchema.parse(req.body);
    if (id === req.auth!.user.id)
      throw new AppError('FORBIDDEN', 'You cannot change your own role');
    const target = await prisma.user.findUnique({ where: { id }, select: staffSelect });
    if (!target || target.systemRole === 'USER')
      throw new AppError('NOT_FOUND', 'Staff member not found');
    if (target.systemRole === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN')
      await assertAnotherSuperAdmin(id);
    const u = await prisma.user.update({
      where: { id },
      data: { systemRole: role },
      select: staffSelect,
    });
    await audit(ctx, {
      userId: req.auth!.user.id,
      action: 'STAFF_ROLE_CHANGED',
      resourceType: 'user',
      resourceId: id,
      metadata: { email: u.email, from: target.systemRole, to: role },
    });
    res.json({ success: true, data: staffDto(u) });
  });

  r.delete('/staff/:userId', requirePlatform('SUPER_ADMIN'), async (req, res) => {
    const id = z.string().parse(req.params.userId);
    if (id === req.auth!.user.id)
      throw new AppError('FORBIDDEN', 'You cannot remove your own staff access');
    const target = await prisma.user.findUnique({ where: { id }, select: staffSelect });
    if (!target || target.systemRole === 'USER')
      throw new AppError('NOT_FOUND', 'Staff member not found');
    if (target.systemRole === 'SUPER_ADMIN') await assertAnotherSuperAdmin(id);
    await prisma.user.update({ where: { id }, data: { systemRole: 'USER' } });
    await audit(ctx, {
      userId: req.auth!.user.id,
      action: 'STAFF_REMOVED',
      resourceType: 'user',
      resourceId: id,
      metadata: { email: target.email, was: target.systemRole },
    });
    res.json({ success: true, data: {} });
  });

  // ---- monitoring (Prometheus through a fixed allow-list) -----------------------------------------------
  r.get('/monitoring', async (_req, res) => {
    res.json({
      success: true,
      data: {
        configured: Boolean(ctx.config.PROMETHEUS_URL),
        links: {
          grafana: ctx.config.CONSOLE_GRAFANA_URL ?? null,
          prometheus: ctx.config.CONSOLE_PROMETHEUS_URL ?? null,
        },
        metrics: ctx.config.PROMETHEUS_URL
          ? await metricsSummary(ctx)
          : METRICS.map((m) => ({ name: m.name, label: m.label, unit: m.unit, value: null })),
      },
    });
  });

  r.get('/monitoring/range', async (req, res) => {
    const q = monitoringRangeQuery.parse(req.query);
    const def = metricByName(q.query);
    if (!def) throw new AppError('NOT_FOUND', 'Unknown metric');
    res.json({
      success: true,
      data: {
        name: def.name,
        label: def.label,
        unit: def.unit,
        minutes: q.minutes,
        points: await metricRange(ctx, def, q.minutes),
      },
    });
  });
}
