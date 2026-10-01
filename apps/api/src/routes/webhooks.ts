import { randomUUID } from 'node:crypto';
import {
  AppError,
  UnsafeUrlError,
  WEBHOOK_JOB_OPTIONS,
  WEBHOOK_TEST_EVENT,
  type WebhookJob,
  sealSecret,
  validateOutboundUrl,
} from '@go-short/shared';
import { createWebhookSchema, updateWebhookSchema } from '@go-short/validation';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { randomToken } from '../lib/crypto';
import { requireSession, requireWorkspace } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { audit } from '../services/audit';

const MAX_WEBHOOKS = 10;

export function webhooksRouter(ctx: AppContext): Router {
  const r = Router({ mergeParams: true });
  const { prisma } = ctx;
  r.use(requireSession);

  /** Early feedback only; the authoritative SSRF defence runs at delivery time in the worker. */
  function checkUrl(raw: string): string {
    try {
      return validateOutboundUrl(raw, {
        allowInsecure: ctx.config.WEBHOOK_ALLOW_INSECURE,
      }).toString();
    } catch (err) {
      if (err instanceof UnsafeUrlError)
        throw new AppError('VALIDATION_ERROR', err.message, [
          { path: 'url', message: err.message },
        ]);
      throw err;
    }
  }
  const dto = (w: {
    id: string;
    url: string;
    events: string[];
    isActive: boolean;
    createdAt: Date;
  }) => ({
    id: w.id,
    url: w.url,
    events: w.events,
    isActive: w.isActive,
    createdAt: w.createdAt,
  });
  const newSecret = () => `whsec_${randomToken(24)}`;
  // Audit trails get the host only: webhook URLs often embed tokens in the path or query.
  const hostOf = (url: string) => new URL(url).host;

  async function find(workspaceId: string, id: string) {
    const w = await prisma.webhook.findFirst({ where: { id, workspaceId } });
    if (!w) throw new AppError('NOT_FOUND', 'Webhook not found');
    return w;
  }

  r.get('/', requireWorkspace(ctx, 'webhooks:manage'), async (req, res) => {
    const rows = await prisma.webhook.findMany({
      where: { workspaceId: req.workspace!.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_WEBHOOKS,
    });
    res.json({ success: true, data: rows.map(dto) });
  });

  r.post(
    '/',
    requireWorkspace(ctx, 'webhooks:manage'),
    rateLimit(ctx, {
      name: 'webhook-create',
      limit: 20,
      windowSeconds: 3600,
      key: (req) => req.workspace!.id,
    }),
    async (req, res) => {
      const input = createWebhookSchema.parse(req.body);
      const wsId = req.workspace!.id;
      const url = checkUrl(input.url);
      if ((await prisma.webhook.count({ where: { workspaceId: wsId } })) >= MAX_WEBHOOKS) {
        throw new AppError('CONFLICT', `A workspace can have at most ${MAX_WEBHOOKS} webhooks`);
      }
      const secret = newSecret();
      const w = await prisma.webhook.create({
        data: {
          workspaceId: wsId,
          url,
          events: input.events,
          secret: sealSecret(secret, ctx.config.SESSION_SECRET),
        },
      });
      await audit(ctx, {
        workspaceId: wsId,
        userId: req.auth!.user.id,
        action: 'WEBHOOK_CREATED',
        resourceType: 'webhook',
        resourceId: w.id,
        metadata: { host: hostOf(url), events: input.events },
      });
      res.setHeader('Cache-Control', 'no-store');
      // The signing secret is shown once; it is stored encrypted and can only be rotated, not read back.
      res.status(201).json({ success: true, data: { ...dto(w), secret } });
    },
  );

  r.patch('/:webhookId', requireWorkspace(ctx, 'webhooks:manage'), async (req, res) => {
    const input = updateWebhookSchema.parse(req.body);
    const before = await find(req.workspace!.id, z.string().parse(req.params.webhookId));
    const w = await prisma.webhook.update({
      where: { id: before.id },
      data: {
        ...(input.url !== undefined ? { url: checkUrl(input.url) } : {}),
        ...(input.events ? { events: input.events } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await audit(ctx, {
      workspaceId: w.workspaceId,
      userId: req.auth!.user.id,
      action: 'WEBHOOK_UPDATED',
      resourceType: 'webhook',
      resourceId: w.id,
      metadata: { fields: Object.keys(input) },
    });
    res.json({ success: true, data: dto(w) });
  });

  r.post(
    '/:webhookId/rotate-secret',
    requireWorkspace(ctx, 'webhooks:manage'),
    async (req, res) => {
      const before = await find(req.workspace!.id, z.string().parse(req.params.webhookId));
      const secret = newSecret();
      await prisma.webhook.update({
        where: { id: before.id },
        data: { secret: sealSecret(secret, ctx.config.SESSION_SECRET) },
      });
      await audit(ctx, {
        workspaceId: before.workspaceId,
        userId: req.auth!.user.id,
        action: 'WEBHOOK_SECRET_ROTATED',
        resourceType: 'webhook',
        resourceId: before.id,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: { id: before.id, secret } });
    },
  );

  r.post(
    '/:webhookId/test',
    requireWorkspace(ctx, 'webhooks:manage'),
    rateLimit(ctx, {
      name: 'webhook-test',
      limit: 10,
      windowSeconds: 60,
      key: (req) => req.workspace!.id,
    }),
    async (req, res) => {
      const w = await find(req.workspace!.id, z.string().parse(req.params.webhookId));
      const deliveryId = `del_${randomUUID()}`;
      const job: WebhookJob = {
        webhookId: w.id,
        deliveryId,
        type: WEBHOOK_TEST_EVENT,
        workspaceId: w.workspaceId,
        createdAt: new Date().toISOString(),
        data: { message: 'This is a test event from Go-Short.' },
      };
      await ctx.queues.webhooks.add('delivery', job, { ...WEBHOOK_JOB_OPTIONS, jobId: deliveryId });
      res.status(202).json({ success: true, data: { deliveryId } });
    },
  );

  r.delete('/:webhookId', requireWorkspace(ctx, 'webhooks:manage'), async (req, res) => {
    const w = await find(req.workspace!.id, z.string().parse(req.params.webhookId));
    await prisma.webhook.delete({ where: { id: w.id } });
    await audit(ctx, {
      workspaceId: w.workspaceId,
      userId: req.auth!.user.id,
      action: 'WEBHOOK_DELETED',
      resourceType: 'webhook',
      resourceId: w.id,
      metadata: { host: hostOf(w.url) },
    });
    res.json({ success: true, data: {} });
  });

  return r;
}
