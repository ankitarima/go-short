import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { makeCtx, post, registerUser, resetDb } from './helpers';

const ctx = makeCtx();
const app = createApp(ctx);
beforeEach(() => resetDb(ctx));
afterAll(async () => {
  await ctx.redis.quit();
  await ctx.prisma.$disconnect();
});

describe('password hashing', () => {
  it('uses argon2id and verifies', async () => {
    const h = await hashPassword('correct-horse-battery');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'correct-horse-battery')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
    expect(await verifyPassword('garbage', 'x')).toBe(false);
  });
});

describe('auth', () => {
  it('registers, sets httpOnly cookie, never returns hash, stores session hashed', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'A@Example.com', name: 'A', password: 'correct-horse-battery' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('a@example.com');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
    const cookie = res.headers['set-cookie']![0]!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const raw = cookie.split(';')[0]!.split('=')[1]!;
    expect(await ctx.prisma.session.count({ where: { tokenHash: raw } })).toBe(0);
    expect(await ctx.prisma.session.count()).toBe(1);
  });

  it('rejects duplicate email, weak password and malformed body', async () => {
    const body = { email: 'dup@example.com', name: 'D', password: 'correct-horse-battery' };
    await request(app).post('/api/v1/auth/register').send(body).expect(201);
    expect((await request(app).post('/api/v1/auth/register').send(body)).body.error.code).toBe(
      'EMAIL_TAKEN',
    );
    await request(app)
      .post('/api/v1/auth/register')
      .send({ ...body, email: 'x@example.com', password: 'short' })
      .expect(400);
    await request(app)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);
  });

  it('logs in, serves /me, logs out and invalidates the session', async () => {
    const c = await registerUser(app);
    await c.agent.post('/api/v1/auth/logout').set('X-CSRF-Token', c.csrf).expect(200);
    await c.agent.get('/api/v1/me').expect(401);

    const login = request.agent(app);
    const res = await login
      .post('/api/v1/auth/login')
      .send({ email: c.email, password: 'correct-horse-battery' })
      .expect(200);
    const me = await login.get('/api/v1/me').expect(200);
    expect(me.body.data.user.email).toBe(c.email);
    expect(me.body.data.csrfToken).toBe(res.body.data.csrfToken);
  });

  it('returns the same error for unknown email and wrong password', async () => {
    const c = await registerUser(app);
    const a = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: c.email, password: 'wrong-wrong-wrong' });
    const b = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-wrong-wrong' });
    expect(a.status).toBe(401);
    expect(b.body.error).toEqual(a.body.error);
  });

  it('enforces CSRF on authenticated unsafe requests', async () => {
    const c = await registerUser(app);
    await c.agent.post('/api/v1/workspaces').send({ name: 'W' }).expect(403);
    await c.agent
      .post('/api/v1/workspaces')
      .set('X-CSRF-Token', 'nope')
      .send({ name: 'W' })
      .expect(403);
    await post(c, '/api/v1/workspaces', { name: 'W' }).expect(201);
  });

  it('rate limits credential endpoints at 10 attempts', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push(
        (
          await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'x@example.com', password: 'wrong-wrong-wrong' })
        ).status,
      );
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('changes password, signs out other sessions, keeps the current one', async () => {
    const c = await registerUser(app);
    const other = request.agent(app);
    await other
      .post('/api/v1/auth/login')
      .send({ email: c.email, password: 'correct-horse-battery' })
      .expect(200);
    await post(c, '/api/v1/auth/change-password', {
      currentPassword: 'bad',
      newPassword: 'another-long-password',
    }).expect(401);
    await post(c, '/api/v1/auth/change-password', {
      currentPassword: 'correct-horse-battery',
      newPassword: 'another-long-password',
    }).expect(200);
    await c.agent.get('/api/v1/me').expect(200);
    await other.get('/api/v1/me').expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: c.email, password: 'another-long-password' })
      .expect(200);
  });

  it('password reset: no enumeration, single use, revokes sessions', async () => {
    const c = await registerUser(app);
    const unknown = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@example.com' });
    expect(unknown.status).toBe(200);
    expect(ctx.email.sent.filter((m) => m.subject.includes('Reset'))).toHaveLength(0);

    await request(app).post('/api/v1/auth/forgot-password').send({ email: c.email }).expect(200);
    const token = ctx.email.lastToken();
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'brand-new-password-1' })
      .expect(200);
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'brand-new-password-2' })
      .expect(400);
    await c.agent.get('/api/v1/me').expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: c.email, password: 'brand-new-password-1' })
      .expect(200);
  });

  it('verifies email with a single-use token', async () => {
    const c = await registerUser(app);
    const token = ctx.email.lastToken();
    await request(app).post('/api/v1/auth/verify-email').send({ token }).expect(200);
    expect((await c.agent.get('/api/v1/me')).body.data.user.emailVerified).toBe(true);
    await request(app).post('/api/v1/auth/verify-email').send({ token }).expect(400);
  });

  it('expired sessions are rejected', async () => {
    const c = await registerUser(app);
    await ctx.prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await c.agent.get('/api/v1/me').expect(401);
  });

  it('standard error envelope, request id, no stack traces', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('health', () => {
  it('health and ready', async () => {
    await request(app).get('/health').expect(200);
    const r = await request(app).get('/ready').expect(200);
    expect(r.body.checks).toEqual({ postgres: 'ok', redis: 'ok' });
  });
});
