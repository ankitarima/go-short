import { AppError } from '@go-short/shared';
import { analyticsQuery, exportQuery } from '@go-short/validation';
import { type Request, type Response, Router } from 'express';
import type { AppContext } from '../context';
import { requireWorkspace } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { type Scope, queryAnalytics, resolveRange } from '../services/analytics';
import { streamDailyCsv, streamEventsCsv } from '../services/export';

/** Shared by /analytics, /links/:id/analytics and /campaigns/:id/analytics. */
export function analyticsHandlers(ctx: AppContext) {
  async function settings(workspaceId: string) {
    return ctx.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { timezone: true, filterBots: true },
    });
  }

  /** Filters from the query string are verified to belong to the workspace; foreign ids are simply "not found". */
  async function scopeFor(
    req: Request,
    fixed: Partial<Scope> = {},
    qLinkId?: string,
    qCampaignId?: string,
  ): Promise<Scope> {
    const workspaceId = req.workspace!.id;
    const scope: Scope = { workspaceId, ...fixed };
    if (!scope.linkId && qLinkId) {
      if (
        !(await ctx.prisma.link.findFirst({
          where: { id: qLinkId, workspaceId },
          select: { id: true },
        }))
      )
        throw new AppError('LINK_NOT_FOUND', 'Link not found');
      scope.linkId = qLinkId;
    }
    if (!scope.campaignId && qCampaignId) {
      if (
        !(await ctx.prisma.campaign.findFirst({
          where: { id: qCampaignId, workspaceId },
          select: { id: true },
        }))
      )
        throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign not found');
      scope.campaignId = qCampaignId;
    }
    return scope;
  }

  return {
    async analytics(req: Request, res: Response, fixed: Partial<Scope> = {}) {
      const q = analyticsQuery.parse(req.query);
      const scope = await scopeFor(req, fixed, q.linkId, q.campaignId);
      const data = await queryAnalytics(ctx, scope, q, await settings(scope.workspaceId));
      res.json({ success: true, data });
    },
    async export(req: Request, res: Response, fixed: Partial<Scope> = {}) {
      const q = exportQuery.parse(req.query);
      const scope = await scopeFor(req, fixed, q.linkId, q.campaignId);
      const ws = await settings(scope.workspaceId);
      const r = await resolveRange(ctx, { ...q, granularity: 'day', limit: 10 }, ws);
      await (q.type === 'events'
        ? streamEventsCsv(ctx, res, scope, r)
        : streamDailyCsv(ctx, res, scope, r));
    },
    exportLimiter: rateLimit(ctx, {
      name: 'analytics-export',
      limit: 5,
      windowSeconds: 60,
      key: (req) => req.workspace!.id,
    }),
  };
}

export function analyticsRouter(ctx: AppContext): Router {
  const r = Router({ mergeParams: true });
  const h = analyticsHandlers(ctx);
  r.get('/', requireWorkspace(ctx, 'analytics:read'), (req, res) => h.analytics(req, res));
  r.get('/export', requireWorkspace(ctx, 'analytics:export'), h.exportLimiter, (req, res) =>
    h.export(req, res),
  );
  return r;
}
