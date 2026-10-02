import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { routeLabel } from '../src/metrics';
import { createWorkspace, get, makeCtx, post, registerUser, resetDb } from './helpers';

const ctx = makeCtx();
const app = createApp(ctx);
beforeEach(() => resetDb(ctx));
afterAll(async () => {
  await ctx.redis.quit();
  await ctx.prisma.$disconnect();
});

const series = async (name: string) =>
  (await ctx.metrics!.registry.getMetricsAsJSON()).find((m) => m.name === name)?.values ?? [];
const total = async (name: string, labels: Record<string, string>) =>
  (await series(name))
    .filter((v) => Object.entries(labels).every(([k, x]) => v.labels[k] === x))
    .reduce((n, v) => n + v.value, 0);

describe('routeLabel', () => {
  it('collapses ids in the mount path and keeps the route pattern', () => {
    expect(
      routeLabel({
        baseUrl: '/api/v1/workspaces/ws_1a2b3c/links',
        route: { path: '/:id' },
      } as never),
    ).toBe('/api/v1/workspaces/:id/links/:id');
    expect(routeLabel({ baseUrl: '/api/v1/auth', route: { path: '/login' } } as never)).toBe(
      '/api/v1/auth/login',
    );
    expect(routeLabel({ baseUrl: '', route: { path: '/health' } } as never)).toBe('/health');
    expect(routeLabel({ baseUrl: '', route: undefined } as never)).toBe('unmatched');
  });
});

describe('API metrics', () => {
  it('counts requests by route pattern, never by raw path, id or query', async () => {
    const c = await registerUser(app);
    const ws = await createWorkspace(c);
    await get(c, `/api/v1/workspaces/${ws}/links?search=secret-term`);
    await request(app).get('/definitely-not-a-route-1');
    await request(app).get('/definitely-not-a-route-2');

    expect(
      await total('goshort_http_requests_total', {
        route: '/api/v1/workspaces/:id/links',
        status: '200',
      }),
    ).toBeGreaterThanOrEqual(1);
    // Scanner traffic shares ONE series, so probing random URLs cannot grow the registry.
    expect(await total('goshort_http_requests_total', { route: 'unmatched', status: '404' })).toBe(
      2,
    );

    const text = await ctx.metrics!.registry.metrics();
    expect(text).not.toContain(ws);
    expect(text).not.toContain('secret-term');
    expect(text).not.toContain(c.email);
    expect(text).not.toContain('definitely-not-a-route');
    expect(text).toContain('goshort_http_request_duration_seconds_bucket');
  });

  it('counts successful and failed logins, and rate-limited requests', async () => {
    const reg = await registerUser(app);
    const before = await total('goshort_logins_total', { result: 'failure' });
    for (let i = 0; i < 3; i++)
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: reg.email, password: 'wrong-password-1' });
    expect(await total('goshort_logins_total', { result: 'failure' })).toBe(before + 3);
    const ok = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: reg.email, password: 'correct-horse-battery' });
    if (ok.status === 200)
      expect(await total('goshort_logins_total', { result: 'success' })).toBeGreaterThanOrEqual(1);

    await ctx.redis.flushdb();
    for (let i = 0; i < 12; i++)
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'x@example.com', password: 'wrong-password-1' });
    expect(await total('goshort_rate_limited_total', { limiter: 'auth' })).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('is not served from the public listener', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('goshort_');
  });
});

describe('response headers', () => {
  it('API responses are never cacheable, and carry the standard security headers', async () => {
    const c = await registerUser(app);
    const me = await get(c, '/api/v1/me');
    expect(me.headers['cache-control']).toBe('no-store');
    const bad = await request(app).get('/api/v1/nope');
    expect(bad.headers['cache-control']).toBe('no-store');

    for (const res of [me, bad, await request(app).get('/health')]) {
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['x-request-id']).toMatch(/^req_/);
    }
  });

  it('the QR preview keeps its own private no-store header', async () => {
    const c = await registerUser(app);
    const ws = await createWorkspace(c);
    const res = await post(c, `/api/v1/workspaces/${ws}/qr/preview`, { format: 'svg' });
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});
