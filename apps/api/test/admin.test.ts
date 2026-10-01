import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { generateApiKey } from '../src/services/apiKeys';
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
const A = (p = '') => `/api/v1/admin${p}`;

async function makeAdmin(): Promise<Client> {
  const c = await registerUser(app, 'Root');
  await ctx.prisma.user.update({ where: { id: c.userId }, data: { systemRole: 'ADMIN' } });
  return c;
}

describe('access control', () => {
  it('is for system admins only: anonymous 401, ordinary users 403, workspace owners 403', async () => {
    const owner = await registerUser(app);
    await createWorkspace(owner);
    await request(app).get(A('/stats')).expect(401);
    for (const p of [
      '/stats',
      '/users',
      '/workspaces',
      '/domains',
      '/links',
      '/audit-logs',
      '/queues',
      '/queues/analytics/failed',
    ]) {
      await get(owner, A(p)).expect(403);
    }
    await post(owner, A('/cleanup/sessions/run')).expect(403);
    await patch(owner, A(`/users/${owner.userId}`), { systemRole: 'ADMIN' }).expect(403);
    expect(
      (await ctx.prisma.user.findUniqueOrThrow({ where: { id: owner.userId } })).systemRole,
    ).toBe('USER');
  });

  it('an API key never reaches the admin area, even when its creator is an admin', async () => {
    const admin = await makeAdmin();
    const ws = await createWorkspace(admin);
    const { key, keyHash, keyPrefix } = generateApiKey();
    await ctx.prisma.apiKey.create({
      data: {
        workspaceId: ws,
        createdById: admin.userId,
        name: 'k',
        keyHash,
        keyPrefix,
        role: 'MEMBER',
      },
    });
    await get(admin, A('/stats')).expect(200);
    await request(app).get(A('/stats')).set('Authorization', `Bearer ${key}`).expect(403);
  });

  it('CSRF still applies to admin writes made with a session', async () => {
    const admin = await makeAdmin();
    await admin.agent.post(A('/cleanup/sessions/run')).expect(403);
  });
});

describe('inspection', () => {
  it('lists users, workspaces, domains, links and audit logs across tenants, with no secrets anywhere', async () => {
    const admin = await makeAdmin();
    const u1 = await registerUser(app, 'Alice Wonder');
    const ws1 = await createWorkspace(u1, 'Alice Co');
    await post(u1, `/api/v1/workspaces/${ws1}/links`, {
      destinationUrl: 'https://example.org',
      slug: 'alice-link',
      password: 'open-sesame',
    }).expect(201);
    await post(u1, `/api/v1/workspaces/${ws1}/api-keys`, { name: 'k' }).expect(201);
    await post(u1, `/api/v1/workspaces/${ws1}/webhooks`, {
      url: 'https://hooks.example.com/x?t=secret-token',
      events: ['link.created'],
    }).expect(201);
    await post(u1, '/api/v1/auth/forgot-password', {}).catch(() => undefined);

    const users = (await get(admin, A('/users?q=alice')).expect(200)).body.data;
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      email: u1.email,
      name: 'Alice Wonder',
      systemRole: 'USER',
      workspaceCount: 1,
    });
    const all = {
      users: (await get(admin, A('/users')).expect(200)).body,
      workspaces: (await get(admin, A('/workspaces')).expect(200)).body,
      domains: (await get(admin, A('/domains')).expect(200)).body,
      links: (await get(admin, A('/links')).expect(200)).body,
      audit: (await get(admin, A('/audit-logs')).expect(200)).body,
      stats: (await get(admin, A('/stats')).expect(200)).body,
    };
    const dump = JSON.stringify(all);
    expect(dump).not.toMatch(
      /passwordHash|argon2|tokenHash|keyHash|"secret"|whsec_|enc:v1|csrfToken|open-sesame|secret-token/,
    );
    expect(
      all.workspaces.data.find((w: { slug: string }) => w.slug.startsWith('alice-co')),
    ).toMatchObject({ memberCount: 1, linkCount: 1 });
    expect(all.links.data[0]).toMatchObject({
      slug: 'alice-link',
      hostname: 'localhost:4001',
      hasPassword: true,
    });
    expect(all.domains.data.find((d: { shared: boolean }) => d.shared)).toMatchObject({
      hostname: 'localhost:4001',
      status: 'VERIFIED',
    });
    expect(all.stats.data).toMatchObject({ users: 2, workspaces: 1, links: 1 });
    expect(all.stats.data.queues.webhooks).toBeTypeOf('object');
  });

  it('filters and paginates with cursors', async () => {
    const admin = await makeAdmin();
    const u = await registerUser(app);
    const ws = await createWorkspace(u);
    for (let i = 0; i < 5; i++)
      await post(u, `/api/v1/workspaces/${ws}/links`, {
        destinationUrl: `https://example.org/${i}`,
        slug: `page-${i}`,
      }).expect(201);
    const p1 = (await get(admin, A(`/links?workspaceId=${ws}&limit=2`)).expect(200)).body;
    expect(p1.data.map((l: { slug: string }) => l.slug)).toEqual(['page-4', 'page-3']);
    const p2 = (
      await get(admin, A(`/links?workspaceId=${ws}&limit=2&cursor=${p1.nextCursor}`)).expect(200)
    ).body;
    expect(p2.data.map((l: { slug: string }) => l.slug)).toEqual(['page-2', 'page-1']);
    expect((await get(admin, A('/links?q=PAGE-0')).expect(200)).body.data).toHaveLength(1);
    expect((await get(admin, A('/links?q=%25')).expect(200)).body.data).toHaveLength(0); // wildcard is literal
    expect(
      (await get(admin, A('/audit-logs?action=LINK_CREATED')).expect(200)).body.data.length,
    ).toBe(5);
    expect((await get(admin, A('/domains?status=PENDING')).expect(200)).body.data).toEqual([]);
    await get(admin, A('/links?limit=101')).expect(400);
  });
});

describe('administrators', () => {
  it('grants and revokes the role, audited; cannot change oneself or remove the last admin', async () => {
    const admin = await makeAdmin();
    const u = await registerUser(app);
    await patch(admin, A(`/users/${u.userId}`), { systemRole: 'ADMIN' }).expect(200);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).systemRole).toBe(
      'ADMIN',
    );
    await get(u, A('/stats')).expect(200);
    await patch(admin, A(`/users/${admin.userId}`), { systemRole: 'USER' }).expect(403); // self
    await patch(u, A(`/users/${admin.userId}`), { systemRole: 'USER' }).expect(200); // another admin demotes the first
    await patch(u, A(`/users/${u.userId}`), { systemRole: 'USER' }).expect(403);
    await patch(u, A('/users/nope'), { systemRole: 'USER' }).expect(404);
    await patch(u, A(`/users/${u.userId}`), { systemRole: 'bogus' }).expect(400);
    const actions = (await ctx.prisma.auditLog.findMany()).map((a) => a.action);
    expect(actions).toContain('ADMIN_USER_ROLE_CHANGED');
  });

  it('refuses to demote the only remaining administrator', async () => {
    const a1 = await makeAdmin();
    const a2 = await makeAdmin();
    await patch(a1, A(`/users/${a2.userId}`), { systemRole: 'USER' }).expect(200);
    // a1 is now the only admin; a2 (a normal user again) cannot do anything, and a1 cannot demote itself.
    await patch(a1, A(`/users/${a1.userId}`), { systemRole: 'USER' }).expect(403);
    expect(await ctx.prisma.user.count({ where: { systemRole: 'ADMIN' } })).toBe(1);
  });
});

describe('queues, failed jobs and cleanup', () => {
  const closers: Array<() => Promise<unknown>> = [];
  afterEach(async () => {
    for (const c of closers.splice(0)) await c().catch(() => undefined);
  });

  async function failedAnalyticsJob() {
    const w = new Worker(
      'analytics-events',
      async () => {
        throw new Error('database unavailable');
      },
      { connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }) },
    );
    closers.push(() => w.close());
    const events = [1, 2, 3].map((i) => ({
      eventId: `e${i}`,
      linkId: 'l',
      workspaceId: 'w',
      campaignId: null,
      timestamp: Date.now(),
      ip: '203.0.113.77',
      userAgent: 'UA',
      referer: null,
      acceptLanguage: null,
      forwardedFor: null,
    }));
    const job = await ctx.queues.analytics.add(
      'batch',
      { batchId: 'b-1', events },
      { attempts: 1 },
    );
    for (let i = 0; i < 100 && (await ctx.queues.analytics.getFailedCount()) === 0; i++)
      await new Promise((r) => setTimeout(r, 50));
    await w.close();
    return job.id!;
  }

  it('shows failed jobs (reason, attempts) without exposing event payloads or IPs; retry and remove work', async () => {
    const admin = await makeAdmin();
    const id = await failedAnalyticsJob();
    const counts = (await get(admin, A('/queues')).expect(200)).body.data;
    expect(counts.analytics.failed).toBe(1);
    const res = await get(admin, A('/queues/analytics/failed')).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id,
      attemptsMade: 1,
      failedReason: 'database unavailable',
      summary: { batchId: 'b-1', events: 3 },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/203\.0\.113\.77|userAgent|eventId/);

    await post(admin, A(`/queues/analytics/failed/${id}/retry`)).expect(200);
    expect(await ctx.queues.analytics.getFailedCount()).toBe(0);
    expect(await ctx.queues.analytics.getWaitingCount()).toBe(1);
    await post(admin, A(`/queues/analytics/failed/${id}/retry`)).expect(404); // no longer failed

    expect((await ctx.prisma.auditLog.findMany()).map((a) => a.action)).toContain(
      'ADMIN_JOB_RETRIED',
    );
  });

  it('removes a failed job and validates queue names and ids', async () => {
    const admin = await makeAdmin();
    const id = await failedAnalyticsJob();
    await del(admin, A(`/queues/analytics/failed/${id}`)).expect(200);
    expect(await ctx.queues.analytics.getFailedCount()).toBe(0);
    await get(admin, A('/queues/bogus/failed')).expect(404);
    await del(admin, A('/queues/analytics/failed/does-not-exist')).expect(404);
    await get(admin, A('/queues/analytics/failed?limit=1000')).expect(400);
  });

  it('can trigger a cleanup task (queued, audited); unknown tasks are 404', async () => {
    const admin = await makeAdmin();
    await post(admin, A('/cleanup/sessions/run')).expect(202);
    const waiting = await ctx.queues.cleanup.getJobs(['waiting']);
    expect(waiting.map((j) => j.data)).toEqual([{ task: 'sessions' }]);
    await post(admin, A('/cleanup/drop-database/run')).expect(404);
    expect((await ctx.prisma.auditLog.findMany()).map((a) => a.action)).toContain(
      'ADMIN_CLEANUP_TRIGGERED',
    );
  });
});
