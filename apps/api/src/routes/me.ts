import { Router } from 'express';
import type { AppContext } from '../context';
import { requireAuth, requireSession } from '../middleware/auth';
import { publicUser } from './auth';

export function meRouter(ctx: AppContext): Router {
  const r = Router();
  r.get('/', requireAuth, requireSession, async (req, res) => {
    const memberships = await ctx.prisma.workspaceMember.findMany({
      where: { userId: req.auth!.user.id },
      include: { workspace: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    res.json({
      success: true,
      data: {
        user: publicUser(req.auth!.user),
        csrfToken: req.auth!.session!.csrfToken,
        workspaces: memberships.map((m) => ({ ...m.workspace, role: m.role })),
      },
    });
  });
  return r;
}
