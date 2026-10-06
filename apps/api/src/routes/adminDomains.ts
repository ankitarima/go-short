import { AppError, normalizeHostname } from '@go-short/shared';
import { createSharedDomainSchema, updateSharedDomainSchema } from '@go-short/validation';
import type { Domain } from '@go-short/database';
import type { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { requirePlatform } from '../middleware/auth';
import { audit } from '../services/audit';
import { invalidateDomain } from '../services/cache';
import { cnameTargets, hostOnly, reservedHostnames } from '../services/domains';

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002';

/**
 * Shared short domains: the hostnames every workspace can put links on. Managed here instead of in
 * the environment. MANAGER and ADMIN can see them; SUPER_ADMIN changes them, because a wrong change
 * affects every customer's links. Every change is audited.
 */
export function registerSharedDomainRoutes(r: Router, ctx: AppContext): void {
  const { prisma } = ctx;
  const manage = requirePlatform('SUPER_ADMIN');

  const dto = (d: Domain, links: number) => ({
    id: d.id,
    hostname: d.hostname,
    status: d.status as 'VERIFIED' | 'DISABLED',
    isDefault: d.isDefault,
    linkCount: links,
    createdAt: d.createdAt,
  });

  async function findShared(id: string): Promise<Domain> {
    const d = await prisma.domain.findFirst({ where: { id, workspaceId: null } });
    if (!d) throw new AppError('DOMAIN_NOT_FOUND', 'Shared domain not found');
    return d;
  }

  r.get('/shared-domains', async (_req, res) => {
    const rows = await prisma.domain.findMany({
      where: { workspaceId: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      take: 200,
    });
    const counts = await prisma.link.groupBy({
      by: ['domainId'],
      where: { domainId: { in: rows.map((d) => d.id) } },
      _count: { _all: true },
    });
    const by = new Map(counts.map((c) => [c.domainId, c._count._all]));
    res.json({
      success: true,
      data: {
        domains: rows.map((d) => dto(d, by.get(d.id) ?? 0)),
        cnameTarget: (await cnameTargets(ctx)).primary,
        appHostname: new URL(ctx.config.APP_URL).hostname,
      },
    });
  });

  r.post('/shared-domains', manage, async (req, res) => {
    const input = createSharedDomainSchema.parse(req.body);
    const hostname = normalizeHostname(input.hostname);
    if (!hostname || /^\d+$/.test(hostname.split('.').pop()!)) {
      throw new AppError('VALIDATION_ERROR', 'Enter a valid domain name, e.g. go.example.com', [
        { path: 'hostname', message: 'Enter a valid domain name, e.g. go.example.com' },
      ]);
    }
    if (reservedHostnames(ctx).has(hostname)) {
      throw new AppError('DOMAIN_TAKEN', 'That is the app’s own hostname; use a different one', [
        { path: 'hostname', message: 'That is the app’s own hostname' },
      ]);
    }
    try {
      const created = await prisma.$transaction(async (tx) => {
        const hasDefault =
          (await tx.domain.count({
            where: { workspaceId: null, isDefault: true, status: 'VERIFIED' },
          })) > 0;
        const makeDefault = input.makeDefault === true || !hasDefault;
        if (makeDefault)
          await tx.domain.updateMany({
            where: { workspaceId: null, isDefault: true },
            data: { isDefault: false },
          });
        return tx.domain.create({
          data: {
            hostname,
            workspaceId: null,
            status: 'VERIFIED',
            isVerified: true,
            isDefault: makeDefault,
            verificationToken: 'shared',
          },
        });
      });
      await audit(ctx, {
        userId: req.auth!.user.id,
        action: 'SHARED_DOMAIN_ADDED',
        resourceType: 'domain',
        resourceId: created.id,
        metadata: { hostname, isDefault: created.isDefault },
      });
      res.status(201).json({ success: true, data: dto(created, 0) });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError(
          'DOMAIN_TAKEN',
          'That domain is already in use (as a shared domain or a workspace’s custom domain)',
          [{ path: 'hostname', message: 'Already in use' }],
        );
      throw err;
    }
  });

  r.patch('/shared-domains/:id', manage, async (req, res) => {
    const input = updateSharedDomainSchema.parse(req.body);
    const d = await findShared(z.string().parse(req.params.id));
    const disabling = input.disabled === true;
    if (disabling && d.isDefault)
      throw new AppError(
        'CONFLICT',
        'This is the default domain. Make another one the default first.',
      );
    if (disabling && d.status === 'VERIFIED') {
      const others = await prisma.domain.count({
        where: { workspaceId: null, status: 'VERIFIED', id: { not: d.id } },
      });
      if (others < 1) throw new AppError('CONFLICT', 'At least one shared domain must stay active');
    }
    if (input.isDefault && (d.status !== 'VERIFIED' || input.disabled === true))
      throw new AppError('DOMAIN_NOT_USABLE', 'Enable the domain before making it the default');
    const status =
      input.disabled === undefined ? d.status : input.disabled ? 'DISABLED' : 'VERIFIED';

    const updated = await prisma.$transaction(async (tx) => {
      if (input.isDefault)
        await tx.domain.updateMany({
          where: { workspaceId: null, isDefault: true },
          data: { isDefault: false },
        });
      return tx.domain.update({
        where: { id: d.id },
        data: {
          status,
          isVerified: true,
          ...(input.isDefault ? { isDefault: true } : {}),
        },
      });
    });
    // Cached redirects under a domain that was just switched off must stop working now, not at TTL.
    if (status !== d.status) await invalidateDomain(ctx, d.id, d.hostname);
    await audit(ctx, {
      userId: req.auth!.user.id,
      action: 'SHARED_DOMAIN_UPDATED',
      resourceType: 'domain',
      resourceId: d.id,
      metadata: {
        hostname: d.hostname,
        ...(input.isDefault ? { isDefault: true } : {}),
        ...(input.disabled !== undefined ? { disabled: input.disabled } : {}),
      },
    });
    res.json({
      success: true,
      data: dto(updated, await prisma.link.count({ where: { domainId: d.id } })),
    });
  });

  r.delete('/shared-domains/:id', manage, async (req, res) => {
    const d = await findShared(z.string().parse(req.params.id));
    if (d.isDefault)
      throw new AppError(
        'CONFLICT',
        'This is the default domain. Make another one the default first.',
      );
    const links = await prisma.link.count({ where: { domainId: d.id } });
    // Deleting would cascade to every link (and QR code) on it; make that a separate, deliberate step.
    if (links > 0)
      throw new AppError(
        'CONFLICT',
        `${links} link${links === 1 ? '' : 's'} still use this domain. Disable it instead, or move the links first.`,
      );
    await prisma.domain.delete({ where: { id: d.id } });
    await audit(ctx, {
      userId: req.auth!.user.id,
      action: 'SHARED_DOMAIN_REMOVED',
      resourceType: 'domain',
      resourceId: d.id,
      metadata: { hostname: d.hostname },
    });
    res.json({ success: true, data: {} });
  });

  /**
   * Does the hostname point at this server? Compares its addresses with the app's. A hint, not a gate:
   * behind a CDN or proxy the addresses can differ even though everything works, hence "unknown".
   */
  r.get('/shared-domains/:id/dns', async (req, res) => {
    const d = await findShared(z.string().parse(req.params.id));
    const host = hostOnly(d.hostname);
    const appHost = new URL(ctx.config.APP_URL).hostname;
    const [addresses, appAddresses] = await Promise.all([
      ctx.dns.resolveAddresses(host).catch(() => [] as string[]),
      ctx.dns.resolveAddresses(appHost).catch(() => [] as string[]),
    ]);
    const result: 'matches' | 'differs' | 'not_resolving' | 'unknown' =
      addresses.length === 0
        ? 'not_resolving'
        : appAddresses.length === 0
          ? 'unknown'
          : addresses.some((a) => appAddresses.includes(a))
            ? 'matches'
            : 'differs';
    res.json({ success: true, data: { hostname: host, addresses, appAddresses, result } });
  });
}
