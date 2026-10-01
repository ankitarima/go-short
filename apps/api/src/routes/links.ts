import { Prisma, type Domain, type Link } from '@go-short/database';
import {
  AppError,
  UrlValidationError,
  checkCustomSlug,
  generateSlug,
  normalizeDestinationUrl,
} from '@go-short/shared';
import { createLinkSchema, listLinksQuery, updateLinkSchema } from '@go-short/validation';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { hashPassword } from '../lib/password';
import { requireWorkspace } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { audit } from '../services/audit';
import { analyticsHandlers } from './analytics';
import { invalidateLinkKeys } from '../services/cache';
import { reservedHostnames, requireUsableDomain } from '../services/domains';

/** Prisma's `contains` does not escape LIKE wildcards; without this, `%` would match every row. */
const escapeLike = (v: string) => v.replace(/[\\%_]/g, '\\$&');

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002';
type LinkWithDomain = Link & { domain: Pick<Domain, 'hostname'> };

export function linksRouter(ctx: AppContext): Router {
  const r = Router({ mergeParams: true });
  const { prisma } = ctx;

  const dto = (l: LinkWithDomain) => {
    const host = l.domain.hostname;
    const scheme = host.includes(':') || host === 'localhost' ? 'http' : 'https';
    return {
      id: l.id,
      domainId: l.domainId,
      hostname: host,
      slug: l.slug,
      shortUrl: `${scheme}://${host}/${l.slug}`,
      destinationUrl: l.destinationUrl,
      title: l.title,
      description: l.description,
      campaignId: l.campaignId,
      isActive: l.isActive,
      expiresAt: l.expiresAt,
      expired: l.expiresAt !== null && l.expiresAt < new Date(),
      hasPassword: l.passwordHash !== null, // the hash itself is never returned
      redirectStatus: l.redirectStatus,
      utmSource: l.utmSource,
      utmMedium: l.utmMedium,
      utmCampaign: l.utmCampaign,
      utmTerm: l.utmTerm,
      utmContent: l.utmContent,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    };
  };

  async function findLink(workspaceId: string, id: string): Promise<LinkWithDomain> {
    const l = await prisma.link.findFirst({
      where: { id, workspaceId },
      include: { domain: { select: { hostname: true } } },
    });
    if (!l) throw new AppError('LINK_NOT_FOUND', 'Link not found');
    return l;
  }

  async function defaultDomain(workspaceId: string): Promise<Domain> {
    const d =
      (await prisma.domain.findFirst({
        where: { workspaceId, isDefault: true, status: 'VERIFIED' },
      })) ??
      (await prisma.domain.findFirst({
        where: { workspaceId: null, status: 'VERIFIED' },
        orderBy: { isDefault: 'desc' },
      }));
    if (!d) throw new AppError('DOMAIN_NOT_FOUND', 'No usable domain is configured');
    return d;
  }

  async function checkDestination(raw: string): Promise<string> {
    let url: string;
    try {
      url = normalizeDestinationUrl(raw);
    } catch (err) {
      if (err instanceof UrlValidationError)
        throw new AppError('VALIDATION_ERROR', err.message, [
          { path: 'destinationUrl', message: err.message },
        ]);
      throw err;
    }
    // Redirect-loop / open-relay guard: destinations may not point back at any short-link domain.
    const u = new URL(url);
    const hosts = [u.hostname, u.host];
    const isPlatform =
      hosts.some((h) => reservedHostnames(ctx).has(h)) ||
      (await prisma.domain.count({ where: { hostname: { in: hosts }, status: 'VERIFIED' } })) > 0;
    if (isPlatform)
      throw new AppError('VALIDATION_ERROR', 'Destination cannot point to a short-link domain', [
        { path: 'destinationUrl', message: 'Points to a short-link domain' },
      ]);
    return url;
  }

  async function checkCampaign(workspaceId: string, campaignId: string | null | undefined) {
    if (!campaignId) return;
    if (!ctx.config.FEATURE_CAMPAIGNS)
      throw new AppError('FEATURE_DISABLED', 'Campaigns are disabled');
    // Scoped by workspace: a campaign id from another tenant is simply "not found".
    const c = await prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId },
      select: { id: true, utmCampaign: true },
    });
    if (!c) throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign not found');
    return c;
  }

  function checkSlug(slug: string) {
    const c = checkCustomSlug(slug, ctx.config.RESERVED_SLUGS);
    if (c.ok) return;
    if (c.reason === 'reserved') throw new AppError('SLUG_RESERVED', 'That slug is reserved');
    throw new AppError(
      'SLUG_INVALID',
      c.reason === 'length'
        ? 'Slug must be 3-64 characters'
        : 'Slug may only contain letters, numbers, hyphens and underscores',
    );
  }

  async function passwordHashFor(
    password: string | null | undefined,
  ): Promise<string | null | undefined> {
    if (password === undefined || password === null) return password;
    if (!ctx.config.FEATURE_PASSWORD_LINKS)
      throw new AppError('FEATURE_DISABLED', 'Password-protected links are disabled');
    return hashPassword(password);
  }

  r.get('/', requireWorkspace(ctx, 'links:read'), async (req, res) => {
    const q = listLinksQuery.parse(req.query);
    const where: Prisma.LinkWhereInput = {
      workspaceId: req.workspace!.id,
      ...(q.campaignId ? { campaignId: q.campaignId } : {}),
      ...(q.domainId ? { domainId: q.domainId } : {}),
      ...(q.isActive !== undefined ? { isActive: q.isActive } : {}),
      ...(q.q
        ? {
            OR: [
              { slug: { contains: escapeLike(q.q), mode: 'insensitive' } },
              { title: { contains: escapeLike(q.q), mode: 'insensitive' } },
              { destinationUrl: { contains: escapeLike(q.q), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const rows = await prisma.link.findMany({
      where,
      include: { domain: { select: { hostname: true } } },
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
    requireWorkspace(ctx, 'links:write'),
    rateLimit(ctx, {
      name: 'link-create',
      limit: 120,
      windowSeconds: 60,
      key: (req) => req.workspace!.id,
    }),
    async (req, res) => {
      const {
        password,
        domainId,
        slug: customSlug,
        destinationUrl,
        ...rest
      } = createLinkSchema.parse(req.body);
      const wsId = req.workspace!.id;
      const domain = domainId
        ? await requireUsableDomain(ctx, wsId, domainId)
        : await defaultDomain(wsId);
      const url = await checkDestination(destinationUrl);
      const campaign = await checkCampaign(wsId, rest.campaignId);
      // A link in a campaign inherits the campaign's default utm_campaign unless it sets its own.
      if (campaign?.utmCampaign && rest.utmCampaign === undefined)
        rest.utmCampaign = campaign.utmCampaign;
      if (customSlug !== undefined) checkSlug(customSlug);
      const passwordHash = await passwordHashFor(password);

      let link: LinkWithDomain | undefined;
      for (let attempt = 0; attempt < 5 && !link; attempt++) {
        try {
          link = await prisma.link.create({
            data: {
              ...rest,
              workspaceId: wsId,
              domainId: domain.id,
              slug: customSlug ?? generateSlug(),
              destinationUrl: url,
              passwordHash: passwordHash ?? null,
              createdBy: req.auth!.user.id,
            },
            include: { domain: { select: { hostname: true } } },
          });
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          if (customSlug !== undefined)
            throw new AppError('SLUG_TAKEN', 'That slug is already in use on this domain');
        }
      }
      if (!link) throw new AppError('CONFLICT', 'Could not allocate a unique slug, please retry');
      // Clears any negative-cache entry from earlier lookups of this slug.
      await invalidateLinkKeys(ctx, [{ hostname: link.domain.hostname, slug: link.slug }]);
      await audit(ctx, {
        workspaceId: wsId,
        userId: req.auth!.user.id,
        action: 'LINK_CREATED',
        resourceType: 'link',
        resourceId: link.id,
        metadata: { hostname: link.domain.hostname, slug: link.slug },
      });
      res.status(201).json({ success: true, data: dto(link) });
    },
  );

  const analytics = analyticsHandlers(ctx);
  r.get('/:linkId/analytics', requireWorkspace(ctx, 'analytics:read'), async (req, res) => {
    const l = await findLink(req.workspace!.id, z.string().parse(req.params.linkId));
    await analytics.analytics(req, res, { linkId: l.id });
  });
  r.get(
    '/:linkId/analytics/export',
    requireWorkspace(ctx, 'analytics:export'),
    analytics.exportLimiter,
    async (req, res) => {
      const l = await findLink(req.workspace!.id, z.string().parse(req.params.linkId));
      await analytics.export(req, res, { linkId: l.id });
    },
  );

  r.get('/:linkId', requireWorkspace(ctx, 'links:read'), async (req, res) => {
    res.json({
      success: true,
      data: dto(await findLink(req.workspace!.id, z.string().parse(req.params.linkId))),
    });
  });

  r.patch('/:linkId', requireWorkspace(ctx, 'links:write'), async (req, res) => {
    const input = updateLinkSchema.parse(req.body);
    const wsId = req.workspace!.id;
    const before = await findLink(wsId, z.string().parse(req.params.linkId));
    const { password, domainId, slug, destinationUrl, ...rest } = input;

    const domain = domainId !== undefined ? await requireUsableDomain(ctx, wsId, domainId) : null;
    if (slug !== undefined) checkSlug(slug);
    const data: Prisma.LinkUncheckedUpdateInput = { ...rest };
    if (destinationUrl !== undefined) data.destinationUrl = await checkDestination(destinationUrl);
    if (rest.campaignId !== undefined) {
      const campaign = await checkCampaign(wsId, rest.campaignId);
      // Moving a link into a campaign fills a missing utm_campaign from the campaign default.
      if (campaign?.utmCampaign && rest.utmCampaign === undefined && !before.utmCampaign) {
        data.utmCampaign = campaign.utmCampaign;
      }
    }
    if (domain) data.domainId = domain.id;
    if (slug !== undefined) data.slug = slug;
    if (password !== undefined) data.passwordHash = await passwordHashFor(password);

    let after: LinkWithDomain;
    try {
      after = await prisma.link.update({
        where: { id: before.id },
        data,
        include: { domain: { select: { hostname: true } } },
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError('SLUG_TAKEN', 'That slug is already in use on this domain');
      throw err;
    }
    // Old and new location may differ (slug or domain change): clear both.
    await invalidateLinkKeys(ctx, [
      { hostname: before.domain.hostname, slug: before.slug },
      { hostname: after.domain.hostname, slug: after.slug },
    ]);
    await audit(ctx, {
      workspaceId: wsId,
      userId: req.auth!.user.id,
      action: 'LINK_UPDATED',
      resourceType: 'link',
      resourceId: before.id,
      metadata: { fields: Object.keys(input).filter((k) => k !== 'password') },
    });
    res.json({ success: true, data: dto(after) });
  });

  r.delete('/:linkId', requireWorkspace(ctx, 'links:delete'), async (req, res) => {
    const l = await findLink(req.workspace!.id, z.string().parse(req.params.linkId));
    await prisma.link.delete({ where: { id: l.id } });
    await invalidateLinkKeys(ctx, [{ hostname: l.domain.hostname, slug: l.slug }]);
    await audit(ctx, {
      workspaceId: req.workspace!.id,
      userId: req.auth!.user.id,
      action: 'LINK_DELETED',
      resourceType: 'link',
      resourceId: l.id,
      metadata: { hostname: l.domain.hostname, slug: l.slug },
    });
    res.json({ success: true, data: {} });
  });

  for (const [path, isActive] of [
    ['enable', true],
    ['disable', false],
  ] as const) {
    r.post(`/:linkId/${path}`, requireWorkspace(ctx, 'links:write'), async (req, res) => {
      const l = await findLink(req.workspace!.id, z.string().parse(req.params.linkId));
      const updated = await prisma.link.update({
        where: { id: l.id },
        data: { isActive },
        include: { domain: { select: { hostname: true } } },
      });
      await invalidateLinkKeys(ctx, [{ hostname: l.domain.hostname, slug: l.slug }]);
      await audit(ctx, {
        workspaceId: req.workspace!.id,
        userId: req.auth!.user.id,
        action: isActive ? 'LINK_ENABLED' : 'LINK_DISABLED',
        resourceType: 'link',
        resourceId: l.id,
      });
      res.json({ success: true, data: dto(updated) });
    });
  }

  return r;
}
