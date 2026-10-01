import type { Campaign, Prisma } from '@go-short/database';
import { AppError } from '@go-short/shared';
import {
  createCampaignSchema,
  listCampaignsQuery,
  updateCampaignSchema,
} from '@go-short/validation';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { requireWorkspace } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { audit } from '../services/audit';
import { emitWebhook } from '../services/webhooks';
import { invalidateLinkKeys } from '../services/cache';
import { analyticsHandlers } from './analytics';

/** Prisma's `contains` does not escape LIKE wildcards. */
const escapeLike = (v: string) => v.replace(/[\\%_]/g, '\\$&');

type CampaignWithCounts = Campaign & { _count: { links: number; qrCodes: number } };

export function campaignsRouter(ctx: AppContext): Router {
  const r = Router({ mergeParams: true });
  const { prisma } = ctx;

  // Feature flag: campaigns can be switched off for the whole deployment.
  r.use((_req, _res, next) => {
    if (!ctx.config.FEATURE_CAMPAIGNS)
      return next(new AppError('FEATURE_DISABLED', 'Campaigns are disabled'));
    next();
  });

  const dto = (c: CampaignWithCounts) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    startDate: c.startDate,
    endDate: c.endDate,
    utmCampaign: c.utmCampaign,
    linkCount: c._count.links,
    qrCodeCount: c._count.qrCodes,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  });
  const withCounts = { _count: { select: { links: true, qrCodes: true } } } as const;

  async function find(workspaceId: string, id: string): Promise<CampaignWithCounts> {
    // Always scoped by workspace: another tenant's campaign id is simply "not found".
    const c = await prisma.campaign.findFirst({ where: { id, workspaceId }, include: withCounts });
    if (!c) throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign not found');
    return c;
  }

  r.get('/', requireWorkspace(ctx, 'campaigns:read'), async (req, res) => {
    const q = listCampaignsQuery.parse(req.query);
    const where: Prisma.CampaignWhereInput = {
      workspaceId: req.workspace!.id,
      ...(q.q ? { name: { contains: escapeLike(q.q), mode: 'insensitive' } } : {}),
    };
    const rows = await prisma.campaign.findMany({
      where,
      include: withCounts,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, q.limit);
    res.json({
      success: true,
      data: page.map(dto),
      nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null,
    });
  });

  r.post(
    '/',
    requireWorkspace(ctx, 'campaigns:write'),
    rateLimit(ctx, {
      name: 'campaign-create',
      limit: 60,
      windowSeconds: 60,
      key: (req) => req.workspace!.id,
    }),
    async (req, res) => {
      const input = createCampaignSchema.parse(req.body);
      const c = await prisma.campaign.create({
        data: { ...input, workspaceId: req.workspace!.id, createdBy: req.auth!.user.id },
        include: withCounts,
      });
      await audit(ctx, {
        workspaceId: c.workspaceId,
        userId: req.auth!.user.id,
        action: 'CAMPAIGN_CREATED',
        resourceType: 'campaign',
        resourceId: c.id,
        metadata: { name: c.name },
      });
      await emitWebhook(ctx, c.workspaceId, 'campaign.created', { campaign: dto(c) });
      res.status(201).json({ success: true, data: dto(c) });
    },
  );

  r.get('/:campaignId', requireWorkspace(ctx, 'campaigns:read'), async (req, res) => {
    res.json({
      success: true,
      data: dto(await find(req.workspace!.id, z.string().parse(req.params.campaignId))),
    });
  });

  r.patch('/:campaignId', requireWorkspace(ctx, 'campaigns:write'), async (req, res) => {
    const input = updateCampaignSchema.parse(req.body);
    const before = await find(req.workspace!.id, z.string().parse(req.params.campaignId));
    // The merged result must still have endDate >= startDate even when only one side is patched.
    const start = input.startDate === undefined ? before.startDate : input.startDate;
    const end = input.endDate === undefined ? before.endDate : input.endDate;
    if (start && end && end < start) {
      throw new AppError('VALIDATION_ERROR', 'endDate must not be before startDate', [
        { path: 'endDate', message: 'endDate must not be before startDate' },
      ]);
    }
    const c = await prisma.campaign.update({
      where: { id: before.id },
      data: input,
      include: withCounts,
    });
    await audit(ctx, {
      workspaceId: before.workspaceId,
      userId: req.auth!.user.id,
      action: 'CAMPAIGN_UPDATED',
      resourceType: 'campaign',
      resourceId: before.id,
      metadata: { fields: Object.keys(input) },
    });
    res.json({ success: true, data: dto(c) });
  });

  /**
   * Deleting a campaign keeps its links and QR codes (their campaign becomes empty). Cached redirect
   * entries carry the campaign id, so they are purged to stop new clicks being attributed to it.
   */
  r.delete('/:campaignId', requireWorkspace(ctx, 'campaigns:delete'), async (req, res) => {
    const c = await find(req.workspace!.id, z.string().parse(req.params.campaignId));
    const links = await prisma.link.findMany({
      where: { campaignId: c.id, workspaceId: c.workspaceId },
      select: { slug: true, domain: { select: { hostname: true } } },
    });
    await prisma.campaign.delete({ where: { id: c.id } });
    for (let i = 0; i < links.length; i += 1000) {
      await invalidateLinkKeys(
        ctx,
        links.slice(i, i + 1000).map((l) => ({ hostname: l.domain.hostname, slug: l.slug })),
      );
    }
    await audit(ctx, {
      workspaceId: c.workspaceId,
      userId: req.auth!.user.id,
      action: 'CAMPAIGN_DELETED',
      resourceType: 'campaign',
      resourceId: c.id,
      metadata: { name: c.name, detachedLinks: links.length },
    });
    res.json({ success: true, data: {} });
  });

  const analytics = analyticsHandlers(ctx);
  r.get('/:campaignId/analytics', requireWorkspace(ctx, 'analytics:read'), async (req, res) => {
    const c = await find(req.workspace!.id, z.string().parse(req.params.campaignId));
    await analytics.analytics(req, res, { campaignId: c.id });
  });
  r.get(
    '/:campaignId/analytics/export',
    requireWorkspace(ctx, 'analytics:export'),
    analytics.exportLimiter,
    async (req, res) => {
      const c = await find(req.workspace!.id, z.string().parse(req.params.campaignId));
      await analytics.export(req, res, { campaignId: c.id });
    },
  );

  return r;
}
