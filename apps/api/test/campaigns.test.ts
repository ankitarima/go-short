import type { AnalyticsEvent } from '@go-short/shared';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Hasher } from '../../worker/src/enrich';
import { BatchProcessor } from '../../worker/src/processBatch';
import { createWorkspace, del, get, makeCtx, patch, post, registerUser, resetDb } from './helpers';

const ctx = makeCtx();
const app = createApp(ctx);
beforeEach(() => resetDb(ctx));
afterAll(async () => {
  await ctx.redis.quit();
  await ctx.prisma.$disconnect();
});

const C = (ws: string, rest = '') => `/api/v1/workspaces/${ws}/campaigns${rest}`;
const L = (ws: string, rest = '') => `/api/v1/workspaces/${ws}/links${rest}`;
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function setup() {
  const c = await registerUser(app);
  const ws = await createWorkspace(c);
  return { c, ws };
}
const mkCampaign = async (
  c: Awaited<ReturnType<typeof registerUser>>,
  ws: string,
  body: object = {},
) =>
  (await post(c, C(ws), { name: 'Diwali 2026', ...body }).expect(201)).body.data as {
    id: string;
    [k: string]: unknown;
  };

describe('campaign CRUD', () => {
  it('creates a campaign with dates and a default utm_campaign; returns counts', async () => {
    const { c, ws } = await setup();
    const camp = await mkCampaign(c, ws, {
      name: '  Diwali 2026  ',
      description: 'Festival push',
      startDate: '2026-10-20T00:00:00Z',
      endDate: '2026-11-05T00:00:00Z',
      utmCampaign: 'diwali2026',
    });
    expect(camp).toMatchObject({
      name: 'Diwali 2026',
      description: 'Festival push',
      utmCampaign: 'diwali2026',
      linkCount: 0,
      qrCodeCount: 0,
    });
    expect(new Date(camp.startDate as string).toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect((await get(c, C(ws, `/${camp.id}`)).expect(200)).body.data.id).toBe(camp.id);
  });

  it.each([
    [{ name: '' }],
    [{ name: 'x'.repeat(121) }],
    [{ name: 'A', startDate: 'tomorrow' }],
    [{ name: 'A', startDate: '2026-11-05T00:00:00Z', endDate: '2026-10-20T00:00:00Z' }],
    [{ name: 'A', description: 'x'.repeat(1001) }],
    [{}],
  ])('rejects %j', async (body) => {
    const { c, ws } = await setup();
    await post(c, C(ws), body).expect(400);
  });

  it('patches fields and validates the merged date range', async () => {
    const { c, ws } = await setup();
    const camp = await mkCampaign(c, ws, {
      startDate: '2026-10-20T00:00:00Z',
      endDate: '2026-11-05T00:00:00Z',
    });
    const ok = (
      await patch(c, C(ws, `/${camp.id}`), { name: 'Renamed', description: null }).expect(200)
    ).body.data;
    expect(ok).toMatchObject({ name: 'Renamed', description: null });
    // endDate alone, earlier than the stored startDate
    await patch(c, C(ws, `/${camp.id}`), { endDate: '2026-10-01T00:00:00Z' }).expect(400);
    await patch(c, C(ws, `/${camp.id}`), { startDate: '2026-12-01T00:00:00Z' }).expect(400);
    await patch(c, C(ws, `/${camp.id}`), {}).expect(400);
    expect(
      (await patch(c, C(ws, `/${camp.id}`), { endDate: null }).expect(200)).body.data.endDate,
    ).toBeNull();
  });

  it('lists newest first with cursor pagination and search, counting links', async () => {
    const { c, ws } = await setup();
    for (const n of ['Alpha', 'Beta', 'Gamma', '100% Sale']) await mkCampaign(c, ws, { name: n });
    const first = (await get(c, C(ws, '?limit=3')).expect(200)).body;
    expect(first.data.map((x: { name: string }) => x.name)).toEqual(['100% Sale', 'Gamma', 'Beta']);
    const second = (await get(c, C(ws, `?limit=3&cursor=${first.nextCursor}`)).expect(200)).body;
    expect(second.data.map((x: { name: string }) => x.name)).toEqual(['Alpha']);
    expect(second.nextCursor).toBeNull();
    const names = async (q: string) =>
      (
        (await get(c, C(ws, `?q=${encodeURIComponent(q)}`)).expect(200)).body.data as {
          name: string;
        }[]
      ).map((x) => x.name);
    expect(await names('ALP')).toEqual(['Alpha']);
    expect(await names('%')).toEqual(['100% Sale']); // wildcard is literal
    await get(c, C(ws, '?limit=101')).expect(400);
  });

  it('audits create/update/delete', async () => {
    const { c, ws } = await setup();
    const camp = await mkCampaign(c, ws);
    await patch(c, C(ws, `/${camp.id}`), { name: 'B' }).expect(200);
    await del(c, C(ws, `/${camp.id}`)).expect(200);
    const actions = (await ctx.prisma.auditLog.findMany({ where: { workspaceId: ws } })).map(
      (a) => a.action,
    );
    for (const a of ['CAMPAIGN_CREATED', 'CAMPAIGN_UPDATED', 'CAMPAIGN_DELETED'])
      expect(actions).toContain(a);
  });
});

describe('links, QR codes and campaigns', () => {
  it('links join a campaign, are counted, and can be moved out', async () => {
    const { c, ws } = await setup();
    const camp = await mkCampaign(c, ws);
    const link = (
      await post(c, L(ws), { destinationUrl: 'https://example.org', campaignId: camp.id }).expect(
        201,
      )
    ).body.data;
    await ctx.prisma.qRCode.create({
      data: { workspaceId: ws, linkId: link.id, campaignId: camp.id, name: 'Poster' },
    });
    expect((await get(c, C(ws, `/${camp.id}`)).expect(200)).body.data).toMatchObject({
      linkCount: 1,
      qrCodeCount: 1,
    });
    expect(
      ((await get(c, L(ws, `?campaignId=${camp.id}`)).expect(200)).body.data as unknown[]).length,
    ).toBe(1);
    await patch(c, L(ws, `/${link.id}`), { campaignId: null }).expect(200);
    expect((await get(c, C(ws, `/${camp.id}`)).expect(200)).body.data.linkCount).toBe(0);
  });

  it('inherits the campaign default utm_campaign unless the link sets its own', async () => {
    const { c, ws } = await setup();
    const camp = await mkCampaign(c, ws, { utmCampaign: 'diwali2026' });
    const inherited = (
      await post(c, L(ws), { destinationUrl: 'https://example.org', campaignId: camp.id }).expect(
        201,
      )
    ).body.data;
    expect(inherited.utmCampaign).toBe('diwali2026');
    const own = (
      await post(c, L(ws), {
        destinationUrl: 'https://example.org',
        campaignId: camp.id,
        utmCampaign: 'custom',
      }).expect(201)
    ).body.data;
    expect(own.utmCampaign).toBe('custom');
    const plain = (await post(c, L(ws), { destinationUrl: 'https://example.org' }).expect(201)).body
      .data;
    expect(plain.utmCampaign).toBeNull();
    const moved = (await patch(c, L(ws, `/${plain.id}`), { campaignId: camp.id }).expect(200)).body
      .data;
    expect(moved.utmCampaign).toBe('diwali2026');
  });

  it('deleting a campaign keeps its links, detaches them, and purges their cached redirects', async () => {
    const { c, ws } = await setup();
    const camp = await mkCampaign(c, ws);
    const link = (
      await post(c, L(ws), {
        destinationUrl: 'https://example.org',
        campaignId: camp.id,
        slug: 'camp-link',
      }).expect(201)
    ).body.data;
    await ctx.redis.set('link:localhost:4001:camp-link', '{"stale":true}');
    await del(c, C(ws, `/${camp.id}`)).expect(200);
    expect(await ctx.redis.exists('link:localhost:4001:camp-link')).toBe(0);
    const after = (await get(c, L(ws, `/${link.id}`)).expect(200)).body.data;
    expect(after.campaignId).toBeNull();
    await get(c, C(ws, `/${camp.id}`)).expect(404);
  });
});

describe('tenant isolation, roles and flags', () => {
  it('another workspace cannot read, change, delete or analyse a campaign', async () => {
    const a = await setup();
    const m = await setup();
    const camp = await mkCampaign(a.c, a.ws);
    for (const ws of [m.ws, a.ws]) {
      await get(m.c, C(ws, `/${camp.id}`)).expect(404);
      await patch(m.c, C(ws, `/${camp.id}`), { name: 'pwned' }).expect(404);
      await del(m.c, C(ws, `/${camp.id}`)).expect(404);
      await get(m.c, C(ws, `/${camp.id}/analytics`)).expect(404);
      await get(m.c, C(ws, `/${camp.id}/analytics/export`)).expect(404);
    }
    expect((await get(m.c, C(m.ws)).expect(200)).body.data).toEqual([]);
    expect((await get(a.c, C(a.ws, `/${camp.id}`)).expect(200)).body.data.name).toBe('Diwali 2026');
  });

  it('viewer is read-only; member can create, edit and delete', async () => {
    const owner = await registerUser(app);
    const [viewer, member] = [await registerUser(app), await registerUser(app)];
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
    const camp = await mkCampaign(owner, ws);
    await get(viewer, C(ws, `/${camp.id}`)).expect(200);
    await post(viewer, C(ws), { name: 'x' }).expect(403);
    await patch(viewer, C(ws, `/${camp.id}`), { name: 'x' }).expect(403);
    await del(viewer, C(ws, `/${camp.id}`)).expect(403);
    const mine = await mkCampaign(member, ws, { name: 'Member campaign' });
    await patch(member, C(ws, `/${mine.id}`), { name: 'Edited' }).expect(200);
    await del(member, C(ws, `/${mine.id}`)).expect(200);
  });

  it('honours the campaigns feature flag', async () => {
    const off = createApp({ ...ctx, config: { ...ctx.config, FEATURE_CAMPAIGNS: false } });
    const agent = (await import('supertest')).default.agent(off);
    const reg = await agent
      .post('/api/v1/auth/register')
      .send({ email: 'f@example.com', name: 'F', password: 'correct-horse-battery' });
    const h = { 'X-CSRF-Token': reg.body.data.csrfToken as string };
    const w = (await agent.post('/api/v1/workspaces').set(h).send({ name: 'W' })).body.data.id;
    const res = await agent.get(C(w));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });
});

describe('campaign analytics (Campaign -> Links -> QR -> Analytics)', () => {
  const processor = () =>
    new BatchProcessor({
      prisma: ctx.prisma,
      logger: pino({ level: 'silent' }),
      geo: { lookup: () => ({ country: 'IN', region: 'Maharashtra', city: 'Mumbai' }) },
      hasher: new Hasher('campaign-test-secret-campaign-test-1'),
      now: () => Date.UTC(2026, 9, 20),
    });
  let n = 0;
  const ev = (
    linkId: string,
    workspaceId: string,
    campaignId: string | null,
    over: Partial<AnalyticsEvent> = {},
  ): AnalyticsEvent => ({
    eventId: `c-${Date.now()}-${n++}`,
    linkId,
    workspaceId,
    campaignId,
    timestamp: Date.UTC(2026, 9, 10, 12),
    ip: `1.1.1.${n % 250}`,
    userAgent: CHROME,
    referer: null,
    acceptLanguage: null,
    forwardedFor: null,
    ...over,
  });

  it('rolls every link and QR scan of the campaign into one dashboard, and excludes other campaigns', async () => {
    const { c, ws } = await setup();
    const camp = await mkCampaign(c, ws, { name: 'Diwali 2026' });
    const other = await mkCampaign(c, ws, { name: 'Other' });
    const mkLink = async (slug: string, body: object) =>
      (
        await post(c, L(ws), {
          destinationUrl: 'https://example.org',
          slug,
          campaignId: camp.id,
          ...body,
        }).expect(201)
      ).body.data as { id: string };
    const insta = await mkLink('insta', {
      utmSource: 'instagram',
      utmMedium: 'social',
      utmCampaign: 'diwali2026',
    });
    const fb = await mkLink('fbook', {
      utmSource: 'facebook',
      utmMedium: 'social',
      utmCampaign: 'diwali2026',
    });
    const qrLink = await mkLink('poster', {
      utmSource: 'offline',
      utmMedium: 'qr',
      utmCampaign: 'diwali2026',
    });
    const unrelated = (
      await post(c, L(ws), {
        destinationUrl: 'https://example.org',
        slug: 'unrelated',
        campaignId: other.id,
      }).expect(201)
    ).body.data;
    const qr = await ctx.prisma.qRCode.create({
      data: {
        workspaceId: ws,
        linkId: qrLink.id,
        campaignId: camp.id,
        name: 'Registration Poster',
      },
    });

    await processor().process([
      ...Array.from({ length: 5 }, () => ev(insta.id, ws, camp.id)),
      ...Array.from({ length: 3 }, () => ev(fb.id, ws, camp.id)),
      ...Array.from({ length: 4 }, () => ev(qrLink.id, ws, camp.id, { qrId: qr.id })),
      ev(qrLink.id, ws, camp.id), // same link, not via the QR
      ev(unrelated.id, ws, other.id),
    ]);

    const d = (
      await get(c, C(ws, `/${camp.id}/analytics?from=2026-10-01&to=2026-10-31`)).expect(200)
    ).body.data;
    expect(d.summary).toMatchObject({ clicks: 13, qrScans: 4 });
    expect(d.topLinks.map((t: { slug: string; clicks: number }) => [t.slug, t.clicks])).toEqual([
      ['insta', 5],
      ['poster', 5],
      ['fbook', 3],
    ]);
    expect(d.utmSources).toEqual([
      { value: 'instagram', clicks: 5 },
      { value: 'offline', clicks: 5 },
      { value: 'facebook', clicks: 3 },
    ]);
    expect(d.utmMediums).toEqual([
      { value: 'social', clicks: 8 },
      { value: 'qr', clicks: 5 },
    ]);
    expect(d.utmCampaigns).toEqual([{ value: 'diwali2026', clicks: 13 }]);
    expect(d.qrCodes).toEqual([{ value: qr.id, clicks: 4, name: 'Registration Poster' }]);
    expect(d.timeline.find((t: { date: string }) => t.date === '2026-10-10')).toMatchObject({
      clicks: 13,
    });

    // The other campaign only sees its own click.
    const o = (
      await get(c, C(ws, `/${other.id}/analytics?from=2026-10-01&to=2026-10-31`)).expect(200)
    ).body.data;
    expect(o.summary.clicks).toBe(1);
    // Workspace-wide view can be filtered to the campaign too.
    const f = (
      await get(
        c,
        `/api/v1/workspaces/${ws}/analytics?from=2026-10-01&to=2026-10-31&campaignId=${camp.id}`,
      ).expect(200)
    ).body.data;
    expect(f.summary.clicks).toBe(13);
  });

  it('campaign analytics export is scoped to the campaign', async () => {
    const { c, ws } = await setup();
    const camp = await mkCampaign(c, ws);
    const l = (
      await post(c, L(ws), {
        destinationUrl: 'https://example.org',
        slug: 'in-camp',
        campaignId: camp.id,
      }).expect(201)
    ).body.data;
    const l2 = (
      await post(c, L(ws), { destinationUrl: 'https://example.org', slug: 'not-in' }).expect(201)
    ).body.data;
    await processor().process([ev(l.id, ws, camp.id), ev(l2.id, ws, null)]);
    const csv = (
      await get(c, C(ws, `/${camp.id}/analytics/export?from=2026-10-01&to=2026-10-31`)).expect(200)
    ).text;
    expect(csv).toContain('in-camp');
    expect(csv).not.toContain('not-in');
  });
});
