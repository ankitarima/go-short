import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { ensureSharedDomain } from '../src/services/domains';
import {
  type Client,
  consoleLogin,
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
const A = (p = '') => `/api/v1/admin/shared-domains${p}`;

async function staff(role: 'MANAGER' | 'ADMIN' | 'SUPER_ADMIN'): Promise<Client> {
  const c = await registerUser(app, 'Staff');
  await ctx.prisma.user.update({ where: { id: c.userId }, data: { systemRole: role } });
  return consoleLogin(c);
}
const list = async (c: Client) =>
  (await get(c, A()).expect(200)).body.data as {
    domains: {
      id: string;
      hostname: string;
      status: string;
      isDefault: boolean;
      linkCount: number;
    }[];
    cnameTarget: string;
    appHostname: string;
  };
const add = (c: Client, hostname: string, makeDefault?: boolean) =>
  post(c, A(), { hostname, ...(makeDefault === undefined ? {} : { makeDefault }) });
const byHost = async (c: Client, h: string) =>
  (await list(c)).domains.find((d) => d.hostname === h)!;
const tls = (domain: string) => request(app).get('/internal/tls-check').query({ domain });

/** A link created through the public API in a fresh workspace; returns its short URL. */
async function link(c: Client, ws: string, domainId?: string): Promise<{ shortUrl: string }> {
  const res = await post(c, `/api/v1/workspaces/${ws}/links`, {
    destinationUrl: 'https://example.org/page',
    ...(domainId ? { domainId } : {}),
  }).expect(201);
  return res.body.data;
}

describe('access', () => {
  it('everyone on the staff can read; only a super admin can change; anonymous and app users cannot', async () => {
    const manager = await staff('MANAGER');
    const admin = await staff('ADMIN');
    const root = await staff('SUPER_ADMIN');
    await get(manager, A()).expect(200);
    await get(admin, A()).expect(200);
    await add(manager, 'a.example.com').expect(403);
    await add(admin, 'a.example.com').expect(403);
    await add(root, 'a.example.com').expect(201);
    const id = (await byHost(root, 'a.example.com')).id;
    await patch(admin, A(`/${id}`), { disabled: true }).expect(403);
    await del(admin, A(`/${id}`)).expect(403);
    await request(app).get('/api/v1/admin/shared-domains').expect(401);
    const user = await registerUser(app);
    await get(user, A()).expect(401);
    expect((await get(root, '/api/v1/admin/me').expect(200)).body.data.capabilities).toContain(
      'domains:manage',
    );
    expect((await get(admin, '/api/v1/admin/me').expect(200)).body.data.capabilities).not.toContain(
      'domains:manage',
    );
  });
});

describe('listing', () => {
  it('shows the seeded domain as default, link counts, the CNAME target and the app hostname', async () => {
    const root = await staff('SUPER_ADMIN');
    const owner = await registerUser(app);
    const ws = await createWorkspace(owner);
    await link(owner, ws);
    await link(owner, ws);
    const l = await list(root);
    expect(l.domains).toHaveLength(1);
    expect(l.domains[0]).toMatchObject({
      hostname: 'localhost:4001',
      status: 'VERIFIED',
      isDefault: true,
      linkCount: 2,
    });
    expect(l.cnameTarget).toBe('localhost');
    expect(l.appHostname).toBe('localhost');
  });
});

describe('adding', () => {
  it('a new shared domain is immediately usable by every workspace, in redirects and in TLS approval', async () => {
    const root = await staff('SUPER_ADMIN');
    const owner = await registerUser(app);
    const ws = await createWorkspace(owner);
    await tls('go2.example.com').expect(404);
    const created = (await add(root, 'GO2.Example.com').expect(201)).body.data;
    expect(created).toMatchObject({
      hostname: 'go2.example.com',
      status: 'VERIFIED',
      isDefault: false,
      linkCount: 0,
    });
    await tls('go2.example.com').expect(200);
    const domains = (await get(owner, `/api/v1/workspaces/${ws}/domains`).expect(200)).body
      .data as { hostname: string; shared: boolean }[];
    expect(domains.filter((d) => d.shared).map((d) => d.hostname)).toContain('go2.example.com');
    const l = await link(owner, ws, created.id);
    expect(l.shortUrl).toMatch(/^https?:\/\/go2\.example\.com\//);
    // The default is unchanged unless asked for.
    expect((await byHost(root, 'localhost:4001')).isDefault).toBe(true);
  });

  it('makeDefault moves the default, and new links without a domain use it', async () => {
    const root = await staff('SUPER_ADMIN');
    const owner = await registerUser(app);
    const ws = await createWorkspace(owner);
    await add(root, 'go2.example.com', true).expect(201);
    const l = await list(root);
    expect(l.domains.filter((d) => d.isDefault).map((d) => d.hostname)).toEqual([
      'go2.example.com',
    ]);
    expect((await link(owner, ws)).shortUrl).toMatch(/\/\/go2\.example\.com\//);
  });

  it('rejects bad names, the app hostname, duplicates and names a workspace already owns', async () => {
    const root = await staff('SUPER_ADMIN');
    const owner = await registerUser(app);
    const ws = await createWorkspace(owner);
    for (const bad of ['not a host', 'http://x.com/path', '10.0.0.1', '', 'localhost']) {
      const res = await add(root, bad);
      expect([400, 409]).toContain(res.status);
    }
    await add(root, 'go2.example.com').expect(201);
    expect((await add(root, 'go2.example.com').expect(409)).body.error.code).toBe('DOMAIN_TAKEN');
    await post(owner, `/api/v1/workspaces/${ws}/domains`, { hostname: 'mine.example.com' }).expect(
      201,
    );
    expect((await add(root, 'mine.example.com').expect(409)).body.error.code).toBe('DOMAIN_TAKEN');
    // ...and the other direction: a workspace cannot claim a shared name.
    expect(
      (
        await post(owner, `/api/v1/workspaces/${ws}/domains`, {
          hostname: 'go2.example.com',
        }).expect(409)
      ).body.error.code,
    ).toBe('DOMAIN_TAKEN');
  });

  it('refuses the app’s own hostname', async () => {
    const custom = createApp({
      ...ctx,
      config: { ...ctx.config, APP_URL: 'https://app.platform.io' },
    });
    const c = await registerUser(custom);
    await ctx.prisma.user.update({ where: { id: c.userId }, data: { systemRole: 'SUPER_ADMIN' } });
    const root = await consoleLogin(c);
    const res = await post(root, A(), { hostname: 'APP.platform.io' }).expect(409);
    expect(res.body.error.code).toBe('DOMAIN_TAKEN');
    expect(res.body.error.message).toMatch(/app’s own hostname/);
    expect((await get(root, A()).expect(200)).body.data.appHostname).toBe('app.platform.io');
  });

  it('treats the environment seed as an ordinary shared domain: a duplicate says so, and it can be re-added once removed', async () => {
    const seeded = createApp({
      ...ctx,
      config: { ...ctx.config, DEFAULT_SHORT_DOMAIN: 'go.seed.example.com' },
    });
    const c = await registerUser(seeded);
    await ctx.prisma.user.update({ where: { id: c.userId }, data: { systemRole: 'SUPER_ADMIN' } });
    const root = await consoleLogin(c);
    // Seed it the way a first boot with that environment value would.
    await ctx.prisma.domain.create({
      data: {
        hostname: 'go.seed.example.com',
        workspaceId: null,
        status: 'VERIFIED',
        isVerified: true,
        verificationToken: 'shared',
      },
    });
    const dup = await post(root, A(), { hostname: 'go.seed.example.com' }).expect(409);
    expect(dup.body.error.message).toMatch(/already a shared short domain/);
    expect(dup.body.error.message).not.toMatch(/app’s own hostname/);
    const row = await ctx.prisma.domain.findFirstOrThrow({
      where: { hostname: 'go.seed.example.com' },
    });
    await ctx.prisma.domain.delete({ where: { id: row.id } });
    await post(root, A(), { hostname: 'go.seed.example.com' }).expect(201);
  });

  it('says when a workspace already uses the name', async () => {
    const root = await staff('SUPER_ADMIN');
    const owner = await registerUser(app);
    const ws = await createWorkspace(owner);
    await post(owner, `/api/v1/workspaces/${ws}/domains`, { hostname: 'mine.example.com' }).expect(
      201,
    );
    const res = await add(root, 'mine.example.com').expect(409);
    expect(res.body.error.message).toMatch(/workspace already uses/);
  });

  it('is audited', async () => {
    const root = await staff('SUPER_ADMIN');
    const id = (await add(root, 'go2.example.com').expect(201)).body.data.id;
    const row = await ctx.prisma.auditLog.findFirst({ where: { action: 'SHARED_DOMAIN_ADDED' } });
    expect(row).toMatchObject({ resourceId: id, userId: root.userId });
    expect(row!.metadata).toMatchObject({ hostname: 'go2.example.com' });
  });
});

describe('default, disable, enable', () => {
  it('guards the default and the last active domain; disabling stops TLS and new links', async () => {
    const root = await staff('SUPER_ADMIN');
    const owner = await registerUser(app);
    const ws = await createWorkspace(owner);
    const seed = await byHost(root, 'localhost:4001');
    // Cannot disable the default, nor the only active domain.
    expect(
      (await patch(root, A(`/${seed.id}`), { disabled: true }).expect(409)).body.error.code,
    ).toBe('CONFLICT');
    const second = (await add(root, 'go2.example.com').expect(201)).body.data;
    await patch(root, A(`/${second.id}`), { isDefault: true }).expect(200);
    expect((await list(root)).domains.find((d) => d.id === seed.id)!.isDefault).toBe(false);
    const l = await link(owner, ws, seed.id);
    expect(l.shortUrl).toContain('localhost:4001');

    // The old default can now be disabled; its links' domain stops being usable.
    await patch(root, A(`/${seed.id}`), { disabled: true }).expect(200);
    await tls('localhost:4001').expect(404);
    expect(
      (
        await post(owner, `/api/v1/workspaces/${ws}/links`, {
          destinationUrl: 'https://example.org/x',
          domainId: seed.id,
        }).expect(409)
      ).body.error.code,
    ).toBe('DOMAIN_NOT_USABLE');
    // A disabled domain cannot be made the default; the last active one cannot be disabled.
    expect(
      (await patch(root, A(`/${seed.id}`), { isDefault: true }).expect(409)).body.error.code,
    ).toBe('DOMAIN_NOT_USABLE');
    await patch(root, A(`/${second.id}`), { disabled: true }).expect(409);

    await patch(root, A(`/${seed.id}`), { disabled: false }).expect(200);
    await tls('localhost:4001').expect(200);
    await patch(root, A('/does-not-exist'), { disabled: true }).expect(404);
    await patch(root, A(`/${seed.id}`), {}).expect(400);
  });

  it('clears cached redirects for a domain that is switched off', async () => {
    const root = await staff('SUPER_ADMIN');
    const owner = await registerUser(app);
    const ws = await createWorkspace(owner);
    const second = (await add(root, 'go2.example.com').expect(201)).body.data;
    const l = (
      await post(owner, `/api/v1/workspaces/${ws}/links`, {
        destinationUrl: 'https://example.org/x',
        domainId: second.id,
      }).expect(201)
    ).body.data as { slug: string };
    const key = `link:go2.example.com:${l.slug}`;
    await ctx.redis.set(key, '{"cached":true}');
    await patch(root, A(`/${second.id}`), { disabled: true }).expect(200);
    expect(await ctx.redis.get(key)).toBeNull();
  });
});

describe('removing', () => {
  it('refuses the default and any domain that still has links, otherwise removes it', async () => {
    const root = await staff('SUPER_ADMIN');
    const owner = await registerUser(app);
    const ws = await createWorkspace(owner);
    const seed = await byHost(root, 'localhost:4001');
    expect((await del(root, A(`/${seed.id}`)).expect(409)).body.error.code).toBe('CONFLICT');
    const second = (await add(root, 'go2.example.com').expect(201)).body.data;
    await link(owner, ws, second.id);
    const res = await del(root, A(`/${second.id}`)).expect(409);
    expect(res.body.error.message).toMatch(/1 link still use/);
    const third = (await add(root, 'go3.example.com').expect(201)).body.data;
    await del(root, A(`/${third.id}`)).expect(200);
    await tls('go3.example.com').expect(404);
    await del(root, A(`/${third.id}`)).expect(404);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'SHARED_DOMAIN_REMOVED' } })).toBe(1);
  });
});

describe('customers’ CNAME target', () => {
  it('follows the default shared domain, and a record for an older shared domain still verifies', async () => {
    const root = await staff('SUPER_ADMIN');
    const owner = await registerUser(app);
    const ws = await createWorkspace(owner);
    const dnsOf = async (host: string) => {
      const d = (
        await post(owner, `/api/v1/workspaces/${ws}/domains`, { hostname: host }).expect(201)
      ).body.data;
      return d as { id: string; dns: { cname: { value: string } } };
    };
    expect((await dnsOf('before.client.com')).dns.cname.value).toBe('localhost');

    const second = (await add(root, 'go2.example.com', true).expect(201)).body.data;
    expect(second.isDefault).toBe(true);
    expect((await list(root)).cnameTarget).toBe('go2.example.com');
    const later = await dnsOf('after.client.com');
    expect(later.dns.cname.value).toBe('go2.example.com');

    // A customer who pointed at the old shared host before the switch can still verify.
    ctx.dns.cname.set('before.client.com', ['localhost.']);
    const before = (
      await get(owner, `/api/v1/workspaces/${ws}/domains`).expect(200)
    ).body.data.find((d: { hostname: string }) => d.hostname === 'before.client.com');
    const v = await post(owner, `/api/v1/workspaces/${ws}/domains/${before.id}/verify`).expect(200);
    expect(v.body.data.verified).toBe(true);
    // ...and so does one pointed at the new default.
    ctx.dns.cname.set('after.client.com', ['go2.example.com']);
    expect(
      (await post(owner, `/api/v1/workspaces/${ws}/domains/${later.id}/verify`).expect(200)).body
        .data.verified,
    ).toBe(true);
  });
});

describe('the environment value is only a first-boot seed', () => {
  it('does not undo console changes on restart, and does not add a second default', async () => {
    const root = await staff('SUPER_ADMIN');
    const seed = await byHost(root, 'localhost:4001');
    const second = (await add(root, 'go2.example.com', true).expect(201)).body.data;
    await patch(root, A(`/${seed.id}`), { disabled: true }).expect(200);
    await ensureSharedDomain(ctx); // what every API start does
    const l = await list(root);
    expect(l.domains).toHaveLength(2);
    expect(l.domains.find((d) => d.id === seed.id)).toMatchObject({
      status: 'DISABLED',
      isDefault: false,
    });
    expect(l.domains.find((d) => d.id === second.id)).toMatchObject({ isDefault: true });
  });

  it('seeds the first domain when there are none', async () => {
    await ctx.prisma.domain.deleteMany();
    await ensureSharedDomain(ctx);
    const rows = await ctx.prisma.domain.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hostname: 'localhost:4001',
      workspaceId: null,
      isDefault: true,
      status: 'VERIFIED',
    });
  });
});

describe('DNS hint', () => {
  it('compares the domain’s addresses with the app’s', async () => {
    const root = await staff('SUPER_ADMIN');
    const { id } = (await add(root, 'go2.example.com').expect(201)).body.data;
    const check = async () => (await get(root, A(`/${id}/dns`)).expect(200)).body.data;
    expect((await check()).result).toBe('not_resolving');
    ctx.dns.addresses.set('go2.example.com', ['203.0.113.7']);
    expect((await check()).result).toBe('unknown'); // the app host does not resolve here
    ctx.dns.addresses.set('localhost', ['198.51.100.1']);
    expect((await check()).result).toBe('differs');
    ctx.dns.addresses.set('go2.example.com', ['203.0.113.7', '198.51.100.1']);
    expect(await check()).toMatchObject({
      result: 'matches',
      hostname: 'go2.example.com',
      appAddresses: ['198.51.100.1'],
    });
    await get(root, A('/nope/dns')).expect(404);
  });
});
