import { AppError, canAssignRole, type WorkspaceRole } from '@go-short/shared';
import {
  createWorkspaceSchema,
  cursorQuery,
  inviteMemberSchema,
  updateMemberSchema,
  updateWorkspaceSchema,
} from '@go-short/validation';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { randomToken, sha256 } from '../lib/crypto';
import { requireAuth, requireSession, requireWorkspace } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { domainsRouter } from './domains';
import { analyticsRouter } from './analytics';
import { apiKeysRouter } from './apiKeys';
import { campaignsRouter } from './campaigns';
import { linksRouter } from './links';
import { qrRouter } from './qr';
import { webhooksRouter } from './webhooks';
import { audit } from '../services/audit';

const DAY = 24 * 60 * 60 * 1000;

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '');
  return base.length >= 3 ? base : 'workspace';
}

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002';

export function workspacesRouter(ctx: AppContext): Router {
  const r = Router();
  const { prisma } = ctx;
  r.use(requireAuth);

  // Listing/creating workspaces and accepting invitations act on the person, so API keys are refused.
  r.get('/', requireSession, async (req, res) => {
    const rows = await prisma.workspaceMember.findMany({
      where: { userId: req.auth!.user.id },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    res.json({
      success: true,
      data: rows.map((m) => ({ ...pubWorkspace(m.workspace), role: m.role })),
    });
  });

  r.post(
    '/',
    requireSession,
    rateLimit(ctx, {
      name: 'ws-create',
      limit: 20,
      windowSeconds: 3600,
      key: (req) => req.auth!.user.id,
    }),
    async (req, res) => {
      const input = createWorkspaceSchema.parse(req.body);
      const userId = req.auth!.user.id;
      const explicit = input.slug !== undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        const slug = explicit
          ? input.slug!
          : attempt === 0
            ? slugify(input.name)
            : `${slugify(input.name)}-${randomToken(3)
                .toLowerCase()
                .replace(/[^a-z0-9]/g, 'x')}`;
        try {
          const ws = await prisma.workspace.create({
            data: { name: input.name, slug, members: { create: { userId, role: 'OWNER' } } },
          });
          await audit(ctx, {
            workspaceId: ws.id,
            userId,
            action: 'WORKSPACE_CREATED',
            resourceType: 'workspace',
            resourceId: ws.id,
          });
          res.status(201).json({ success: true, data: { ...pubWorkspace(ws), role: 'OWNER' } });
          return;
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          if (explicit) throw new AppError('CONFLICT', 'That workspace slug is already taken');
        }
      }
      throw new AppError('CONFLICT', 'Could not allocate a workspace slug, please choose one');
    },
  );

  // Accepting an invitation happens before the caller is a member, so it lives outside :workspaceId.
  r.post(
    '/invitations/accept',
    requireSession,
    rateLimit(ctx, { name: 'invite-accept', limit: 20, windowSeconds: 900 }),
    async (req, res) => {
      const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
      const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) } });
      // Same error for unknown, used, expired, and wrong-recipient so tokens can't be probed.
      if (
        !inv ||
        inv.acceptedAt ||
        inv.expiresAt < new Date() ||
        inv.email !== req.auth!.user.email
      ) {
        throw new AppError('NOT_FOUND', 'Invitation is invalid or has expired');
      }
      await prisma.$transaction([
        prisma.workspaceMember.upsert({
          where: {
            workspaceId_userId: { workspaceId: inv.workspaceId, userId: req.auth!.user.id },
          },
          create: { workspaceId: inv.workspaceId, userId: req.auth!.user.id, role: inv.role },
          update: {},
        }),
        prisma.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
      ]);
      await audit(ctx, {
        workspaceId: inv.workspaceId,
        userId: req.auth!.user.id,
        action: 'MEMBER_JOINED',
        resourceType: 'member',
      });
      res.json({ success: true, data: { workspaceId: inv.workspaceId } });
    },
  );

  const ws = Router({ mergeParams: true });
  r.use('/:workspaceId', ws);

  ws.use('/domains', domainsRouter(ctx));
  ws.use('/links', linksRouter(ctx));
  ws.use('/analytics', analyticsRouter(ctx));
  ws.use('/campaigns', campaignsRouter(ctx));
  ws.use('/qr', qrRouter(ctx));
  ws.use('/api-keys', apiKeysRouter(ctx));
  ws.use('/webhooks', webhooksRouter(ctx));

  ws.get('/', requireWorkspace(ctx, 'workspace:read'), async (req, res) => {
    const w = await prisma.workspace.findUniqueOrThrow({ where: { id: req.workspace!.id } });
    res.json({ success: true, data: { ...pubWorkspace(w), role: req.workspace!.role } });
  });

  ws.patch('/', requireWorkspace(ctx, 'workspace:update'), async (req, res) => {
    const input = updateWorkspaceSchema.parse(req.body);
    const w = await prisma.workspace.update({ where: { id: req.workspace!.id }, data: input });
    await audit(ctx, {
      workspaceId: w.id,
      userId: req.auth!.user.id,
      action: 'WORKSPACE_UPDATED',
      resourceType: 'workspace',
      resourceId: w.id,
      metadata: { fields: Object.keys(input) },
    });
    res.json({ success: true, data: pubWorkspace(w) });
  });

  ws.delete('/', requireWorkspace(ctx, 'workspace:delete'), async (req, res) => {
    await prisma.workspace.delete({ where: { id: req.workspace!.id } });
    await audit(ctx, {
      userId: req.auth!.user.id,
      action: 'WORKSPACE_DELETED',
      resourceType: 'workspace',
      resourceId: req.workspace!.id,
    });
    res.json({ success: true, data: {} });
  });

  ws.get('/members', requireWorkspace(ctx, 'members:read'), async (req, res) => {
    const rows = await prisma.workspaceMember.findMany({
      where: { workspaceId: req.workspace!.id },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    res.json({
      success: true,
      data: rows.map((m) => ({ id: m.id, role: m.role, createdAt: m.createdAt, user: m.user })),
    });
  });

  ws.post(
    '/members/invite',
    requireWorkspace(ctx, 'members:manage'),
    // Each invite sends an email, so cap per workspace to prevent use as a spam relay.
    rateLimit(ctx, {
      name: 'invite',
      limit: 30,
      windowSeconds: 3600,
      key: (req) => req.workspace!.id,
    }),
    inviteHandler,
  );

  async function inviteHandler(req: Request, res: Response) {
    const input = inviteMemberSchema.parse(req.body);
    if (!canAssignRole(req.workspace!.role, input.role))
      throw new AppError('FORBIDDEN', 'You cannot grant a role above your own');
    const alreadyMember = await prisma.workspaceMember.findFirst({
      where: { workspaceId: req.workspace!.id, user: { email: input.email } },
      select: { id: true },
    });
    if (alreadyMember)
      throw new AppError('CONFLICT', 'That person is already a member of this workspace');
    const token = randomToken(32);
    // A new invite supersedes any pending one for the same address (old links stop working).
    const [, inv] = await prisma.$transaction([
      prisma.invitation.deleteMany({
        where: { workspaceId: req.workspace!.id, email: input.email, acceptedAt: null },
      }),
      prisma.invitation.create({
        data: {
          workspaceId: req.workspace!.id,
          email: input.email,
          role: input.role,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + 7 * DAY),
        },
      }),
    ]);
    await ctx.email.send({
      to: input.email,
      subject: 'You have been invited to a workspace',
      text: `Accept: ${ctx.config.APP_URL}/accept-invite?token=${token}`,
    });
    await audit(ctx, {
      workspaceId: req.workspace!.id,
      userId: req.auth!.user.id,
      action: 'MEMBER_INVITED',
      resourceType: 'invitation',
      resourceId: inv.id,
      metadata: { email: input.email, role: input.role },
    });
    res.status(201).json({
      success: true,
      data: { id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt },
    });
  }

  ws.patch('/members/:memberId', requireWorkspace(ctx, 'members:manage'), async (req, res) => {
    const { role } = updateMemberSchema.parse(req.body);
    const memberId = z.string().parse(req.params.memberId);
    const updated = await prisma.$transaction(async (tx) => {
      const target = await tx.workspaceMember.findFirst({
        where: { id: memberId, workspaceId: req.workspace!.id },
      });
      if (!target) throw new AppError('NOT_FOUND', 'Member not found');
      // Must be allowed to hand out the new role AND to touch the current one.
      if (
        !canAssignRole(req.workspace!.role, role) ||
        !canAssignRole(req.workspace!.role, target.role)
      ) {
        throw new AppError('FORBIDDEN', 'You cannot change this member to that role');
      }
      if (target.role === 'OWNER' && role !== 'OWNER')
        await assertAnotherOwner(tx, req.workspace!.id, target.id);
      const m = await tx.workspaceMember.update({ where: { id: target.id }, data: { role } });
      // A demoted member's API keys can never exceed the member's own power.
      if (role === 'VIEWER') {
        await tx.apiKey.updateMany({
          where: { workspaceId: m.workspaceId, createdById: m.userId, role: { not: 'VIEWER' } },
          data: { role: 'VIEWER' },
        });
      }
      return m;
    });
    await audit(ctx, {
      workspaceId: req.workspace!.id,
      userId: req.auth!.user.id,
      action: 'MEMBER_ROLE_CHANGED',
      resourceType: 'member',
      resourceId: updated.id,
      metadata: { role },
    });
    res.json({ success: true, data: { id: updated.id, role: updated.role } });
  });

  // Any member may remove themselves (leave); removing others needs members:manage.
  ws.delete(
    '/members/:memberId',
    requireSession,
    requireWorkspace(ctx, 'workspace:read'),
    async (req, res) => {
      const memberId = z.string().parse(req.params.memberId);
      await prisma.$transaction(async (tx) => {
        const target = await tx.workspaceMember.findFirst({
          where: { id: memberId, workspaceId: req.workspace!.id },
        });
        if (!target) throw new AppError('NOT_FOUND', 'Member not found');
        const self = target.userId === req.auth!.user.id;
        if (!self && !canAssignRole(req.workspace!.role, target.role))
          throw new AppError('FORBIDDEN', 'You cannot remove this member');
        if (target.role === 'OWNER') await assertAnotherOwner(tx, req.workspace!.id, target.id);
        await tx.workspaceMember.delete({ where: { id: target.id } });
        // Keys act as their creator, so they die with the membership.
        await tx.apiKey.updateMany({
          where: { workspaceId: target.workspaceId, createdById: target.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });
      await audit(ctx, {
        workspaceId: req.workspace!.id,
        userId: req.auth!.user.id,
        action: 'MEMBER_REMOVED',
        resourceType: 'member',
        resourceId: memberId,
      });
      res.json({ success: true, data: {} });
    },
  );

  ws.get('/audit-logs', requireWorkspace(ctx, 'audit:read'), async (req, res) => {
    const { limit, cursor } = cursorQuery.parse(req.query);
    const rows = await prisma.auditLog.findMany({
      where: { workspaceId: req.workspace!.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    res.json({
      success: true,
      data: page,
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
    });
  });

  return r;
}

type Tx = Parameters<Parameters<AppContext['prisma']['$transaction']>[0]>[0];
async function assertAnotherOwner(tx: Tx, workspaceId: string, excludingMemberId: string) {
  const others = await tx.workspaceMember.count({
    where: { workspaceId, role: 'OWNER' satisfies WorkspaceRole, id: { not: excludingMemberId } },
  });
  if (others === 0) throw new AppError('CONFLICT', 'A workspace must keep at least one owner');
}

const pubWorkspace = (w: {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  hashIps: boolean;
  filterBots: boolean;
  retentionDays: number | null;
  createdAt: Date;
}) => ({
  id: w.id,
  name: w.name,
  slug: w.slug,
  timezone: w.timezone,
  hashIps: w.hashIps,
  filterBots: w.filterBots,
  retentionDays: w.retentionDays,
  createdAt: w.createdAt,
});
