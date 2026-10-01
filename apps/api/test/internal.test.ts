import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { deleteStalePendingDomains } from '../src/services/domains';
import {
  addVerifiedDomain,
  createWorkspace,
  get,
  makeCtx,
  post,
  registerUser,
  resetDb,
} from './helpers';

const ctx = makeCtx();
const app = createApp(ctx);
beforeEach(() => resetDb(ctx));
afterAll(async () => {
  await ctx.redis.quit();
  await ctx.prisma.$disconnect();
});

describe('Caddy on-demand TLS check', () => {
  it('approves the shared domain and verified custom domains only', async () => {
    const c = await registerUser(app);
    const ws = await createWorkspace(c);
    await addVerifiedDomain(ctx, c, ws, 'ok.client.com');
    await post(c, `/api/v1/workspaces/${ws}/domains`, { hostname: 'pending.client.com' }).expect(
      201,
    );
    const check = (d: string) => request(app).get('/internal/tls-check').query({ domain: d });
    await check('localhost:4001').expect(200);
    await check('OK.client.com').expect(200); // case-insensitive
    await check('pending.client.com').expect(404);
    await check('unknown.example.org').expect(404);
    await check('').expect(404);
    await check('bad host!').expect(404);
    await request(app).get('/internal/tls-check').expect(404);
  });

  it('a disabled domain is no longer approved', async () => {
    const c = await registerUser(app);
    const ws = await createWorkspace(c);
    const id = await addVerifiedDomain(ctx, c, ws, 'ok.client.com');
    await c.agent
      .patch(`/api/v1/workspaces/${ws}/domains/${id}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ disabled: true })
      .expect(200);
    await request(app).get('/internal/tls-check').query({ domain: 'ok.client.com' }).expect(404);
  });

  it('requires the shared token when one is configured', async () => {
    const secured = createApp({
      ...ctx,
      config: { ...ctx.config, INTERNAL_API_TOKEN: 's3cret-s3cret-s3cret' },
    });
    await request(secured)
      .get('/internal/tls-check')
      .query({ domain: 'localhost:4001' })
      .expect(403);
    await request(secured)
      .get('/internal/tls-check')
      .query({ domain: 'localhost:4001', token: 'wrong' })
      .expect(403);
    await request(secured)
      .get('/internal/tls-check')
      .query({ domain: 'localhost:4001', token: 's3cret-s3cret-s3cret' })
      .expect(200);
  });
});

describe('stale domain cleanup', () => {
  it('releases only old, unverified, link-less claims', async () => {
    const c = await registerUser(app);
    const ws = await createWorkspace(c);
    const mk = (hostname: string, extra: object = {}) =>
      ctx.prisma.domain.create({
        data: { workspaceId: ws, hostname, verificationToken: 't', ...extra },
      });
    const old = new Date(Date.now() - 10 * 86_400_000);
    await mk('old-pending.client.com', { createdAt: old });
    await mk('fresh-pending.client.com');
    await mk('old-verified.client.com', { createdAt: old, isVerified: true, status: 'VERIFIED' });
    expect(await deleteStalePendingDomains(ctx, 7)).toBe(1);
    const left = (
      await ctx.prisma.domain.findMany({ where: { workspaceId: ws }, select: { hostname: true } })
    )
      .map((d) => d.hostname)
      .sort();
    expect(left).toEqual(['fresh-pending.client.com', 'old-verified.client.com']);
    // The shared domain is never a candidate.
    expect(await ctx.prisma.domain.count({ where: { workspaceId: null } })).toBe(1);
  });
});

describe('GET /domains/:id', () => {
  it('returns own and shared domains; other workspaces get 404', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const wa = await createWorkspace(a);
    const wb = await createWorkspace(b);
    const id = await addVerifiedDomain(ctx, a, wa, 'a.client.com');
    expect(
      (await get(a, `/api/v1/workspaces/${wa}/domains/${id}`).expect(200)).body.data.hostname,
    ).toBe('a.client.com');
    await get(b, `/api/v1/workspaces/${wb}/domains/${id}`).expect(404);
    await get(b, `/api/v1/workspaces/${wa}/domains/${id}`).expect(404);
  });
});
