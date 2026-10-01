import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import {
  addVerifiedDomain,
  createWorkspace,
  del,
  get,
  makeCtx,
  patch,
  post,
  registerUser,
  resetDb,
  sharedDomainId,
} from './helpers';

const ctx = makeCtx();
const app = createApp(ctx);
beforeEach(() => resetDb(ctx));
afterAll(async () => {
  await ctx.redis.quit();
  await ctx.prisma.$disconnect();
});
const D = (ws: string, rest = '') => `/api/v1/workspaces/${ws}/domains${rest}`;

describe('domains', () => {
  it('lists the shared default domain without DNS details', async () => {
    const c = await registerUser(app);
    const ws = await createWorkspace(c);
    const rows = (await get(c, D(ws)).expect(200)).body.data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      shared: true,
      status: 'VERIFIED',
      hostname: 'localhost:4001',
      dns: null,
    });
  });

  it('adds a domain: normalized, PENDING, with CNAME + TXT instructions', async () => {
    const c = await registerUser(app);
    const ws = await createWorkspace(c);
    const d = (await post(c, D(ws), { hostname: ' Links.Client.com. ' }).expect(201)).body.data;
    expect(d).toMatchObject({
      hostname: 'links.client.com',
      status: 'PENDING',
      isVerified: false,
      shared: false,
    });
    expect(d.dns.cname).toEqual({ type: 'CNAME', name: 'links.client.com', value: 'localhost' });
    expect(d.dns.txt.name).toBe('_goshort-verify.links.client.com');
    expect(d.dns.txt.value.length).toBeGreaterThan(20);
  });

  it.each([
    'localhost',
    'not a domain',
    '192.168.1.1',
    '-bad.example.com',
    'localhost:4001',
    'x'.repeat(260) + '.com',
    '',
  ])('rejects invalid hostname %s', async (hostname) => {
    const c = await registerUser(app);
    const ws = await createWorkspace(c);
    await post(c, D(ws), { hostname }).expect(400);
  });

  it('refuses to shadow the platform (app host / short domain)', async () => {
    const c = await registerUser(app);
    const ws = await createWorkspace(c);
    // APP_URL host is "localhost" (single label, invalid), so exercise the reserved set via a config override.
    const custom = createApp({
      ...ctx,
      config: {
        ...ctx.config,
        APP_URL: 'https://app.platform.io',
        DEFAULT_SHORT_DOMAIN: 'go.platform.io',
      },
    });
    const agent = (await import('supertest')).default.agent(custom);
    const reg = await agent
      .post('/api/v1/auth/register')
      .send({ email: 'r@example.com', name: 'R', password: 'correct-horse-battery' });
    const w = (
      await agent
        .post('/api/v1/workspaces')
        .set('X-CSRF-Token', reg.body.data.csrfToken)
        .send({ name: 'W' })
    ).body.data.id;
    for (const hostname of ['app.platform.io', 'go.platform.io']) {
      const res = await agent
        .post(`/api/v1/workspaces/${w}/domains`)
        .set('X-CSRF-Token', reg.body.data.csrfToken)
        .send({ hostname });
      expect(res.status).toBe(409);
    }
    void ws;
  });

  it('a hostname cannot belong to two workspaces', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const wa = await createWorkspace(a);
    const wb = await createWorkspace(b);
    await post(a, D(wa), { hostname: 'links.client.com' }).expect(201);
    expect(
      (await post(b, D(wb), { hostname: 'LINKS.client.com' }).expect(409)).body.error.code,
    ).toBe('DOMAIN_TAKEN');
    await post(a, D(wa), { hostname: 'links.client.com' }).expect(409);
  });

  it('verifies via CNAME, via TXT, and not with wrong records', async () => {
    const c = await registerUser(app);
    const ws = await createWorkspace(c);
    const d = (await post(c, D(ws), { hostname: 'a.client.com' }).expect(201)).body.data;
    const verify = () => post(c, D(ws, `/${d.id}/verify`)).expect(200);

    expect((await verify()).body.data.verified).toBe(false);
    ctx.dns.cname.set('a.client.com', ['evil.example.com.']);
    ctx.dns.txt.set('_goshort-verify.a.client.com', [['wrong-token']]);
    expect((await verify()).body.data.verified).toBe(false);

    ctx.dns.cname.set('a.client.com', ['LOCALHOST.']);
    const ok = (await verify()).body.data;
    expect(ok).toMatchObject({ verified: true, method: 'CNAME' });
    expect(ok.domain).toMatchObject({ status: 'VERIFIED', isVerified: true });

    const e = (await post(c, D(ws), { hostname: 'b.client.com' }).expect(201)).body.data;
    ctx.dns.txt.set('_goshort-verify.b.client.com', [
      [e.dns.txt.value.slice(0, 5), e.dns.txt.value.slice(5)],
    ]); // chunked TXT
    expect((await post(c, D(ws, `/${e.id}/verify`)).expect(200)).body.data).toMatchObject({
      verified: true,
      method: 'TXT',
    });
  });

  it('rate limits verification attempts', async () => {
    const c = await registerUser(app);
    const ws = await createWorkspace(c);
    const d = (await post(c, D(ws), { hostname: 'a.client.com' }).expect(201)).body.data;
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await post(c, D(ws, `/${d.id}/verify`))).status;
    expect(last).toBe(429);
  });

  it('enforces roles: viewer lists, member cannot manage', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app);
    const ws = await createWorkspace(owner);
    await post(owner, `/api/v1/workspaces/${ws}/members/invite`, {
      email: member.email,
      role: 'MEMBER',
    }).expect(201);
    await post(member, '/api/v1/workspaces/invitations/accept', {
      token: ctx.email.lastToken(),
    }).expect(200);
    await get(member, D(ws)).expect(200);
    await post(member, D(ws), { hostname: 'x.client.com' }).expect(403);
  });

  it('IDOR: other workspaces cannot see, verify, change or delete a domain; shared domain is immutable', async () => {
    const a = await registerUser(app);
    const m = await registerUser(app);
    const wa = await createWorkspace(a);
    const wm = await createWorkspace(m);
    const d = (await post(a, D(wa), { hostname: 'a.client.com' }).expect(201)).body.data;
    // Mallory addresses A's domain through her OWN workspace id.
    await post(m, D(wm, `/${d.id}/verify`)).expect(404);
    await patch(m, D(wm, `/${d.id}`), { disabled: true }).expect(404);
    await del(m, D(wm, `/${d.id}`)).expect(404);
    expect(
      (await get(m, D(wm)).expect(200)).body.data.some((x: { id: string }) => x.id === d.id),
    ).toBe(false);
    // ...and through A's workspace id, which she is not a member of.
    await get(m, D(wa)).expect(404);
    // Shared domain cannot be modified through the owned-domain routes.
    const shared = await sharedDomainId(m, wm);
    await patch(m, D(wm, `/${shared}`), { disabled: true }).expect(404);
    await del(m, D(wm, `/${shared}`)).expect(404);
  });

  it('only one default per workspace; unverified domains cannot be default', async () => {
    const c = await registerUser(app);
    const ws = await createWorkspace(c);
    const unverified = (await post(c, D(ws), { hostname: 'u.client.com' }).expect(201)).body.data
      .id;
    await patch(c, D(ws, `/${unverified}`), { isDefault: true }).expect(409);
    const a = await addVerifiedDomain(ctx, c, ws, 'a.client.com');
    const b = await addVerifiedDomain(ctx, c, ws, 'b.client.com');
    await patch(c, D(ws, `/${a}`), { isDefault: true }).expect(200);
    await patch(c, D(ws, `/${b}`), { isDefault: true }).expect(200);
    const rows = (await get(c, D(ws))).body.data as {
      id: string;
      isDefault: boolean;
      shared: boolean;
    }[];
    expect(rows.filter((r) => !r.shared && r.isDefault).map((r) => r.id)).toEqual([b]);
  });

  it('disabling a domain purges cached links and blocks new ones; re-enabling restores', async () => {
    const c = await registerUser(app);
    const ws = await createWorkspace(c);
    const dom = await addVerifiedDomain(ctx, c, ws, 'a.client.com');
    const link = (
      await post(c, `/api/v1/workspaces/${ws}/links`, {
        destinationUrl: 'https://example.org',
        domainId: dom,
        slug: 'sale',
      }).expect(201)
    ).body.data;
    await ctx.redis.set('link:a.client.com:sale', '{"cached":true}');
    await patch(c, D(ws, `/${dom}`), { disabled: true }).expect(200);
    expect(await ctx.redis.exists('link:a.client.com:sale')).toBe(0);
    await post(c, `/api/v1/workspaces/${ws}/links`, {
      destinationUrl: 'https://example.org',
      domainId: dom,
    }).expect(409);
    expect(
      (await patch(c, D(ws, `/${dom}`), { disabled: false }).expect(200)).body.data.status,
    ).toBe('VERIFIED');
    void link;
  });

  it('refuses to delete a domain that still has links', async () => {
    const c = await registerUser(app);
    const ws = await createWorkspace(c);
    const dom = await addVerifiedDomain(ctx, c, ws, 'a.client.com');
    const link = (
      await post(c, `/api/v1/workspaces/${ws}/links`, {
        destinationUrl: 'https://example.org',
        domainId: dom,
      }).expect(201)
    ).body.data;
    await del(c, D(ws, `/${dom}`)).expect(409);
    await del(c, `/api/v1/workspaces/${ws}/links/${link.id}`).expect(200);
    await del(c, D(ws, `/${dom}`)).expect(200);
  });

  it('honours the custom-domains feature flag', async () => {
    const off = createApp({ ...ctx, config: { ...ctx.config, FEATURE_CUSTOM_DOMAINS: false } });
    const agent = (await import('supertest')).default.agent(off);
    const reg = await agent
      .post('/api/v1/auth/register')
      .send({ email: 'f@example.com', name: 'F', password: 'correct-horse-battery' });
    const w = (
      await agent
        .post('/api/v1/workspaces')
        .set('X-CSRF-Token', reg.body.data.csrfToken)
        .send({ name: 'W' })
    ).body.data.id;
    const res = await agent.get(`/api/v1/workspaces/${w}/domains`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });
});
