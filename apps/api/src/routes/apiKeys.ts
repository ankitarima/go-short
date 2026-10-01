import { AppError } from '@go-short/shared';
import { createApiKeySchema } from '@go-short/validation';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { requireSession, requireWorkspace } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { generateApiKey } from '../services/apiKeys';
import { audit } from '../services/audit';

const MAX_ACTIVE_KEYS = 50;

/** Key management is for signed-in people only: an API key can never mint, list or revoke keys. */
export function apiKeysRouter(ctx: AppContext): Router {
  const r = Router({ mergeParams: true });
  const { prisma } = ctx;
  r.use(requireSession);

  const dto = (k: {
    id: string;
    name: string;
    keyPrefix: string;
    role: string;
    createdAt: Date;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdBy?: { id: string; name: string };
  }) => ({
    id: k.id,
    name: k.name,
    // Only the public prefix is ever shown again; the secret part cannot be recovered.
    keyPrefix: `${k.keyPrefix}…`,
    role: k.role,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    expiresAt: k.expiresAt,
    revokedAt: k.revokedAt,
    ...(k.createdBy ? { createdBy: k.createdBy } : {}),
  });

  r.get('/', requireWorkspace(ctx, 'apikeys:manage'), async (req, res) => {
    const rows = await prisma.apiKey.findMany({
      where: { workspaceId: req.workspace!.id },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    res.json({ success: true, data: rows.map(dto) });
  });

  r.post(
    '/',
    requireWorkspace(ctx, 'apikeys:manage'),
    rateLimit(ctx, {
      name: 'apikey-create',
      limit: 20,
      windowSeconds: 3600,
      key: (req) => req.workspace!.id,
    }),
    async (req, res) => {
      if (!ctx.config.FEATURE_API) throw new AppError('FEATURE_DISABLED', 'The API is disabled');
      const input = createApiKeySchema.parse(req.body);
      const wsId = req.workspace!.id;
      const active = await prisma.apiKey.count({
        where: {
          workspaceId: wsId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (active >= MAX_ACTIVE_KEYS)
        throw new AppError(
          'CONFLICT',
          `A workspace can have at most ${MAX_ACTIVE_KEYS} active API keys`,
        );
      const { key, keyPrefix, keyHash } = generateApiKey();
      const row = await prisma.apiKey.create({
        data: {
          workspaceId: wsId,
          createdById: req.auth!.user.id,
          name: input.name,
          role: input.role,
          expiresAt: input.expiresAt ?? null,
          keyPrefix,
          keyHash,
        },
      });
      await audit(ctx, {
        workspaceId: wsId,
        userId: req.auth!.user.id,
        action: 'API_KEY_CREATED',
        resourceType: 'api_key',
        resourceId: row.id,
        // Never the key itself: only its public prefix.
        metadata: { name: row.name, role: row.role, keyPrefix },
      });
      res.setHeader('Cache-Control', 'no-store');
      // The ONLY time the full key is ever returned.
      res.status(201).json({ success: true, data: { ...dto(row), key } });
    },
  );

  r.delete('/:keyId', requireWorkspace(ctx, 'apikeys:manage'), async (req, res) => {
    const id = z.string().parse(req.params.keyId);
    const k = await prisma.apiKey.findFirst({ where: { id, workspaceId: req.workspace!.id } });
    if (!k) throw new AppError('NOT_FOUND', 'API key not found');
    if (!k.revokedAt) {
      await prisma.apiKey.update({ where: { id: k.id }, data: { revokedAt: new Date() } });
      await audit(ctx, {
        workspaceId: k.workspaceId,
        userId: req.auth!.user.id,
        action: 'API_KEY_REVOKED',
        resourceType: 'api_key',
        resourceId: k.id,
        metadata: { name: k.name, keyPrefix: k.keyPrefix },
      });
    }
    res.json({ success: true, data: {} });
  });

  return r;
}
