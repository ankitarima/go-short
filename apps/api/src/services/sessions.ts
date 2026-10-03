import type { Request } from 'express';
import type { AppContext } from '../context';
import { randomToken, sha256 } from '../lib/crypto';

export const SESSION_COOKIE = 'gs_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Console sessions are separate from app sessions: their own cookie (only ever sent to the admin API),
 * a short lifetime, SameSite=Strict, and a staff-only login. Signing in to the console does not sign you in
 * to the app, and an app session cannot open the console.
 */
export const CONSOLE_COOKIE = 'gs_console';
export const CONSOLE_COOKIE_PATH = '/api/v1/admin';
export const CONSOLE_TTL_MS = 8 * 60 * 60 * 1000;

export type SessionScope = 'APP' | 'CONSOLE';

export async function createSession(
  ctx: AppContext,
  userId: string,
  req: Request,
  scope: SessionScope = 'APP',
) {
  const token = randomToken(32);
  await ctx.prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      csrfToken: randomToken(24),
      scope,
      expiresAt: new Date(Date.now() + (scope === 'CONSOLE' ? CONSOLE_TTL_MS : SESSION_TTL_MS)),
      userAgent: req.get('user-agent')?.slice(0, 255),
    },
  });
  return token;
}

export const cookieOptions = (ctx: AppContext) =>
  ({
    httpOnly: true,
    secure: ctx.config.isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  }) as const;

export const consoleCookieOptions = (ctx: AppContext) =>
  ({
    httpOnly: true,
    secure: ctx.config.isProd,
    sameSite: 'strict',
    path: CONSOLE_COOKIE_PATH,
    maxAge: CONSOLE_TTL_MS,
  }) as const;
