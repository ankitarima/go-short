import { AppError } from '@go-short/shared';
import { loginSchema } from '@go-short/validation';
import { Router } from 'express';
import type { AppContext } from '../context';
import { sha256 } from '../lib/crypto';
import { burnVerify, verifyPassword } from '../lib/password';
import { loadConsoleSession, requireAuth, requireSession } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { audit } from '../services/audit';
import {
  CONSOLE_COOKIE,
  CONSOLE_COOKIE_PATH,
  consoleCookieOptions,
  createSession,
} from '../services/sessions';

/**
 * Console sign-in, completely separate from the app's: staff accounts only, its own cookie and csrf
 * token, 8-hour sessions. The app's session cookie is never read here and the console cookie is never
 * accepted by the app.
 */
export function consoleAuthRouter(ctx: AppContext): Router {
  const r = Router();
  const { prisma } = ctx;
  const strict = rateLimit(ctx, { name: 'console-auth', limit: 10, windowSeconds: 15 * 60 });
  const perAccount = rateLimit(ctx, {
    name: 'console-login-account',
    limit: 30,
    windowSeconds: 15 * 60,
    key: (req) => {
      const email = (req.body as { email?: unknown } | undefined)?.email;
      return typeof email === 'string' ? sha256(email.trim().toLowerCase()) : (req.ip ?? 'unknown');
    },
  });

  r.post('/login', strict, perAccount, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const valid = user
      ? await verifyPassword(user.passwordHash, input.password)
      : (await burnVerify(input.password), false);
    if (!user || !valid) {
      ctx.metrics?.logins.inc({ result: 'failure' });
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    // Only after the password is proven, so neither check can be used to probe which emails exist.
    if (user.disabledAt)
      throw new AppError(
        'ACCOUNT_DISABLED',
        'This account has been disabled. Contact your administrator.',
      );
    if (user.systemRole === 'USER')
      throw new AppError('FORBIDDEN', 'This account does not have console access.');
    const token = await createSession(ctx, user.id, req, 'CONSOLE');
    const session = await prisma.session.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    await audit(ctx, {
      userId: user.id,
      action: 'CONSOLE_LOGIN',
      resourceType: 'user',
      resourceId: user.id,
    });
    res.cookie(CONSOLE_COOKIE, token, consoleCookieOptions(ctx));
    res.json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, name: user.name },
        role: user.systemRole,
        csrfToken: session.csrfToken,
      },
    });
  });

  r.post('/logout', loadConsoleSession(ctx), requireAuth, requireSession, async (req, res) => {
    await prisma.session.delete({ where: { id: req.auth!.session!.id } });
    res.clearCookie(CONSOLE_COOKIE, {
      ...consoleCookieOptions(ctx),
      maxAge: undefined,
      path: CONSOLE_COOKIE_PATH,
    });
    res.json({ success: true, data: {} });
  });

  return r;
}
