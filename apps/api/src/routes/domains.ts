import { AppError, normalizeHostname } from '@go-short/shared';
import { createDomainSchema, updateDomainSchema } from '@go-short/validation';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { randomToken } from '../lib/crypto';
import { requireWorkspace } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { audit } from '../services/audit';
import { emitWebhook } from '../services/webhooks';
import { invalidateDomain } from '../services/cache';
import { checkDomainDns } from '../services/dns';
import { cnameTargets, domainDto, reservedHostnames } from '../services/domains';

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002';

export function domainsRouter(ctx: AppContext): Router {
  const r = Router({ mergeParams: true });
  const { prisma } = ctx;

  // Feature flag: custom domains can be switched off for the whole deployment.
  r.use((_req, _res, next) => {
    if (!ctx.config.FEATURE_CUSTOM_DOMAINS)
      return next(new AppError('FEATURE_DISABLED', 'Custom domains are disabled'));
    next();
  });

  async function findOwned(workspaceId: string, id: string) {
    // Scoped by workspace: the shared domain (workspaceId null) is deliberately not editable here.
    const d = await prisma.domain.findFirst({ where: { id, workspaceId } });
    if (!d) throw new AppError('DOMAIN_NOT_FOUND', 'Domain not found');
    return d;
  }

  r.get('/', requireWorkspace(ctx, 'domains:read'), async (req, res) => {
    const rows = await prisma.domain.findMany({
      where: { OR: [{ workspaceId: req.workspace!.id }, { workspaceId: null }] },
      orderBy: [{ workspaceId: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      take: 200,
    });
    const { primary } = await cnameTargets(ctx);
    res.json({ success: true, data: rows.map((d) => domainDto(d, primary)) });
  });

  r.get('/:domainId', requireWorkspace(ctx, 'domains:read'), async (req, res) => {
    const id = z.string().parse(req.params.domainId);
    const d = await prisma.domain.findFirst({
      where: { id, OR: [{ workspaceId: req.workspace!.id }, { workspaceId: null }] },
    });
    if (!d) throw new AppError('DOMAIN_NOT_FOUND', 'Domain not found');
    res.json({ success: true, data: domainDto(d, (await cnameTargets(ctx)).primary) });
  });

  r.post(
    '/',
    requireWorkspace(ctx, 'domains:manage'),
    rateLimit(ctx, {
      name: 'domain-add',
      limit: 20,
      windowSeconds: 3600,
      key: (req) => req.workspace!.id,
    }),
    async (req, res) => {
      const { hostname: raw } = createDomainSchema.parse(req.body);
      const hostname = normalizeHostname(raw);
      // Reject non-hostnames, IP literals (all-numeric TLD) and anything that would shadow the platform itself.
      if (!hostname || /^\d+$/.test(hostname.split('.').pop()!)) {
        throw new AppError('VALIDATION_ERROR', 'Enter a valid domain name, e.g. links.example.com');
      }
      if (reservedHostnames(ctx).has(hostname))
        throw new AppError('DOMAIN_TAKEN', 'That domain is reserved by the platform');
      try {
        const d = await prisma.domain.create({
          data: { workspaceId: req.workspace!.id, hostname, verificationToken: randomToken(24) },
        });
        await audit(ctx, {
          workspaceId: req.workspace!.id,
          userId: req.auth!.user.id,
          action: 'DOMAIN_ADDED',
          resourceType: 'domain',
          resourceId: d.id,
          metadata: { hostname },
        });
        res
          .status(201)
          .json({ success: true, data: domainDto(d, (await cnameTargets(ctx)).primary) });
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('DOMAIN_TAKEN', 'That domain is already in use');
        throw err;
      }
    },
  );

  r.post(
    '/:domainId/verify',
    requireWorkspace(ctx, 'domains:manage'),
    rateLimit(ctx, {
      name: 'domain-verify',
      limit: 10,
      windowSeconds: 60,
      key: (req) => req.workspace!.id,
    }),
    async (req, res) => {
      const d = await findOwned(req.workspace!.id, z.string().parse(req.params.domainId));
      const cname = await cnameTargets(ctx);
      if (d.isVerified)
        return void res.json({
          success: true,
          data: { verified: true, domain: domainDto(d, cname.primary) },
        });
      const check = await checkDomainDns(ctx.dns, d.hostname, d.verificationToken, cname.accepted);
      if (!check.ok)
        return void res.json({
          success: true,
          data: { verified: false, domain: domainDto(d, cname.primary) },
        });
      const updated = await prisma.domain.update({
        where: { id: d.id },
        data: { isVerified: true, status: 'VERIFIED' },
      });
      await audit(ctx, {
        workspaceId: d.workspaceId!,
        userId: req.auth!.user.id,
        action: 'DOMAIN_VERIFIED',
        resourceType: 'domain',
        resourceId: d.id,
        metadata: { method: check.method },
      });
      // Only public fields: never the verification token.
      await emitWebhook(ctx, d.workspaceId!, 'domain.verified', {
        domain: { id: d.id, hostname: d.hostname, status: updated.status },
      });
      res.json({
        success: true,
        data: {
          verified: true,
          method: check.method,
          domain: domainDto(updated, cname.primary),
        },
      });
    },
  );

  r.patch('/:domainId', requireWorkspace(ctx, 'domains:manage'), async (req, res) => {
    const input = updateDomainSchema.parse(req.body);
    const wsId = req.workspace!.id;
    const d = await findOwned(wsId, z.string().parse(req.params.domainId));
    if (!d.isVerified && (input.isDefault || input.disabled === false)) {
      throw new AppError('DOMAIN_NOT_USABLE', 'Verify the domain first');
    }
    if (input.isDefault && d.status === 'DISABLED' && input.disabled !== false) {
      throw new AppError('DOMAIN_NOT_USABLE', 'A disabled domain cannot be the default');
    }
    const status =
      input.disabled === undefined
        ? d.status
        : input.disabled
          ? 'DISABLED'
          : d.isVerified
            ? 'VERIFIED'
            : 'PENDING';
    const updated = await prisma.$transaction(async (tx) => {
      if (input.isDefault)
        await tx.domain.updateMany({
          where: { workspaceId: wsId, isDefault: true },
          data: { isDefault: false },
        });
      return tx.domain.update({
        where: { id: d.id },
        data: {
          status,
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.disabled ? { isDefault: false } : {}),
        },
      });
    });
    // Disabling a domain must stop already-cached links from redirecting.
    if (status !== d.status) await invalidateDomain(ctx, d.id, d.hostname);
    await audit(ctx, {
      workspaceId: wsId,
      userId: req.auth!.user.id,
      action: 'DOMAIN_UPDATED',
      resourceType: 'domain',
      resourceId: d.id,
      metadata: { fields: Object.keys(input) },
    });
    res.json({ success: true, data: domainDto(updated, (await cnameTargets(ctx)).primary) });
  });

  r.delete('/:domainId', requireWorkspace(ctx, 'domains:manage'), async (req, res) => {
    const d = await findOwned(req.workspace!.id, z.string().parse(req.params.domainId));
    // Deleting would cascade to links and their QR codes; make that an explicit, separate decision.
    if ((await prisma.link.count({ where: { domainId: d.id } })) > 0) {
      throw new AppError('CONFLICT', 'This domain still has links. Delete or move them first.');
    }
    await prisma.domain.delete({ where: { id: d.id } });
    await audit(ctx, {
      workspaceId: req.workspace!.id,
      userId: req.auth!.user.id,
      action: 'DOMAIN_REMOVED',
      resourceType: 'domain',
      resourceId: d.id,
      metadata: { hostname: d.hostname },
    });
    res.json({ success: true, data: {} });
  });

  return r;
}
