import { Redis } from 'ioredis';
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
  type Client,
} from './helpers';

const ctx = makeCtx();
const app = createApp(ctx);
beforeEach(() => resetDb(ctx));
afterAll(async () => {
  await ctx.redis.quit();
  await ctx.prisma.$disconnect();
});
const L = (ws: string, rest = '') => `/api/v1/workspaces/${ws}/links${rest}`;
const dest = 'https://example.org/product';

async function setup() {
  const c = await registerUser(app);
  const ws = await createWorkspace(c);
  return { c, ws };
}
async function mk(c: Client, ws: string, body: object = {}) {
  return (await post(c, L(ws), { destinationUrl: dest, ...body }).expect(201)).body.data;
}

describe('link creation', () => {
  it('creates with a random 7-char slug on the default (shared) domain', async () => {
    const { c, ws } = await setup();
    const l = await mk(c, ws);
    expect(l.slug).toMatch(/^[A-Za-z0-9]{7}$/);
    expect(l.shortUrl).toBe(`http://localhost:4001/${l.slug}`);
    expect(l).toMatchObject({
      isActive: true,
      hasPassword: false,
      destinationUrl: dest,
      hostname: 'localhost:4001',
    });
  });

  it('uses the workspace default domain when one is set', async () => {
    const { c, ws } = await setup();
    const dom = await addVerifiedDomain(ctx, c, ws, 'a.client.com');
    await patch(c, `/api/v1/workspaces/${ws}/domains/${dom}`, { isDefault: true }).expect(200);
    expect((await mk(c, ws)).shortUrl).toMatch(/^https:\/\/a\.client\.com\//);
  });

  it('custom slugs: unique per domain, but reusable across domains', async () => {
    const { c, ws } = await setup();
    const dom = await addVerifiedDomain(ctx, c, ws, 'a.client.com');
    const shared = await sharedDomainId(c, ws);
    await mk(c, ws, { slug: 'summer-sale', domainId: shared });
    expect(
      (
        await post(c, L(ws), {
          destinationUrl: dest,
          slug: 'summer-sale',
          domainId: shared,
        }).expect(409)
      ).body.error.code,
    ).toBe('SLUG_TAKEN');
    await mk(c, ws, { slug: 'summer-sale', domainId: dom }); // same slug, other domain: fine
  });

  it('slugs on the shared domain are unique across tenants', async () => {
    const a = await setup();
    const b = await setup();
    await mk(a.c, a.ws, { slug: 'promo2026' });
    expect(
      (await post(b.c, L(b.ws), { destinationUrl: dest, slug: 'promo2026' }).expect(409)).body.error
        .code,
    ).toBe('SLUG_TAKEN');
  });

  it.each([
    ['admin', 409, 'SLUG_RESERVED'],
    ['API', 409, 'SLUG_RESERVED'],
    ['favicon.ico', 409, 'SLUG_RESERVED'],
    ['ab', 400, 'SLUG_INVALID'],
    ['has space', 400, 'SLUG_INVALID'],
    ['a/b', 400, 'SLUG_INVALID'],
    ['-lead', 400, 'SLUG_INVALID'],
  ])('rejects slug %s', async (slug, status, code) => {
    const { c, ws } = await setup();
    const res = await post(c, L(ws), { destinationUrl: dest, slug }).expect(status);
    expect(res.body.error.code).toBe(code);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'vbscript:x',
    'ftp://example.org',
    'https://user:pass@example.org',
    'not a url',
    '//example.org',
    'https://exa mple.org',
  ])('rejects dangerous or malformed destination %s', async (destinationUrl) => {
    const { c, ws } = await setup();
    await post(c, L(ws), { destinationUrl }).expect(400);
  });

  it('rejects destinations that point at a short-link domain (redirect loops)', async () => {
    const { c, ws } = await setup();
    await addVerifiedDomain(ctx, c, ws, 'a.client.com');
    await post(c, L(ws), { destinationUrl: 'http://localhost:4001/abc' }).expect(400);
    await post(c, L(ws), { destinationUrl: 'https://a.client.com/x' }).expect(400);
  });

  it('stores UTM fields, expiry and redirect status; hashes passwords and never returns the hash', async () => {
    const { c, ws } = await setup();
    const l = await mk(c, ws, {
      utmSource: 'instagram',
      utmMedium: 'social',
      utmCampaign: 'diwali2026',
      expiresAt: '2031-01-01T00:00:00Z',
      password: 'open-sesame',
      redirectStatus: 307,
    });
    expect(l).toMatchObject({
      utmSource: 'instagram',
      utmMedium: 'social',
      utmCampaign: 'diwali2026',
      redirectStatus: 307,
      hasPassword: true,
      expired: false,
    });
    expect(JSON.stringify(l)).not.toMatch(/argon2|passwordHash|open-sesame/);
    const row = await ctx.prisma.link.findUniqueOrThrow({ where: { id: l.id } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('validates field bounds', async () => {
    const { c, ws } = await setup();
    await post(c, L(ws), { destinationUrl: dest, expiresAt: 'tomorrow' }).expect(400);
    await post(c, L(ws), { destinationUrl: dest, redirectStatus: 303 }).expect(400);
    await post(c, L(ws), { destinationUrl: dest, password: 'x' }).expect(400);
    await post(c, L(ws), { destinationUrl: dest, title: 'x'.repeat(201) }).expect(400);
    await post(c, L(ws), {}).expect(400);
  });

  it('only accepts campaigns from the same workspace', async () => {
    const a = await setup();
    const b = await setup();
    const camp = await ctx.prisma.campaign.create({ data: { workspaceId: a.ws, name: 'A camp' } });
    await mk(a.c, a.ws, { campaignId: camp.id });
    expect(
      (await post(b.c, L(b.ws), { destinationUrl: dest, campaignId: camp.id }).expect(404)).body
        .error.code,
    ).toBe('CAMPAIGN_NOT_FOUND');
  });

  it('rejects a domain from another workspace and an unverified one', async () => {
    const a = await setup();
    const b = await setup();
    const foreign = await addVerifiedDomain(ctx, a.c, a.ws, 'a.client.com');
    await post(b.c, L(b.ws), { destinationUrl: dest, domainId: foreign }).expect(404);
    const pending = (
      await post(a.c, `/api/v1/workspaces/${a.ws}/domains`, { hostname: 'p.client.com' })
    ).body.data.id;
    await post(a.c, L(a.ws), { destinationUrl: dest, domainId: pending }).expect(409);
  });

  it('honours the password-links feature flag', async () => {
    const off = createApp({ ...ctx, config: { ...ctx.config, FEATURE_PASSWORD_LINKS: false } });
    const agent = (await import('supertest')).default.agent(off);
    const reg = await agent
      .post('/api/v1/auth/register')
      .send({ email: 'p@example.com', name: 'P', password: 'correct-horse-battery' });
    const h = { 'X-CSRF-Token': reg.body.data.csrfToken as string };
    const w = (await agent.post('/api/v1/workspaces').set(h).send({ name: 'W' })).body.data.id;
    const res = await agent
      .post(L(w))
      .set(h)
      .send({ destinationUrl: dest, password: 'secret-pass' });
    expect(res.status).toBe(403);
  });

  it('audits creation without secrets', async () => {
    const { c, ws } = await setup();
    await mk(c, ws, { password: 'open-sesame' });
    const logs = JSON.stringify(
      await ctx.prisma.auditLog.findMany({ where: { action: 'LINK_CREATED' } }),
    );
    expect(logs).toContain('LINK_CREATED');
    expect(logs).not.toMatch(/open-sesame|argon2/);
  });
});

describe('tenant isolation (IDOR)', () => {
  it('another workspace cannot read, change, toggle or delete links, via either workspace id', async () => {
    const a = await setup();
    const m = await setup();
    const l = await mk(a.c, a.ws);
    for (const ws of [m.ws, a.ws]) {
      await get(m.c, L(ws, `/${l.id}`)).expect(404);
      await patch(m.c, L(ws, `/${l.id}`), { destinationUrl: 'https://evil.example' }).expect(404);
      await post(m.c, L(ws, `/${l.id}/disable`)).expect(404);
      await post(m.c, L(ws, `/${l.id}/enable`)).expect(404);
      await del(m.c, L(ws, `/${l.id}`)).expect(404);
    }
    expect((await get(m.c, L(m.ws)).expect(200)).body.data).toHaveLength(0);
    const still = (await get(a.c, L(a.ws, `/${l.id}`)).expect(200)).body.data;
    expect(still).toMatchObject({ destinationUrl: dest, isActive: true });
  });

  it('roles: viewer read-only, member can write', async () => {
    const owner = await registerUser(app);
    const viewer = await registerUser(app);
    const member = await registerUser(app);
    const ws = await createWorkspace(owner);
    for (const [u, role] of [
      [viewer, 'VIEWER'],
      [member, 'MEMBER'],
    ] as const) {
      await post(owner, `/api/v1/workspaces/${ws}/members/invite`, { email: u.email, role }).expect(
        201,
      );
      await post(u, '/api/v1/workspaces/invitations/accept', {
        token: ctx.email.lastToken(),
      }).expect(200);
    }
    const l = await mk(owner, ws);
    await get(viewer, L(ws, `/${l.id}`)).expect(200);
    await post(viewer, L(ws), { destinationUrl: dest }).expect(403);
    await patch(viewer, L(ws, `/${l.id}`), { title: 'x' }).expect(403);
    await del(viewer, L(ws, `/${l.id}`)).expect(403);
    await mk(member, ws);
    await patch(member, L(ws, `/${l.id}`), { title: 'ok' }).expect(200);
  });
});

describe('updates, toggles and cache invalidation', () => {
  const key = (host: string, slug: string) => `link:${host}:${slug}`;

  it('creating a link clears a negative-cache entry for that key', async () => {
    const { c, ws } = await setup();
    await ctx.redis.set(key('localhost:4001', 'launch'), '{"missing":true}');
    await mk(c, ws, { slug: 'launch' });
    expect(await ctx.redis.exists(key('localhost:4001', 'launch'))).toBe(0);
  });

  it('destination change, disable, enable and delete each purge the cached entry', async () => {
    const { c, ws } = await setup();
    const l = await mk(c, ws, { slug: 'launch' });
    const k = key('localhost:4001', 'launch');
    const seed = () => ctx.redis.set(k, '{"stale":true}');

    await seed();
    await patch(c, L(ws, `/${l.id}`), { destinationUrl: 'https://example.org/new' }).expect(200);
    expect(await ctx.redis.exists(k)).toBe(0);

    await seed();
    expect((await post(c, L(ws, `/${l.id}/disable`)).expect(200)).body.data.isActive).toBe(false);
    expect(await ctx.redis.exists(k)).toBe(0);

    await seed();
    expect((await post(c, L(ws, `/${l.id}/enable`)).expect(200)).body.data.isActive).toBe(true);
    expect(await ctx.redis.exists(k)).toBe(0);

    await seed();
    await del(c, L(ws, `/${l.id}`)).expect(200);
    expect(await ctx.redis.exists(k)).toBe(0);
    await get(c, L(ws, `/${l.id}`)).expect(404);
  });

  it('changing slug or domain purges both the old and the new key', async () => {
    const { c, ws } = await setup();
    const dom = await addVerifiedDomain(ctx, c, ws, 'a.client.com');
    const l = await mk(c, ws, { slug: 'old-slug' });
    await ctx.redis.set(key('localhost:4001', 'old-slug'), 'x');
    await ctx.redis.set(key('a.client.com', 'new-slug'), 'x');
    const moved = (
      await patch(c, L(ws, `/${l.id}`), { slug: 'new-slug', domainId: dom }).expect(200)
    ).body.data;
    expect(moved.shortUrl).toBe('https://a.client.com/new-slug');
    expect(
      await ctx.redis.exists(key('localhost:4001', 'old-slug'), key('a.client.com', 'new-slug')),
    ).toBe(0);
  });

  it('slug change collisions and reserved slugs are rejected', async () => {
    const { c, ws } = await setup();
    await mk(c, ws, { slug: 'taken-one' });
    const l = await mk(c, ws, { slug: 'mine-here' });
    await patch(c, L(ws, `/${l.id}`), { slug: 'taken-one' }).expect(409);
    await patch(c, L(ws, `/${l.id}`), { slug: 'admin' }).expect(409);
  });

  it('can set and clear expiry and password; expired links are flagged', async () => {
    const { c, ws } = await setup();
    const l = await mk(c, ws, { expiresAt: '2000-01-01T00:00:00Z', password: 'open-sesame' });
    expect(l).toMatchObject({ expired: true, hasPassword: true });
    const cleared = (
      await patch(c, L(ws, `/${l.id}`), { expiresAt: null, password: null }).expect(200)
    ).body.data;
    expect(cleared).toMatchObject({ expired: false, expiresAt: null, hasPassword: false });
  });

  it('still succeeds when Redis is down (invalidation is best-effort and logged)', async () => {
    const dead = new Redis('redis://127.0.0.1:1', {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    dead.on('error', () => undefined);
    const broken = createApp({ ...ctx, redis: dead });
    const agent = (await import('supertest')).default.agent(broken);
    const reg = await agent
      .post('/api/v1/auth/register')
      .send({ email: 'd@example.com', name: 'D', password: 'correct-horse-battery' });
    const h = { 'X-CSRF-Token': reg.body.data.csrfToken as string };
    const w = (await agent.post('/api/v1/workspaces').set(h).send({ name: 'W' })).body.data.id;
    const created = await agent.post(L(w)).set(h).send({ destinationUrl: dest });
    expect(created.status).toBe(201);
    await agent
      .post(L(w, `/${created.body.data.id}/disable`))
      .set(h)
      .expect(200);
  });
});

describe('listing', () => {
  it('paginates newest-first with a cursor, never repeats, and caps the page size', async () => {
    const { c, ws } = await setup();
    for (let i = 0; i < 5; i++) await mk(c, ws, { title: `t${i}` });
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: { data: { id: string; title: string }[]; nextCursor: string | null } = (
        await get(c, L(ws, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`)).expect(200)
      ).body;
      seen.push(...res.data.map((x) => x.title));
      cursor = res.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(['t4', 't3', 't2', 't1', 't0']);
    await get(c, L(ws, '?limit=101')).expect(400);
  });

  it('filters by status, campaign and search text', async () => {
    const { c, ws } = await setup();
    const camp = await ctx.prisma.campaign.create({ data: { workspaceId: ws, name: 'C' } });
    const a = await mk(c, ws, { title: 'Alpha sale', campaignId: camp.id });
    await mk(c, ws, { title: 'Beta' });
    await post(c, L(ws, `/${a.id}/disable`)).expect(200);
    const ids = async (qs: string) =>
      ((await get(c, L(ws, qs)).expect(200)).body.data as { id: string }[]).map((x) => x.id);
    expect(await ids('?isActive=false')).toEqual([a.id]);
    expect(await ids(`?campaignId=${camp.id}`)).toEqual([a.id]);
    expect(await ids('?q=ALPHA')).toEqual([a.id]);
    expect(await ids('?q=gamma')).toEqual([]);
  });
});

describe('creation limits', () => {
  it('rate limits link creation per workspace', async () => {
    const { c, ws } = await setup();
    let last = 0;
    for (let i = 0; i < 121; i++) last = (await post(c, L(ws), { destinationUrl: dest })).status;
    expect(last).toBe(429);
  });
});

describe('edge cases', () => {
  it('concurrent creates of the same custom slug: exactly one wins', async () => {
    const { c, ws } = await setup();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => post(c, L(ws), { destinationUrl: dest, slug: 'race-slug' })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    expect(await ctx.prisma.link.count({ where: { slug: 'race-slug' } })).toBe(1);
  });

  it('a pagination cursor from another workspace leaks nothing and does not error', async () => {
    const a = await setup();
    const m = await setup();
    const foreign = await mk(a.c, a.ws, { title: 'secret' });
    await mk(m.c, m.ws, { title: 'mine' });
    const res = await get(m.c, L(m.ws, `?cursor=${foreign.id}`));
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(res.body)).not.toContain('secret');
    const bogus = await get(m.c, L(m.ws, '?cursor=does-not-exist'));
    expect(bogus.status).toBeLessThan(500);
  });

  it('search treats % and _ literally', async () => {
    const { c, ws } = await setup();
    await mk(c, ws, { title: 'plain' });
    await mk(c, ws, { title: '100% off' });
    const titles = async (q: string) =>
      (
        (await get(c, L(ws, `?q=${encodeURIComponent(q)}`)).expect(200)).body.data as {
          title: string;
        }[]
      ).map((l) => l.title);
    expect(await titles('%')).toEqual(['100% off']);
    expect(await titles('_')).toEqual([]);
  });

  it('records audit entries for domain and link lifecycle', async () => {
    const { c, ws } = await setup();
    const dom = await addVerifiedDomain(ctx, c, ws, 'a.client.com');
    const l = await mk(c, ws, { domainId: dom });
    await patch(c, L(ws, `/${l.id}`), { title: 'x' }).expect(200);
    await post(c, L(ws, `/${l.id}/disable`)).expect(200);
    await post(c, L(ws, `/${l.id}/enable`)).expect(200);
    await del(c, L(ws, `/${l.id}`)).expect(200);
    const actions = (await ctx.prisma.auditLog.findMany({ where: { workspaceId: ws } })).map(
      (a) => a.action,
    );
    for (const a of [
      'DOMAIN_ADDED',
      'DOMAIN_VERIFIED',
      'LINK_CREATED',
      'LINK_UPDATED',
      'LINK_DISABLED',
      'LINK_ENABLED',
      'LINK_DELETED',
    ]) {
      expect(actions).toContain(a);
    }
  });

  it('is case-sensitive for slugs but reserves words case-insensitively', async () => {
    const { c, ws } = await setup();
    await mk(c, ws, { slug: 'Sale2026' });
    await mk(c, ws, { slug: 'sale2026' });
    await post(c, L(ws), { destinationUrl: dest, slug: 'LOGIN' }).expect(409);
  });
});
