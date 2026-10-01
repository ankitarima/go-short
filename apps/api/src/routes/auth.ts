import { AppError } from '@go-short/shared';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@go-short/validation';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { randomToken, sha256 } from '../lib/crypto';
import { burnVerify, hashPassword, verifyPassword } from '../lib/password';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { audit } from '../services/audit';
import { SESSION_COOKIE, cookieOptions, createSession } from '../services/sessions';

const HOUR = 60 * 60 * 1000;

export function authRouter(ctx: AppContext): Router {
  const r = Router();
  const { prisma } = ctx;
  // 10 attempts / 15 minutes / IP across all credential endpoints.
  const strict = rateLimit(ctx, { name: 'auth', limit: 10, windowSeconds: 15 * 60 });

  async function issueToken(
    userId: string,
    type: 'PASSWORD_RESET' | 'EMAIL_VERIFY',
    ttlMs: number,
  ) {
    const token = randomToken(32);
    await prisma.authToken.create({
      data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  r.post('/register', strict, async (req, res) => {
    const input = registerSchema.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    let user;
    try {
      user = await prisma.user.create({
        data: { email: input.email, name: input.name, passwordHash },
      });
    } catch (err) {
      if (typeof err === 'object' && err && 'code' in err && err.code === 'P2002') {
        throw new AppError('EMAIL_TAKEN', 'An account with this email already exists');
      }
      throw err;
    }
    const verifyToken = await issueToken(user.id, 'EMAIL_VERIFY', 48 * HOUR);
    await ctx.email.send({
      to: user.email,
      subject: 'Verify your email',
      text: `Verify: ${ctx.config.APP_URL}/verify-email?token=${verifyToken}`,
    });
    const token = await createSession(ctx, user.id, req);
    const session = await prisma.session.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    await audit(ctx, {
      userId: user.id,
      action: 'USER_REGISTERED',
      resourceType: 'user',
      resourceId: user.id,
    });
    res.cookie(SESSION_COOKIE, token, cookieOptions(ctx));
    res
      .status(201)
      .json({ success: true, data: { user: publicUser(user), csrfToken: session.csrfToken } });
  });

  r.post('/login', strict, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const valid = user
      ? await verifyPassword(user.passwordHash, input.password)
      : (await burnVerify(input.password), false);
    if (!user || !valid) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password');
    const token = await createSession(ctx, user.id, req);
    const session = await prisma.session.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    await audit(ctx, {
      userId: user.id,
      action: 'USER_LOGIN',
      resourceType: 'user',
      resourceId: user.id,
    });
    res.cookie(SESSION_COOKIE, token, cookieOptions(ctx));
    res.json({ success: true, data: { user: publicUser(user), csrfToken: session.csrfToken } });
  });

  r.post('/logout', requireAuth, async (req, res) => {
    await prisma.session.delete({ where: { id: req.auth!.session.id } });
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions(ctx), maxAge: undefined });
    res.json({ success: true, data: {} });
  });

  r.post('/change-password', requireAuth, strict, async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.user.id } });
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    const passwordHash = await hashPassword(input.newPassword);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      // Sign out every other device.
      prisma.session.deleteMany({ where: { userId: user.id, id: { not: req.auth!.session.id } } }),
    ]);
    await audit(ctx, {
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      resourceType: 'user',
      resourceId: user.id,
    });
    res.json({ success: true, data: {} });
  });

  // Always 200: never reveal whether an email is registered.
  r.post('/forgot-password', strict, async (req, res) => {
    const { email } = forgotPasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = await issueToken(user.id, 'PASSWORD_RESET', HOUR);
      await ctx.email.send({
        to: user.email,
        subject: 'Reset your password',
        text: `Reset: ${ctx.config.APP_URL}/reset-password?token=${token}`,
      });
    }
    res.json({ success: true, data: {} });
  });

  r.post('/reset-password', strict, async (req, res) => {
    const input = resetPasswordSchema.parse(req.body);
    const row = await prisma.authToken.findUnique({ where: { tokenHash: sha256(input.token) } });
    if (!row || row.type !== 'PASSWORD_RESET' || row.usedAt || row.expiresAt < new Date()) {
      throw new AppError('VALIDATION_ERROR', 'Reset link is invalid or has expired');
    }
    const passwordHash = await hashPassword(input.newPassword);
    await prisma.$transaction([
      prisma.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
      prisma.session.deleteMany({ where: { userId: row.userId } }),
    ]);
    await audit(ctx, {
      userId: row.userId,
      action: 'PASSWORD_RESET',
      resourceType: 'user',
      resourceId: row.userId,
    });
    res.json({ success: true, data: {} });
  });

  r.post('/verify-email', strict, async (req, res) => {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
    const row = await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.type !== 'EMAIL_VERIFY' || row.usedAt || row.expiresAt < new Date()) {
      throw new AppError('VALIDATION_ERROR', 'Verification link is invalid or has expired');
    }
    await prisma.$transaction([
      prisma.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: row.userId }, data: { emailVerified: true } }),
    ]);
    res.json({ success: true, data: {} });
  });

  return r;
}

export const publicUser = (u: {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  systemRole: string;
}) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  emailVerified: u.emailVerified,
  systemRole: u.systemRole,
});
