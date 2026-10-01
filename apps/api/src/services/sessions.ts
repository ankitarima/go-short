import type { Request } from 'express';
import type { AppContext } from '../context';
import { randomToken, sha256 } from '../lib/crypto';

export const SESSION_COOKIE = 'gs_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(ctx: AppContext, userId: string, req: Request) {
  const token = randomToken(32);
  await ctx.prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      csrfToken: randomToken(24),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
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
