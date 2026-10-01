import { WEBHOOK_EVENTS, type WebhookJob, openSecret } from '@go-short/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { generateApiKey } from '../src/services/apiKeys';
import {
  type Client,
  addVerifiedDomain,
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

const W = (ws: string, rest = '') => `/api/v1/workspaces/${ws}/webhooks${rest}`;
const URL1 = 'https://hooks.example.com/in/abc?token=very-secret-token';

async function setup() {
  const owner = await registerUser(app);
  const ws = await createWorkspace(owner);
  const hook = async (events: string[] = ['link.created'], url = URL1) =>
    (await post(owner, W(ws), { url, events }).expect(201)).body.data as {
      id: string;
      secret: string;
    };
  return { owner, ws, hook };
}
async function jobs(): Promise<WebhookJob[]> {
  return (await ctx.queues.webhooks.getJobs(['waiting', 'delayed', 'active', 'prioritized'])).map(
    (j) => j.data as WebhookJob,
  );
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

describe('webhook management', () => {
  it('returns the signing secret once, stores it encrypted, and never lists it', async () => {
    const { owner, ws } = await setup();
    const created = (
      await post(owner, W(ws), {
        url: URL1,
        events: ['link.created', 'link.created', 'domain.verified'],
      }).expect(201)
    ).body.data;
    expect(created.secret).toMatch(/^whsec_[A-Za-z0-9_-]{32}$/);
    expect(created.events).toEqual(['link.created', 'domain.verified']); // de-duplicated
    const list = (await get(owner, W(ws)).expect(200)).body;
    expect(JSON.stringify(list)).not.toContain(created.secret);
    expect(list.data[0]).toMatchObject({ id: created.id, url: URL1, isActive: true });
    const row = await ctx.prisma.webhook.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.secret.startsWith('enc:v1:')).toBe(true);
    expect(row.secret).not.toContain(created.secret);
    expect(openSecret(row.secret, ctx.config.SESSION_SECRET)).toBe(created.secret);
  });

  it('audit entries record the host, never the URL (tokens) or the secret', async () => {
    const { owner, ws, hook } = await setup();
    const h = await hook();
    await del(owner, W(ws, `/${h.id}`)).expect(200);
    const dump = JSON.stringify(await ctx.prisma.auditLog.findMany({ where: { workspaceId: ws } }));
    expect(dump).toContain('WEBHOOK_CREATED');
    expect(dump).toContain('hooks.example.com');
    expect(dump).not.toMatch(/very-secret-token|whsec_|\/in\/abc/);
  });

  it.each([
    ['http (not https)', { url: 'http://hooks.example.com/x' }],
    ['localhost', { url: 'https://localhost/x' }],
    ['loopback IP', { url: 'https://127.0.0.1/x' }],
    ['cloud metadata IP', { url: 'https://169.254.169.254/latest/meta-data' }],
    ['private IP', { url: 'https://10.0.0.5/x' }],
    ['credentials in URL', { url: 'https://user:pw@hooks.example.com/x' }],
    ['internal hostname', { url: 'https://db.internal/x' }],
    ['not a URL', { url: 'not a url' }],
    ['no events', { events: [] }],
    ['unknown event', { events: ['link.exploded'] }],
    ['reserved future event', { events: ['analytics.threshold'] }],
    ['missing url', { url: undefined }],
  ])('rejects %s', async (_n, over) => {
    const { owner, ws } = await setup();
    await post(owner, W(ws), { url: URL1, events: ['link.created'], ...over }).expect(400);
  });

  it('only OWNER/ADMIN manage webhooks; non-members get 404; API keys are refused', async () => {
    const { owner, ws, hook } = await setup();
    const h = await hook();
    const [admin, member, viewer, stranger] = [
      await addMember(owner, ws, 'ADMIN'),
      await addMember(owner, ws, 'MEMBER'),
      await addMember(owner, ws, 'VIEWER'),
      await registerUser(app),
    ];
    await get(admin, W(ws)).expect(200);
    for (const u of [member, viewer]) {
      await get(u, W(ws)).expect(403);
      await post(u, W(ws), { url: URL1, events: ['link.created'] }).expect(403);
      await del(u, W(ws, `/${h.id}`)).expect(403);
    }
    await get(stranger, W(ws)).expect(404);
    await del(stranger, W(ws, `/${h.id}`)).expect(404);
    const { key, keyHash, keyPrefix } = generateApiKey();
    await ctx.prisma.apiKey.create({
      data: {
        workspaceId: ws,
        createdById: owner.userId,
        name: 'k',
        keyHash,
        keyPrefix,
        role: 'MEMBER',
      },
    });
    await request(app).get(W(ws)).set('Authorization', `Bearer ${key}`).expect(403);
  });

  it('IDOR: another workspace cannot read, change, rotate, test or delete a webhook', async () => {
    const a = await setup();
    const b = await setup();
    const h = await a.hook();
    for (const ws of [b.ws, a.ws]) {
      await patch(b.owner, W(ws, `/${h.id}`), { isActive: false }).expect(404);
      await post(b.owner, W(ws, `/${h.id}/rotate-secret`)).expect(404);
      await post(b.owner, W(ws, `/${h.id}/test`)).expect(404);
      await del(b.owner, W(ws, `/${h.id}`)).expect(404);
    }
    expect((await get(b.owner, W(b.ws))).body.data).toEqual([]);
    expect((await ctx.prisma.webhook.findUniqueOrThrow({ where: { id: h.id } })).isActive).toBe(
      true,
    );
  });

  it('patches url/events/active, rotates the secret (old one stops being the stored one), and sends test events', async () => {
    const { owner, ws, hook } = await setup();
    const h = await hook();
    const upd = (
      await patch(owner, W(ws, `/${h.id}`), {
        events: ['link.deleted'],
        isActive: false,
        url: 'https://other.example.com/x',
      }).expect(200)
    ).body.data;
    expect(upd).toMatchObject({
      events: ['link.deleted'],
      isActive: false,
      url: 'https://other.example.com/x',
    });
    await patch(owner, W(ws, `/${h.id}`), { url: 'http://insecure.example.com' }).expect(400);
    await patch(owner, W(ws, `/${h.id}`), {}).expect(400);
    const rotated = (await post(owner, W(ws, `/${h.id}/rotate-secret`)).expect(200)).body.data;
    expect(rotated.secret).not.toBe(h.secret);
    const row = await ctx.prisma.webhook.findUniqueOrThrow({ where: { id: h.id } });
    expect(openSecret(row.secret, ctx.config.SESSION_SECRET)).toBe(rotated.secret);

    const t = (await post(owner, W(ws, `/${h.id}/test`)).expect(202)).body.data;
    const queued = (await jobs()).find((j) => j.deliveryId === t.deliveryId);
    expect(queued).toMatchObject({ webhookId: h.id, type: 'webhook.test', workspaceId: ws });
  });

  it('caps webhooks per workspace', async () => {
    const { owner, ws } = await setup();
    await ctx.prisma.webhook.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        workspaceId: ws,
        url: `https://h${i}.example.com`,
        secret: 'x',
        events: ['link.created'],
      })),
    });
    await post(owner, W(ws), { url: URL1, events: ['link.created'] }).expect(409);
  });

  it('every documented event name is accepted', async () => {
    const { owner, ws } = await setup();
    await post(owner, W(ws), { url: URL1, events: [...WEBHOOK_EVENTS] }).expect(201);
  });
});

describe('event emission', () => {
  const L = (ws: string, rest = '') => `/api/v1/workspaces/${ws}/links${rest}`;

  it('link lifecycle events are queued for subscribed, active webhooks with a safe payload', async () => {
    const { owner, ws, hook } = await setup();
    const h = await hook(['link.created', 'link.updated', 'link.deleted']);
    const link = (
      await post(owner, L(ws), {
        destinationUrl: 'https://example.org/p',
        slug: 'hooked',
        password: 'open-sesame',
      }).expect(201)
    ).body.data;
    await patch(owner, L(ws, `/${link.id}`), { title: 'T' }).expect(200);
    await post(owner, L(ws, `/${link.id}/disable`)).expect(200);
    await del(owner, L(ws, `/${link.id}`)).expect(200);
    const q = await jobs();
    expect(q.map((j) => j.type).sort()).toEqual([
      'link.created',
      'link.deleted',
      'link.updated',
      'link.updated',
    ]);
    for (const j of q) expect(j).toMatchObject({ webhookId: h.id, workspaceId: ws });
    const created = q.find((j) => j.type === 'link.created')!;
    expect(created.data).toMatchObject({
      link: { id: link.id, slug: 'hooked', hasPassword: true },
    });
    expect(JSON.stringify(q)).not.toMatch(/passwordHash|argon2|open-sesame/);
    expect(q.find((j) => j.type === 'link.deleted')!.data).toEqual({
      link: { id: link.id, slug: 'hooked', hostname: 'localhost:4001' },
    });
    expect(new Set(q.map((j) => j.deliveryId)).size).toBe(q.length); // unique delivery ids
  });

  it('respects subscriptions, the active flag and workspace boundaries', async () => {
    const a = await setup();
    const b = await setup();
    await a.hook(['link.updated']); // not subscribed to creation
    const inactive = await a.hook(['link.created']);
    await patch(a.owner, W(a.ws, `/${inactive.id}`), { isActive: false }).expect(200);
    await b.hook(['link.created']); // another workspace's hook
    await post(a.owner, L(a.ws), { destinationUrl: 'https://example.org' }).expect(201);
    expect(await jobs()).toEqual([]);
    await post(b.owner, L(b.ws), { destinationUrl: 'https://example.org' }).expect(201);
    const q = await jobs();
    expect(q).toHaveLength(1);
    expect(q[0]!.workspaceId).toBe(b.ws);
  });

  it('campaign.created and domain.verified are emitted; the domain payload never contains the verification token', async () => {
    const { owner, ws, hook } = await setup();
    await hook(['campaign.created', 'domain.verified']);
    await post(owner, `/api/v1/workspaces/${ws}/campaigns`, { name: 'Diwali' }).expect(201);
    const domainId = await addVerifiedDomain(ctx, owner, ws, 'links.client.com');
    const q = await jobs();
    expect(q.map((j) => j.type).sort()).toEqual(['campaign.created', 'domain.verified']);
    expect(q.find((j) => j.type === 'campaign.created')!.data).toMatchObject({
      campaign: { name: 'Diwali' },
    });
    const dv = q.find((j) => j.type === 'domain.verified')!;
    expect(dv.data).toEqual({
      domain: { id: domainId, hostname: 'links.client.com', status: 'VERIFIED' },
    });
    const token = (await ctx.prisma.domain.findUniqueOrThrow({ where: { id: domainId } }))
      .verificationToken;
    expect(JSON.stringify(q)).not.toContain(token);
  });

  it('a queue outage never fails the mutation (emission is best-effort)', async () => {
    const broken = {
      ...ctx,
      queues: {
        ...ctx.queues,
        webhooks: { add: () => Promise.reject(new Error('redis down')) } as never,
      },
    };
    const agent = (await import('supertest')).default.agent(createApp(broken));
    const reg = await agent
      .post('/api/v1/auth/register')
      .send({ email: 'q@example.com', name: 'Q', password: 'correct-horse-battery' });
    const h = { 'X-CSRF-Token': reg.body.data.csrfToken as string };
    const ws = (await agent.post('/api/v1/workspaces').set(h).send({ name: 'W' })).body.data.id;
    await agent
      .post(W(ws))
      .set(h)
      .send({ url: URL1, events: ['link.created'] })
      .expect(201);
    // The subscribed webhook cannot be queued, yet the link is still created.
    await agent.post(L(ws)).set(h).send({ destinationUrl: 'https://example.org/ok' }).expect(201);
    expect(await ctx.prisma.link.count({ where: { workspaceId: ws } })).toBe(1);
  });
});
