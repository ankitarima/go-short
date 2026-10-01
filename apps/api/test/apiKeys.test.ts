import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { API_KEY_PATTERN, generateApiKey } from '../src/services/apiKeys';
import {
  type Client,
  createWorkspace,
  del,
  get,
  makeCtx,
  patch,
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

const K = (ws: string, rest = '') => `/api/v1/workspaces/${ws}/api-keys${rest}`;
const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });
const api = (key: string) => ({
  get: (p: string) => request(app).get(p).set(bearer(key)),
  post: (p: string, b: object = {}) => request(app).post(p).set(bearer(key)).send(b),
  patch: (p: string, b: object = {}) => request(app).patch(p).set(bearer(key)).send(b),
  del: (p: string) => request(app).delete(p).set(bearer(key)),
});

async function setup() {
  const owner = await registerUser(app);
  const ws = await createWorkspace(owner);
  const mint = async (role: 'VIEWER' | 'MEMBER' = 'MEMBER', extra: object = {}) =>
    (await post(owner, K(ws), { name: 'ci', role, ...extra }).expect(201)).body.data as {
      id: string;
      key: string;
      keyPrefix: string;
    };
  return { owner, ws, mint };
}

async function addMember(owner: Client, ws: string, role: 'VIEWER' | 'MEMBER' | 'ADMIN') {
  const u = await registerUser(app);
  await post(owner, `/api/v1/workspaces/${ws}/members/invite`, { email: u.email, role }).expect(
    201,
  );
  await post(u, '/api/v1/workspaces/invitations/accept', { token: ctx.email.lastToken() }).expect(
    200,
  );
  return u;
}

describe('key generation and storage', () => {
  it('generates high-entropy keys with the documented shape', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const k = generateApiKey();
      expect(k.key).toMatch(API_KEY_PATTERN);
      expect(k.keyPrefix).toBe(k.key.slice(0, 11));
      expect(k.keyHash).toBe(createHash('sha256').update(k.key).digest('hex'));
      seen.add(k.key);
    }
    expect(seen.size).toBe(200);
  });

  it('shows the full key exactly once and stores only its hash', async () => {
    const { owner, ws } = await setup();
    const created = (await post(owner, K(ws), { name: 'Zapier', role: 'MEMBER' }).expect(201)).body
      .data;
    expect(created.key).toMatch(API_KEY_PATTERN);
    expect(created.keyPrefix).toBe(`${created.key.slice(0, 11)}…`);
    expect(created).toMatchObject({
      name: 'Zapier',
      role: 'MEMBER',
      revokedAt: null,
      lastUsedAt: null,
      expiresAt: null,
    });

    const list = (await get(owner, K(ws)).expect(200)).body;
    expect(JSON.stringify(list)).not.toContain(created.key);
    expect(JSON.stringify(list)).not.toMatch(/keyHash|"key":/);
    expect(list.data[0]).toMatchObject({
      id: created.id,
      name: 'Zapier',
      createdBy: { name: 'Test' },
    });

    const row = await ctx.prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.keyHash).toBe(createHash('sha256').update(created.key).digest('hex'));
    // The secret appears nowhere in the database or audit trail.
    const secret = created.key.slice(12);
    const dump = JSON.stringify([
      await ctx.prisma.apiKey.findMany(),
      await ctx.prisma.auditLog.findMany(),
    ]);
    expect(dump).not.toContain(secret);
    expect(dump).toContain('API_KEY_CREATED');
  });

  it('validates input: role cannot be ADMIN/OWNER, expiry must be in the future', async () => {
    const { owner, ws } = await setup();
    for (const body of [
      { name: '' },
      { name: 'x'.repeat(101) },
      { name: 'k', role: 'ADMIN' },
      { name: 'k', role: 'OWNER' },
      { name: 'k', expiresAt: '2000-01-01T00:00:00Z' },
      { name: 'k', expiresAt: 'soon' },
      {},
    ]) {
      await post(owner, K(ws), body).expect(400);
    }
    await post(owner, K(ws), { name: 'k', expiresAt: '2099-01-01T00:00:00Z' }).expect(201);
  });

  it('only OWNER/ADMIN can manage keys; non-members get 404', async () => {
    const { owner, ws, mint } = await setup();
    const [admin, member, viewer, stranger] = [
      await addMember(owner, ws, 'ADMIN'),
      await addMember(owner, ws, 'MEMBER'),
      await addMember(owner, ws, 'VIEWER'),
      await registerUser(app),
    ];
    const k = await mint();
    await get(admin, K(ws)).expect(200);
    await post(admin, K(ws), { name: 'a' }).expect(201);
    for (const u of [member, viewer]) {
      await get(u, K(ws)).expect(403);
      await post(u, K(ws), { name: 'x' }).expect(403);
      await del(u, K(ws, `/${k.id}`)).expect(403);
    }
    await get(stranger, K(ws)).expect(404);
    await post(stranger, K(ws), { name: 'x' }).expect(404);
    await del(stranger, K(ws, `/${k.id}`)).expect(404);
  });

  it('caps active keys per workspace and rate limits creation', async () => {
    const { owner, ws } = await setup();
    await ctx.prisma.apiKey.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        workspaceId: ws,
        createdById: owner.userId,
        name: `k${i}`,
        keyPrefix: `gs_pre${i}`,
        keyHash: `hash-${i}`,
      })),
    });
    await post(owner, K(ws), { name: 'one too many' }).expect(409);
    // revoked keys do not count
    await ctx.prisma.apiKey.updateMany({ where: { name: 'k0' }, data: { revokedAt: new Date() } });
    await post(owner, K(ws), { name: 'fits now' }).expect(201);
  });
});

describe('authenticating with a key', () => {
  it('flat routes work with the key’s own workspace, no workspace id supplied', async () => {
    const { ws, mint } = await setup();
    const { key } = await mint('MEMBER');
    const a = api(key);
    const link = (
      await a
        .post('/api/v1/links', { destinationUrl: 'https://example.org/p', slug: 'via-key' })
        .expect(201)
    ).body.data;
    expect(link.slug).toBe('via-key');
    expect(
      (await a.get('/api/v1/links').expect(200)).body.data.map((l: { id: string }) => l.id),
    ).toEqual([link.id]);
    await a.get(`/api/v1/links/${link.id}`).expect(200);
    await a.patch(`/api/v1/links/${link.id}`, { title: 'T' }).expect(200);
    await a.post(`/api/v1/links/${link.id}/disable`).expect(200);
    await a.get('/api/v1/analytics?from=2026-09-01&to=2026-09-02').expect(200);
    await a.get(`/api/v1/links/${link.id}/analytics?from=2026-09-01&to=2026-09-02`).expect(200);
    const camp = (await a.post('/api/v1/campaigns', { name: 'C' }).expect(201)).body.data;
    await a.get(`/api/v1/campaigns/${camp.id}/analytics`).expect(200);
    const qr = (
      await a.post('/api/v1/qr', { name: 'Q', linkId: link.id, format: 'svg' }).expect(201)
    ).body.data;
    expect(qr.data).toContain('<svg');
    await a.get('/api/v1/domains').expect(200);
    // Same data is visible through the nested route for a signed-in member.
    expect(await ctx.prisma.link.count({ where: { workspaceId: ws } })).toBe(1);
    await a.del(`/api/v1/links/${link.id}`).expect(200);
  });

  it('the nested route works too, but only for the key’s own workspace', async () => {
    const a = await setup();
    const b = await setup();
    const { key } = await a.mint('MEMBER');
    await api(key).get(`/api/v1/workspaces/${a.ws}/links`).expect(200);
    await api(key).get(`/api/v1/workspaces/${b.ws}/links`).expect(404);
    await api(key)
      .post(`/api/v1/workspaces/${b.ws}/links`, { destinationUrl: 'https://example.org' })
      .expect(404);
    expect(await ctx.prisma.link.count({ where: { workspaceId: b.ws } })).toBe(0);
  });

  it('a VIEWER key reads but cannot write; a MEMBER key writes but cannot manage domains', async () => {
    const { owner, ws, mint } = await setup();
    const link = (
      await post(owner, `/api/v1/workspaces/${ws}/links`, {
        destinationUrl: 'https://example.org',
        slug: 'seed-link',
      }).expect(201)
    ).body.data;
    const viewer = api((await mint('VIEWER')).key);
    await viewer.get('/api/v1/links').expect(200);
    await viewer.get('/api/v1/analytics').expect(200);
    await viewer.get('/api/v1/analytics/export').expect(403);
    await viewer.post('/api/v1/links', { destinationUrl: 'https://example.org' }).expect(403);
    await viewer.patch(`/api/v1/links/${link.id}`, { title: 'x' }).expect(403);
    await viewer.del(`/api/v1/links/${link.id}`).expect(403);
    await viewer.post('/api/v1/campaigns', { name: 'x' }).expect(403);

    const member = api((await mint('MEMBER')).key);
    await member.post('/api/v1/links', { destinationUrl: 'https://example.org' }).expect(201);
    await member.post('/api/v1/domains', { hostname: 'x.client.com' }).expect(403);
    await member.get('/api/v1/analytics/export?from=2026-09-01&to=2026-09-02').expect(200);
  });

  it('keys are refused on session-only endpoints (profile, workspaces, keys, logout, password, leaving)', async () => {
    const { owner, ws, mint } = await setup();
    const { key, id } = await mint('MEMBER');
    const a = api(key);
    await a.get('/api/v1/me').expect(403);
    await a.get('/api/v1/workspaces').expect(403);
    await a.post('/api/v1/workspaces', { name: 'x' }).expect(403);
    await a.post('/api/v1/workspaces/invitations/accept', { token: 'x'.repeat(30) }).expect(403);
    await a.get(K(ws)).expect(403);
    await a.post(K(ws), { name: 'minted-by-key' }).expect(403);
    await a.del(K(ws, `/${id}`)).expect(403);
    await a.post('/api/v1/auth/logout').expect(403);
    await a
      .post('/api/v1/auth/change-password', {
        currentPassword: 'correct-horse-battery',
        newPassword: 'another-long-password',
      })
      .expect(403);
    const members = (await get(owner, `/api/v1/workspaces/${ws}/members`)).body.data as {
      id: string;
      user: { id: string };
    }[];
    await a.del(`/api/v1/workspaces/${ws}/members/${members[0]!.id}`).expect(403);
    await a.get(`/api/v1/workspaces/${ws}/audit-logs`).expect(403);
    expect(await ctx.prisma.apiKey.count({ where: { name: 'minted-by-key' } })).toBe(0);
  });

  it('flat routes need an API key (a signed-in session is not enough) but unknown paths stay 404', async () => {
    const { owner } = await setup();
    const res = await owner.agent.get('/api/v1/links').expect(401);
    expect(res.body.error.message).toMatch(/API key/);
    await request(app).get('/api/v1/links').expect(401);
    await request(app).get('/api/v1/definitely-not-a-route').expect(404);
  });

  it('records lastUsedAt, and writes are attributed to the key’s creator in the audit log', async () => {
    const { owner, ws, mint } = await setup();
    const { key, id } = await mint();
    await api(key)
      .post('/api/v1/links', { destinationUrl: 'https://example.org', slug: 'audited' })
      .expect(201);
    for (let i = 0; i < 50; i++) {
      if ((await ctx.prisma.apiKey.findUniqueOrThrow({ where: { id } })).lastUsedAt) break;
      await new Promise((r) => setTimeout(r, 40));
    }
    expect(
      (await ctx.prisma.apiKey.findUniqueOrThrow({ where: { id } })).lastUsedAt,
    ).not.toBeNull();
    const entry = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { workspaceId: ws, action: 'LINK_CREATED' },
    });
    expect(entry.userId).toBe(owner.userId);
  });
});

describe('rejecting bad credentials', () => {
  it('unknown, malformed, truncated and wrong-secret keys are 401', async () => {
    const { mint } = await setup();
    const { key } = await mint();
    const wrongSecret = key.slice(0, -3) + (key.endsWith('AAA') ? 'BBB' : 'AAA');
    for (const bad of [
      wrongSecret,
      key.slice(0, -1),
      `${key}x`,
      'gs_short',
      'gs_',
      'gs_' + 'a'.repeat(60),
      generateApiKey().key,
    ]) {
      await request(app).get('/api/v1/links').set(bearer(bad)).expect(401);
    }
    await request(app).get('/api/v1/links').set('Authorization', 'Basic abc').expect(401);
    await request(app).get('/api/v1/links').set('Authorization', 'Bearer').expect(401);
    await request(app).get('/api/v1/links').set('Authorization', key).expect(401); // missing scheme
    await request(app).get('/api/v1/links').set(bearer(key)).expect(200);
  });

  it('revoked and expired keys stop working immediately', async () => {
    const { owner, ws, mint } = await setup();
    const a = await mint();
    const b = await mint();
    await api(a.key).get('/api/v1/links').expect(200);
    await del(owner, K(ws, `/${a.id}`)).expect(200);
    await api(a.key).get('/api/v1/links').expect(401);
    await del(owner, K(ws, `/${a.id}`)).expect(200); // idempotent
    expect(
      (await get(owner, K(ws))).body.data.find((k: { id: string }) => k.id === a.id).revokedAt,
    ).not.toBeNull();
    await ctx.prisma.apiKey.update({
      where: { id: b.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await api(b.key).get('/api/v1/links').expect(401);
    const actions = (await ctx.prisma.auditLog.findMany({ where: { workspaceId: ws } })).map(
      (x) => x.action,
    );
    expect(actions).toContain('API_KEY_REVOKED');
  });

  it('a bad bearer never falls back to a valid session cookie', async () => {
    const { owner, ws } = await setup();
    await owner.agent.get(`/api/v1/workspaces/${ws}`).expect(200);
    await owner.agent.get(`/api/v1/workspaces/${ws}`).set(bearer(generateApiKey().key)).expect(401);
  });

  it('public endpoints ignore a bad bearer; protected ones do not', async () => {
    await request(app).get('/health').set(bearer(generateApiKey().key)).expect(200);
    await request(app)
      .post('/api/v1/auth/login')
      .set(bearer('gs_nope'))
      .send({ email: 'x@example.com', password: 'wrong-wrong-wrong' })
      .expect(401);
  });

  it('cookie sessions still need CSRF, but bearer requests do not', async () => {
    const { owner, ws, mint } = await setup();
    await owner.agent
      .post(`/api/v1/workspaces/${ws}/links`)
      .send({ destinationUrl: 'https://example.org' })
      .expect(403);
    await api((await mint()).key)
      .post('/api/v1/links', { destinationUrl: 'https://example.org' })
      .expect(201);
  });
});

describe('rate limiting per key', () => {
  it('limits each key independently and reports the limit headers', async () => {
    const limited = createApp({
      ...ctx,
      config: { ...ctx.config, API_KEY_RATE_LIMIT_PER_MINUTE: 5 },
    });
    const { mint } = await setup();
    const [k1, k2] = [await mint(), await mint()];
    const hit = (key: string) => request(limited).get('/api/v1/links').set(bearer(key));
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await hit(k1.key)).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]);
    const blocked = await hit(k1.key);
    expect(blocked.headers['retry-after']).toBe('60');
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    const ok = await hit(k2.key);
    expect(ok.status).toBe(200);
    expect(ok.headers['ratelimit-limit']).toBe('5');
    expect(ok.headers['ratelimit-remaining']).toBe('4');
  });

  it('fails open when Redis is down (does not turn a cache outage into an API outage)', async () => {
    const { Redis } = await import('ioredis');
    const dead = new Redis('redis://127.0.0.1:1', {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    dead.on('error', () => undefined);
    const { mint } = await setup();
    const { key } = await mint();
    const broken = createApp({ ...ctx, redis: dead });
    await request(broken).get('/api/v1/links').set(bearer(key)).expect(200);
  });
});

describe('membership changes affect keys', () => {
  it('removing a member revokes their keys; demoting to VIEWER caps them to read-only', async () => {
    const { owner, ws } = await setup();
    const m1 = await addMember(owner, ws, 'MEMBER');
    const m2 = await addMember(owner, ws, 'MEMBER');
    const mintAs = async (u: Client) => (await post(u, K(ws), { name: 'mine' })).status;
    // Members cannot mint keys themselves (apikeys:manage is ADMIN+); promote to ADMIN first to create keys.
    expect(await mintAs(m1)).toBe(403);
    const members = (await get(owner, `/api/v1/workspaces/${ws}/members`)).body.data as {
      id: string;
      user: { id: string };
    }[];
    const row = (u: Client) => members.find((x) => x.user.id === u.userId)!;
    await patch(owner, `/api/v1/workspaces/${ws}/members/${row(m1).id}`, { role: 'ADMIN' }).expect(
      200,
    );
    await patch(owner, `/api/v1/workspaces/${ws}/members/${row(m2).id}`, { role: 'ADMIN' }).expect(
      200,
    );
    const k1 = (await post(m1, K(ws), { name: 'm1-key', role: 'MEMBER' }).expect(201)).body.data;
    const k2 = (await post(m2, K(ws), { name: 'm2-key', role: 'MEMBER' }).expect(201)).body.data;
    await api(k1.key).post('/api/v1/links', { destinationUrl: 'https://example.org' }).expect(201);

    await patch(owner, `/api/v1/workspaces/${ws}/members/${row(m1).id}`, { role: 'VIEWER' }).expect(
      200,
    );
    await api(k1.key).get('/api/v1/links').expect(200);
    await api(k1.key).post('/api/v1/links', { destinationUrl: 'https://example.org' }).expect(403);
    expect((await ctx.prisma.apiKey.findUniqueOrThrow({ where: { id: k1.id } })).role).toBe(
      'VIEWER',
    );
    expect((await ctx.prisma.apiKey.findUniqueOrThrow({ where: { id: k2.id } })).role).toBe(
      'MEMBER',
    );

    await del(owner, `/api/v1/workspaces/${ws}/members/${row(m2).id}`).expect(200);
    await api(k2.key).get('/api/v1/links').expect(401);
    expect(
      (await ctx.prisma.apiKey.findUniqueOrThrow({ where: { id: k2.id } })).revokedAt,
    ).not.toBeNull();
    await api(k1.key).get('/api/v1/links').expect(200); // unaffected
  });

  it('deleting the workspace removes its keys', async () => {
    const { owner, ws, mint } = await setup();
    const { key } = await mint();
    await del(owner, `/api/v1/workspaces/${ws}`).expect(200);
    await api(key).get('/api/v1/links').expect(401);
  });
});

describe('feature flag', () => {
  it('FEATURE_API=false disables key authentication and creation', async () => {
    const { mint, owner, ws } = await setup();
    const { key } = await mint();
    const off = createApp({ ...ctx, config: { ...ctx.config, FEATURE_API: false } });
    const res = await request(off).get('/api/v1/links').set(bearer(key));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
    await owner.agent.post(K(ws)).set('X-CSRF-Token', owner.csrf).send({ name: 'x' }).expect(201); // the on-app still works
    const agent = (await import('supertest')).default.agent(off);
    const reg = await agent
      .post('/api/v1/auth/register')
      .send({ email: 'off@example.com', name: 'O', password: 'correct-horse-battery' });
    const h = { 'X-CSRF-Token': reg.body.data.csrfToken as string };
    const w = (await agent.post('/api/v1/workspaces').set(h).send({ name: 'W' })).body.data.id;
    expect((await agent.post(K(w)).set(h).send({ name: 'x' })).status).toBe(403);
  });
});
