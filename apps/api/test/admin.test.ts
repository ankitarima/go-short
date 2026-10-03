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
    await post(owner, A('/staff'), { email: owner.email, role: 'ADMIN' }).expect(403);
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

const makeStaff = async (role: 'MANAGER' | 'ADMIN' | 'SUPER_ADMIN'): Promise<Client> => {
  const c = await registerUser(app, role);
  await ctx.prisma.user.update({ where: { id: c.userId }, data: { systemRole: role } });
  return c;
};

describe('platform roles', () => {
  it('MANAGER can read everything but change nothing; ADMIN can act; staff management is SUPER_ADMIN only', async () => {
    const manager = await makeStaff('MANAGER');
    const admin = await makeStaff('ADMIN');
    const victim = await registerUser(app);
    for (const p of [
      '/me',
      '/stats',
      '/usage',
      '/users',
      '/teams',
      '/staff',
      '/workspaces',
      '/audit-logs',
      '/queues',
      '/monitoring',
    ])
      await get(manager, A(p)).expect(200);
    await post(manager, A(`/users/${victim.userId}/disable`)).expect(403);
    await post(manager, A('/cleanup/sessions/run')).expect(403);
    await post(manager, A('/staff'), { email: victim.email, role: 'MANAGER' }).expect(403);

    await post(admin, A(`/users/${victim.userId}/disable`)).expect(200);
    await post(admin, A(`/users/${victim.userId}/enable`)).expect(200);
    await post(admin, A('/staff'), { email: victim.email, role: 'MANAGER' }).expect(403); // admins cannot create staff
    await patch(admin, A(`/staff/${manager.userId}`), { role: 'ADMIN' }).expect(403);
    await del(admin, A(`/staff/${manager.userId}`)).expect(403);
  });

  it('/me reports the caller’s role and exactly the capabilities that role has', async () => {
    const manager = await makeStaff('MANAGER');
    const sa = await makeStaff('SUPER_ADMIN');
    const m = (await get(manager, A('/me')).expect(200)).body.data;
    expect(m.role).toBe('MANAGER');
    expect(m.capabilities).toEqual(['console:read']);
    const s = (await get(sa, A('/me')).expect(200)).body.data;
    expect(s.capabilities).toContain('staff:manage');
    expect(s.user.email).toBe(sa.email);
  });

  it('an API key never carries platform powers, even when its creator is staff', async () => {
    const sa = await makeStaff('SUPER_ADMIN');
    const ws = await createWorkspace(sa);
    const { key, keyPrefix, keyHash } = generateApiKey();
    await ctx.prisma.apiKey.create({
      data: {
        workspaceId: ws,
        createdById: sa.userId,
        name: 'k',
        keyPrefix,
        keyHash,
        role: 'MEMBER',
      },
    });
    await request(app).get(A('/me')).set('Authorization', `Bearer ${key}`).expect(403);
  });
});

describe('staff management', () => {
  it('adds, changes and removes staff, audited, with the safety rules', async () => {
    const sa = await makeStaff('SUPER_ADMIN');
    const sa2 = await makeStaff('SUPER_ADMIN');
    const u = await registerUser(app);

    const added = await post(sa, A('/staff'), {
      email: u.email.toUpperCase(),
      role: 'MANAGER',
    }).expect(201);
    expect(added.body.data).toMatchObject({ email: u.email, role: 'MANAGER', disabled: false });
    await post(sa, A('/staff'), { email: u.email, role: 'ADMIN' }).expect(409); // already staff
    await post(sa, A('/staff'), { email: 'nobody@example.com', role: 'ADMIN' }).expect(404);
    await post(sa, A('/staff'), { email: u.email, role: 'GOD' }).expect(400);

    await get(u, A('/stats')).expect(200); // manager now has console access
    await patch(sa, A(`/staff/${u.userId}`), { role: 'ADMIN' }).expect(200);
    await patch(sa, A(`/staff/${sa.userId}`), { role: 'ADMIN' }).expect(403); // not yourself
    await del(sa, A(`/staff/${sa.userId}`)).expect(403);
    await patch(sa, A('/staff/nope'), { role: 'ADMIN' }).expect(404);

    // two super admins: one may demote the other, but never the last one.
    await patch(sa, A(`/staff/${sa2.userId}`), { role: 'ADMIN' }).expect(200);
    await patch(sa2, A(`/staff/${u.userId}`), { role: 'MANAGER' }).expect(403); // demoted: can no longer manage staff
    await del(sa, A(`/staff/${u.userId}`)).expect(200);
    await get(u, A('/stats')).expect(403);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).systemRole).toBe(
      'USER',
    );

    const actions = (await ctx.prisma.auditLog.findMany()).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['STAFF_ADDED', 'STAFF_ROLE_CHANGED', 'STAFF_REMOVED']),
    );
  });

  it('never leaves the platform without an active super admin', async () => {
    const sa = await makeStaff('SUPER_ADMIN');
    const other = await makeStaff('SUPER_ADMIN');
    await ctx.prisma.user.update({ where: { id: other.userId }, data: { disabledAt: new Date() } }); // not "active"
    // sa is the only ACTIVE super admin: demoting/removing the disabled one is fine, anything touching sa is not possible (self-rules)
    await patch(sa, A(`/staff/${other.userId}`), { role: 'ADMIN' }).expect(200);
    const sb = await makeStaff('SUPER_ADMIN');
    await patch(sb, A(`/staff/${sa.userId}`), { role: 'ADMIN' }).expect(200);
    // sb is now the only active super admin; nobody else can demote them, and they cannot demote themselves.
    await patch(sb, A(`/staff/${sb.userId}`), { role: 'ADMIN' }).expect(403);
  });
});

describe('suspending accounts', () => {
  it('ends sessions, blocks sign-in and API keys, and can be undone', async () => {
    const admin = await makeStaff('ADMIN');
    const u = await registerUser(app);
    const ws = await createWorkspace(u);
    const { key, keyPrefix, keyHash } = generateApiKey();
    await ctx.prisma.apiKey.create({
      data: {
        workspaceId: ws,
        createdById: u.userId,
        name: 'k',
        keyPrefix,
        keyHash,
        role: 'MEMBER',
      },
    });
    await request(app).get('/api/v1/links').set('Authorization', `Bearer ${key}`).expect(200);

    const res = await post(admin, A(`/users/${u.userId}/disable`)).expect(200);
    expect(res.body.data).toEqual({ id: u.userId, disabled: true });
    await get(u, '/api/v1/me').expect(401); // session is gone
    await request(app).get('/api/v1/links').set('Authorization', `Bearer ${key}`).expect(401);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: 'correct-horse-battery' });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('ACCOUNT_DISABLED');
    // wrong password must NOT reveal that the account is suspended
    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: 'wrong-password-123' });
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

    await post(admin, A(`/users/${u.userId}/enable`)).expect(200);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: 'correct-horse-battery' })
      .expect(200);
    await request(app).get('/api/v1/links').set('Authorization', `Bearer ${key}`).expect(200);
    const actions = (await ctx.prisma.auditLog.findMany()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['ADMIN_USER_DISABLED', 'ADMIN_USER_ENABLED']));
  });

  it('protects staff: not yourself, only a super admin may suspend staff, never the last super admin', async () => {
    const admin = await makeStaff('ADMIN');
    const manager = await makeStaff('MANAGER');
    const sa = await makeStaff('SUPER_ADMIN');
    await post(admin, A(`/users/${admin.userId}/disable`)).expect(403);
    await post(admin, A(`/users/${manager.userId}/disable`)).expect(403); // staff: super admin only
    await post(admin, A(`/users/${sa.userId}/disable`)).expect(403);
    await post(admin, A('/users/nope/disable')).expect(404);
    await post(sa, A(`/users/${manager.userId}/disable`)).expect(200);
    const sa2 = await makeStaff('SUPER_ADMIN');
    await post(sa, A(`/users/${sa2.userId}/disable`)).expect(200); // sa remains active
    const sa3 = await makeStaff('SUPER_ADMIN');
    await ctx.prisma.user.update({ where: { id: sa.userId }, data: { disabledAt: new Date() } });
    await post(sa3, A(`/users/${sa3.userId}/disable`)).expect(403); // self
  });
});

describe('detail, teams and usage', () => {
  it('shows a user and a workspace in detail without secrets, and lists every membership', async () => {
    const mgr = await makeStaff('MANAGER');
    const owner = await registerUser(app, 'Olive');
    const ws = await createWorkspace(owner, 'Detail Co');
    const member = await registerUser(app, 'Mo');
    await ctx.prisma.workspaceMember.create({
      data: { workspaceId: ws, userId: member.userId, role: 'MEMBER' },
    });

    const u = (await get(mgr, A(`/users/${owner.userId}`)).expect(200)).body.data;
    expect(u).toMatchObject({
      email: owner.email,
      systemRole: 'USER',
      disabledAt: null,
      apiKeyCount: 0,
    });
    expect(u.workspaces).toEqual([
      expect.objectContaining({ id: ws, name: 'Detail Co', role: 'OWNER' }),
    ]);
    expect(JSON.stringify(u)).not.toMatch(/passwordHash|argon2|tokenHash/);

    const w = (await get(mgr, A(`/workspaces/${ws}`)).expect(200)).body.data;
    expect(w.members.map((m: { email: string }) => m.email).sort()).toEqual(
      [member.email, owner.email].sort(),
    );
    expect(w.counts).toMatchObject({ links: 0, apiKeys: 0 });
    await get(mgr, A('/workspaces/nope')).expect(404);
    await get(mgr, A('/users/nope')).expect(404);

    const teams = (await get(mgr, A(`/teams?workspaceId=${ws}`)).expect(200)).body;
    expect(teams.data).toHaveLength(2);
    expect(teams.data[0]).toMatchObject({ workspace: { id: ws }, user: { disabled: false } });
    expect((await get(mgr, A('/teams?role=OWNER&q=Detail')).expect(200)).body.data).toHaveLength(1);
    expect((await get(mgr, A('/teams?q=%25')).expect(200)).body.data).toHaveLength(0); // wildcard is literal
    const page1 = (await get(mgr, A(`/teams?workspaceId=${ws}&limit=1`)).expect(200)).body;
    expect(page1.data).toHaveLength(1);
    const page2 = (
      await get(mgr, A(`/teams?workspaceId=${ws}&limit=1&cursor=${page1.nextCursor}`)).expect(200)
    ).body;
    expect(page2.data[0].id).not.toBe(page1.data[0].id);
  });

  it('usage reports zero-filled daily series and the busiest workspaces', async () => {
    const mgr = await makeStaff('MANAGER');
    const owner = await registerUser(app);
    const ws = await createWorkspace(owner, 'Busy');
    const link = (
      await post(owner, `/api/v1/workspaces/${ws}/links`, {
        destinationUrl: 'https://example.org/x',
        slug: 'busy-1',
      }).expect(201)
    ).body.data;
    const today = new Date().toISOString().slice(0, 10);
    await ctx.prisma
      .$executeRaw`INSERT INTO "AnalyticsDaily" ("date","workspaceId","linkId","isBot","clicks","uniqueVisitors","mobileClicks","desktopClicks","tabletClicks") VALUES (${today}::date, ${ws}, ${link.id}, false, 42, 10, 0, 0, 0)`;
    const d = (await get(mgr, A('/usage?days=7')).expect(200)).body.data;
    expect(d.days).toBe(7);
    expect(d.clicks).toHaveLength(7);
    expect(d.clicks.at(-1)).toEqual({ date: today, count: 42 });
    expect(d.totals).toMatchObject({ clicks: 42, linksCreated: 1, activeWorkspaces: 1 });
    expect(d.topWorkspaces[0]).toMatchObject({ workspaceId: ws, name: 'Busy', clicks: 42 });
    expect(d.signups.at(-1).count).toBeGreaterThanOrEqual(2);
    await get(mgr, A('/usage?days=3')).expect(400);
    await get(mgr, A('/usage?days=500')).expect(400);
  });

  it('audit logs show who acted', async () => {
    const sa = await makeStaff('SUPER_ADMIN');
    const u = await registerUser(app);
    await post(sa, A('/staff'), { email: u.email, role: 'MANAGER' }).expect(201);
    const logs = (await get(sa, A('/audit-logs?action=STAFF_ADDED')).expect(200)).body.data;
    expect(logs[0].actor).toMatchObject({ email: sa.email });
    const byActor = (await get(sa, A(`/audit-logs?q=${encodeURIComponent(sa.email)}`)).expect(200))
      .body.data;
    expect(byActor.length).toBeGreaterThan(0);
  });
});

describe('monitoring', () => {
  it('without Prometheus it says so, and never accepts arbitrary queries', async () => {
    const mgr = await makeStaff('MANAGER');
    const m = (await get(mgr, A('/monitoring')).expect(200)).body.data;
    expect(m.configured).toBe(false);
    expect(m.metrics.length).toBeGreaterThan(5);
    expect(m.metrics.every((x: { value: unknown }) => x.value === null)).toBe(true);
    await get(mgr, A('/monitoring/range?query=redirects_per_second')).expect(503);
    await get(mgr, A('/monitoring/range?query=up%7Bjob%3D%22api%22%7D')).expect(404); // raw PromQL is not a metric name
    await get(mgr, A('/monitoring/range?query=')).expect(400);
  });

  it('reads the fixed metric set from Prometheus, with the query chosen by the SERVER', async () => {
    const seen: string[] = [];
    const { createServer } = await import('node:http');
    const fake = createServer((req, res) => {
      const u = new URL(req.url!, 'http://x');
      seen.push(u.searchParams.get('query') ?? '');
      res.setHeader('content-type', 'application/json');
      res.end(
        u.pathname.endsWith('query_range')
          ? JSON.stringify({
              status: 'success',
              data: {
                result: [
                  {
                    values: [
                      [1790000000, '1.5'],
                      [1790000060, '2.5'],
                    ],
                  },
                ],
              },
            })
          : JSON.stringify({
              status: 'success',
              data: { result: [{ value: [1790000000, '12.5'] }] },
            }),
      );
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
    const port = (fake.address() as import('node:net').AddressInfo).port;
    try {
      const wired = {
        ...ctx,
        config: {
          ...ctx.config,
          PROMETHEUS_URL: `http://127.0.0.1:${port}`,
          CONSOLE_GRAFANA_URL: 'https://grafana.example.com',
        },
      };
      const wiredApp = createApp(wired);
      const mgr = await makeStaff('MANAGER');
      const agent = { ...mgr, agent: request.agent(wiredApp) };
      await agent.agent
        .post('/api/v1/auth/login')
        .send({ email: mgr.email, password: 'correct-horse-battery' })
        .expect(200);
      const m = (await agent.agent.get(A('/monitoring')).expect(200)).body.data;
      expect(m.configured).toBe(true);
      expect(m.links.grafana).toBe('https://grafana.example.com');
      expect(m.metrics.find((x: { name: string }) => x.name === 'redirects_per_second').value).toBe(
        12.5,
      );
      const r = (
        await agent.agent
          .get(A('/monitoring/range?query=redirects_per_second&minutes=60'))
          .expect(200)
      ).body.data;
      expect(r.points).toEqual([
        { t: 1790000000000, v: 1.5 },
        { t: 1790000060000, v: 2.5 },
      ]);
      // Only server-defined PromQL ever reaches Prometheus.
      expect(seen.every((q) => q.includes('goshort_') || q.includes('up{'))).toBe(true);
    } finally {
      fake.close();
    }
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

describe('list filters and totals', () => {
  it('users can hide or show only platform staff, and lists report a total', async () => {
    const sa = await makeStaff('SUPER_ADMIN');
    await makeStaff('MANAGER');
    const u1 = await registerUser(app, 'Cust One');
    await registerUser(app, 'Cust Two');
    const all = (await get(sa, A('/users')).expect(200)).body;
    expect(all.total).toBe(4);
    const customers = (await get(sa, A('/users?staff=exclude')).expect(200)).body;
    expect(customers.total).toBe(2);
    expect(customers.data.every((u: { systemRole: string }) => u.systemRole === 'USER')).toBe(true);
    const staff = (await get(sa, A('/users?staff=only')).expect(200)).body;
    expect(staff.total).toBe(2);
    expect(staff.data.some((u: { id: string }) => u.id === u1.userId)).toBe(false);
    // total ignores paging but follows the search
    const page = (await get(sa, A('/users?staff=exclude&limit=1')).expect(200)).body;
    expect(page.data).toHaveLength(1);
    expect(page.total).toBe(2);
    expect((await get(sa, A('/users?staff=exclude&q=Cust%20One')).expect(200)).body.total).toBe(1);
    await get(sa, A('/users?staff=maybe')).expect(400);
    expect(typeof (await get(sa, A('/workspaces')).expect(200)).body.total).toBe('number');
    expect(typeof (await get(sa, A('/teams')).expect(200)).body.total).toBe('number');
  });
});
