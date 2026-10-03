import {
  AppError,
  can,
  platformAtLeast,
  type Permission,
  type StaffRole,
  type WorkspaceRole,
} from '@go-short/shared';
import type { Request, RequestHandler } from 'express';
import type { AppContext } from '../context';
import { safeEqual, sha256 } from '../lib/crypto';
import { API_KEY_PATTERN } from '../services/apiKeys';
import { CONSOLE_COOKIE, SESSION_COOKIE } from '../services/sessions';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

async function authenticateApiKey(ctx: AppContext, req: Request, key: string): Promise<void> {
  // Shape check first: junk never reaches the database.
  if (!API_KEY_PATTERN.test(key)) return;
  const row = await ctx.prisma.apiKey.findUnique({
    where: { keyHash: sha256(key) },
    include: { createdBy: true },
  });
  const now = new Date();
  // A key stops working the moment its creator's account is suspended.
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= now) || row.createdBy.disabledAt)
    return;

  // Per-key fixed-window rate limit; fails open if Redis is down (logged).
  try {
    const rk = `rl:apikey:${row.id}`;
    const [[, count]] = (await ctx.redis.multi().incr(rk).expire(rk, 60, 'NX').exec()) as [
      [Error | null, number],
      unknown,
    ];
    const limit = ctx.config.API_KEY_RATE_LIMIT_PER_MINUTE;
    req.res?.setHeader('RateLimit-Limit', limit);
    req.res?.setHeader('RateLimit-Remaining', Math.max(0, limit - count));
    if (count > limit) {
      req.res?.setHeader('Retry-After', 60);
      throw new AppError('RATE_LIMITED', 'API key rate limit exceeded');
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    req.log.error({ err }, 'api key rate limiter unavailable, failing open');
  }

  // Touch lastUsedAt at most once a minute, off the request path.
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
    void ctx.prisma.apiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: now } })
      .catch((err) => req.log.warn({ err }, 'could not update apiKey.lastUsedAt'));
  }
  req.apiKey = { id: row.id, workspaceId: row.workspaceId, role: row.role };
  req.auth = {
    method: 'api_key',
    user: {
      id: row.createdBy.id,
      email: row.createdBy.email,
      name: row.createdBy.name,
      emailVerified: row.createdBy.emailVerified,
      // A key never carries system-admin powers, whatever its creator is.
      systemRole: 'USER',
    },
  };
  req.log = req.log.child({ apiKeyId: row.id });
}

/**
 * Resolves the caller into req.auth. `Authorization: Bearer gs_...` wins over a session cookie and,
 * when present but invalid, does NOT fall back to the cookie (no ambient-credential surprises).
 * Never rejects an unauthenticated request by itself; requireAuth does that.
 */
export const loadSession =
  (ctx: AppContext): RequestHandler =>
  async (req, _res, next) => {
    const header = req.get('authorization');
    if (header) {
      const m = /^Bearer\s+(\S+)$/i.exec(header);
      if (m?.[1]?.startsWith('gs_')) {
        if (!ctx.config.FEATURE_API)
          return next(new AppError('FEATURE_DISABLED', 'The API is disabled'));
        await authenticateApiKey(ctx, req, m[1]);
      }
      return next();
    }
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return next();
    const session = await ctx.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    // A suspended account has no working session, even if one somehow survived suspension.
    if (
      session &&
      session.scope === 'APP' &&
      session.expiresAt > new Date() &&
      !session.user.disabledAt
    ) {
      req.auth = {
        method: 'session',
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

/**
 * Console identity. Ignores whatever the app resolved (app cookie, API key) and reads ONLY the console
 * cookie, which must belong to a live CONSOLE session of an enabled account that still has a platform role.
 */
export const loadConsoleSession =
  (ctx: AppContext): RequestHandler =>
  async (req, _res, next) => {
    delete req.auth;
    delete req.apiKey;
    const token: unknown = req.cookies?.[CONSOLE_COOKIE];
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return next();
    const session = await ctx.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (
      session &&
      session.scope === 'CONSOLE' &&
      session.expiresAt > new Date() &&
      !session.user.disabledAt &&
      session.user.systemRole !== 'USER'
    ) {
      req.auth = {
        method: 'session',
        session: { id: session.id, csrfToken: session.csrfToken },
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          emailVerified: session.user.emailVerified,
          systemRole: session.user.systemRole,
        },
      };
      req.log = req.log.child({ userId: session.user.id, console: true });
    }
    next();
  };

/** 401 unless authenticated; for cookie sessions also enforces the CSRF header on unsafe methods. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(new AppError('UNAUTHENTICATED', 'Authentication required'));
  // API keys are bearer credentials (no ambient cookie), so CSRF does not apply to them.
  if (req.auth.method === 'session' && !SAFE_METHODS.has(req.method)) {
    const header = req.get('x-csrf-token');
    if (!header || !safeEqual(header, req.auth.session!.csrfToken)) {
      return next(new AppError('CSRF_INVALID', 'Missing or invalid CSRF token'));
    }
  }
  next();
};

/** For endpoints that act on the signed-in person (profile, workspaces list, key management). API keys are refused. */
export const requireSession: RequestHandler = (req, _res, next) =>
  req.auth?.method === 'session'
    ? next()
    : next(
        new AppError(
          'FORBIDDEN',
          'This endpoint requires a signed-in user session, not an API key',
        ),
      );

/** Flat `/api/v1/links`-style routes: the workspace comes from the key itself. */
export const requireApiKey: RequestHandler = (req, _res, next) =>
  req.apiKey
    ? next()
    : next(
        new AppError(
          'UNAUTHENTICATED',
          'A valid API key is required (Authorization: Bearer gs_...)',
        ),
      );

/**
 * Platform (console) gate: a signed-in SESSION whose platform role is at least `min`. API keys never
 * carry platform powers. Anyone else gets 403 (the console's existence is not a secret, the data is).
 */
export const requirePlatform =
  (min: StaffRole): RequestHandler =>
  (req, _res, next) =>
    req.auth?.method === 'session' && platformAtLeast(req.auth.user.systemRole, min)
      ? next()
      : next(new AppError('FORBIDDEN', 'Platform staff access required'));

/**
 * Tenant gate. For a signed-in user the workspace comes from the URL but access is decided solely
 * by the caller's membership row. For an API key the workspace is the key's own, and a URL naming a
 * different workspace is "not found". Non-members get 404 (existence is not leaked), members lacking
 * the permission get 403. Handlers must scope every query by req.workspace.id.
 */
export const requireWorkspace =
  (ctx: AppContext, permission: Permission): RequestHandler =>
  async (req, _res, next) => {
    if (!req.auth) return next(new AppError('UNAUTHENTICATED', 'Authentication required'));
    const urlWorkspaceId = req.params.workspaceId;
    let workspaceId: string;
    let role: WorkspaceRole;
    if (req.apiKey) {
      if (typeof urlWorkspaceId === 'string' && urlWorkspaceId !== req.apiKey.workspaceId) {
        return next(new AppError('WORKSPACE_NOT_FOUND', 'Workspace not found'));
      }
      workspaceId = req.apiKey.workspaceId;
      role = req.apiKey.role;
    } else {
      if (typeof urlWorkspaceId !== 'string')
        return next(new AppError('UNAUTHENTICATED', 'Authentication required'));
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: urlWorkspaceId, userId: req.auth.user.id } },
        select: { role: true },
      });
      if (!member) return next(new AppError('WORKSPACE_NOT_FOUND', 'Workspace not found'));
      workspaceId = urlWorkspaceId;
      role = member.role;
    }
    if (!can(role, permission))
      return next(new AppError('FORBIDDEN', 'You do not have permission to do this'));
    req.workspace = { id: workspaceId, role };
    req.log = req.log.child({ workspaceId });
    next();
  };
