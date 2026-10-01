import { AppError, can, type Permission } from '@go-short/shared';
import type { RequestHandler } from 'express';
import type { AppContext } from '../context';
import { safeEqual, sha256 } from '../lib/crypto';
import { SESSION_COOKIE } from '../services/sessions';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Resolves the session cookie (if any) into req.auth. Never rejects on its own. */
export const loadSession =
  (ctx: AppContext): RequestHandler =>
  async (req, _res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return next();
    const session = await ctx.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (session && session.expiresAt > new Date()) {
      req.auth = {
        session: { id: session.id, csrfToken: session.csrfToken },
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          emailVerified: session.user.emailVerified,
          systemRole: session.user.systemRole,
        },
      };
      req.log = req.log.child({ userId: session.user.id });
    }
    next();
  };

/** 401 unless authenticated; for cookie sessions also enforces the CSRF header on unsafe methods. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(new AppError('UNAUTHENTICATED', 'Authentication required'));
  if (!SAFE_METHODS.has(req.method)) {
    const header = req.get('x-csrf-token');
    if (!header || !safeEqual(header, req.auth.session.csrfToken)) {
      return next(new AppError('CSRF_INVALID', 'Missing or invalid CSRF token'));
    }
  }
  next();
};

export const requireSystemAdmin: RequestHandler = (req, _res, next) =>
  req.auth?.user.systemRole === 'ADMIN'
    ? next()
    : next(new AppError('FORBIDDEN', 'Admin access required'));

/**
 * Tenant gate for /workspaces/:workspaceId/*. The workspace id comes from the URL but access is
 * decided solely by the caller's membership row: non-members get 404 (existence is not leaked),
 * members lacking the permission get 403. Handlers must scope every query by req.workspace.id.
 */
export const requireWorkspace =
  (ctx: AppContext, permission: Permission): RequestHandler =>
  async (req, _res, next) => {
    const workspaceId = req.params.workspaceId;
    if (!req.auth || typeof workspaceId !== 'string')
      return next(new AppError('UNAUTHENTICATED', 'Authentication required'));
    const member = await ctx.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: req.auth.user.id } },
      select: { role: true },
    });
    if (!member) return next(new AppError('WORKSPACE_NOT_FOUND', 'Workspace not found'));
    if (!can(member.role, permission))
      return next(new AppError('FORBIDDEN', 'You do not have permission to do this'));
    req.workspace = { id: workspaceId, role: member.role };
    req.log = req.log.child({ workspaceId });
    next();
  };
