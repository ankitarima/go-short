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
    const prod = { ...ctx, config: loadConfig({ ...process.env, NODE_ENV: 'production' }) };
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
