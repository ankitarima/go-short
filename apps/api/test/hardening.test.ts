import { randomBytes } from 'node:crypto';
import { loadConfig } from '@go-short/config';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { cookieOptions } from '../src/services/sessions';
import { makeCtx, post, registerUser, resetDb } from './helpers';

const ctx = makeCtx();
const app = createApp(ctx);
beforeEach(() => resetDb(ctx));
afterAll(async () => {
  await ctx.redis.quit();
  await ctx.prisma.$disconnect();
});

describe('redis outage (rate limiter fails open, readiness reports it)', () => {
  const deadRedis = new Redis('redis://127.0.0.1:1', {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    lazyConnect: true,
  });
  deadRedis.on('error', () => undefined);
  const brokenApp = createApp({ ...ctx, redis: deadRedis });

  it('auth still works without Redis', async () => {
    const res = await request(brokenApp)
      .post('/api/v1/auth/register')
      .send({ email: 'r@example.com', name: 'R', password: 'correct-horse-battery' });
    expect(res.status).toBe(201);
  });
  it('/health stays ok, /ready returns 503 without leaking details', async () => {
    await request(brokenApp).get('/health').expect(200);
    const r = await request(brokenApp).get('/ready').expect(503);
    expect(r.body.checks).toEqual({ postgres: 'ok', redis: 'fail' });
    expect(JSON.stringify(r.body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED/);
  });
});

describe('http hardening', () => {
  it('rejects oversized bodies with 413 in the standard envelope', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.com', password: 'x'.repeat(200_000) });
    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
  });
  it('CORS only allows configured origins and supports credentials', async () => {
    const ok = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('cookies are Secure in production and always HttpOnly', () => {
    const prod = {
      ...ctx,
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'production',
        SESSION_SECRET: randomBytes(32).toString('hex'),
        INTERNAL_API_TOKEN: 'x'.repeat(20),
      }),
    };
    expect(cookieOptions(prod)).toMatchObject({ secure: true, httpOnly: true, sameSite: 'lax' });
    expect(cookieOptions(ctx).secure).toBe(false);
  });
  it('production error responses never include stack traces', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(ts|js)|node_modules/);
  });
});

describe('trusted proxy handling', () => {
  const body = { email: 'x@example.com', password: 'wrong-wrong-wrong' };
  it('ignores spoofed X-Forwarded-For when proxies are not trusted (cannot dodge the IP rate limit)', async () => {
    const strictApp = createApp({ ...ctx, config: { ...ctx.config, trustProxy: false } });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++)
      statuses.push(
        (
          await request(strictApp)
            .post('/api/v1/auth/login')
            .set('X-Forwarded-For', `9.9.9.${i}`)
            .send(body)
        ).status,
      );
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
  it('honours X-Forwarded-For from a trusted proxy (distinct clients get distinct buckets)', async () => {
    const proxied = createApp({ ...ctx, config: { ...ctx.config, trustProxy: 1 } });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++)
      statuses.push(
        (
          await request(proxied)
            .post('/api/v1/auth/login')
            .set('X-Forwarded-For', `9.9.9.${i}`)
            .send(body)
        ).status,
      );
    expect(statuses.every((s) => s === 401)).toBe(true);
  });
});

describe('invitation hygiene', () => {
  it('rejects inviting an existing member and supersedes pending invites', async () => {
    const owner = await registerUser(app);
    const other = await registerUser(app);
    const ws = (await post(owner, '/api/v1/workspaces', { name: 'W' })).body.data.id as string;
    const url = `/api/v1/workspaces/${ws}/members/invite`;
    await post(owner, url, { email: other.email, role: 'MEMBER' }).expect(201);
    const first = ctx.email.lastToken();
    await post(owner, url, { email: other.email, role: 'VIEWER' }).expect(201);
    await post(other, '/api/v1/workspaces/invitations/accept', { token: first }).expect(404); // superseded
    await post(other, '/api/v1/workspaces/invitations/accept', {
      token: ctx.email.lastToken(),
    }).expect(200);
    await post(owner, url, { email: other.email, role: 'MEMBER' }).expect(409); // now a member
  });
  it('caps invitations per workspace per hour', async () => {
    const owner = await registerUser(app);
    const ws = (await post(owner, '/api/v1/workspaces', { name: 'W' })).body.data.id as string;
    let last = 0;
    for (let i = 0; i < 31; i++)
      last = (
        await post(owner, `/api/v1/workspaces/${ws}/members/invite`, {
          email: `i${i}@example.com`,
          role: 'VIEWER',
        })
      ).status;
    expect(last).toBe(429);
  });
});

describe('login throttling', () => {
  it('caps guesses against ONE account even when they come from many IPs', async () => {
    const trusting = createApp({ ...ctx, config: { ...ctx.config, trustProxy: 1 } });
    const c = await registerUser(trusting);
    await ctx.redis.flushdb();
    const statuses: number[] = [];
    for (let i = 0; i < 34; i++) {
      const res = await request(trusting)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `203.0.113.${i + 1}`) // a different client every time
        .send({ email: c.email, password: 'definitely-wrong-password' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(30).every((s) => s === 429)).toBe(true);
    // Another account is unaffected, and the key is a hash, not the address.
    const other = await request(trusting)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '198.51.100.9')
      .send({ email: 'someone-else@example.com', password: 'definitely-wrong-password' });
    expect(other.status).toBe(401);
    const keys = await ctx.redis.keys('rl:login-account:*');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.join()).not.toContain('@');
  });
});

describe('mass assignment and hostile input', () => {
  it('ignores privilege-escalation fields on register, profile and workspace creation', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'mass@example.com',
      name: 'Mass',
      password: 'correct-horse-battery',
      systemRole: 'ADMIN',
      emailVerified: true,
      id: 'chosen-id',
      passwordHash: 'x',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.systemRole).toBe('USER');
    expect(res.body.data.user.id).not.toBe('chosen-id');
    const row = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'mass@example.com' } });
    expect(row.systemRole).toBe('USER');
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('does not let a client pick another tenant when creating a workspace', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const res = await post(a, '/api/v1/workspaces', { name: 'Mine', ownerId: b.userId });
    expect(res.status).toBe(201);
    const owners = await ctx.prisma.workspaceMember.findMany({
      where: { workspaceId: res.body.data.id, role: 'OWNER' },
    });
    expect(owners.map((m) => m.userId)).toEqual([a.userId]);
  });

  it('handles prototype-pollution style bodies and malformed JSON without a 500', async () => {
    const poisoned = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"__proto__":{"isAdmin":true},"email":"a@b.com","password":"x"}');
    expect(poisoned.status).toBeLessThan(500);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    const broken = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(broken.status).toBe(400);
    expect(broken.body.success).toBe(false);
  });

  it('serves only whitelisted documentation assets (no path traversal, no package files)', async () => {
    for (const p of [
      '/api-docs/assets/..%2f..%2fpackage.json',
      '/api-docs/assets/package.json',
      '/api-docs/assets/%2e%2e%2f%2e%2e%2f.env',
    ]) {
      const res = await request(app).get(p);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('"version"');
    }
  });
});
