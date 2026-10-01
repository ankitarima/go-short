import { AppError, type AnalyticsEvent } from '@go-short/shared';
import { analyticsQuery } from '@go-short/validation';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { queryAnalytics } from '../src/services/analytics';
import { csvCell } from '../src/services/export';
import { Hasher } from '../../worker/src/enrich';
import { BatchProcessor } from '../../worker/src/processBatch';
import { type Client, createWorkspace, get, makeCtx, post, registerUser, resetDb } from './helpers';

const ctx = makeCtx();
const app = createApp(ctx);
beforeEach(() => resetDb(ctx));
afterAll(async () => {
  await ctx.redis.quit();
  await ctx.prisma.$disconnect();
});

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const geo = {
  lookup: (ip: string) =>
    ip.startsWith('1.')
      ? { country: 'IN', region: 'Maharashtra', city: 'Mumbai' }
      : ip.startsWith('2.')
        ? { country: 'DE', region: 'Berlin', city: 'Berlin' }
        : { country: null, region: null, city: null },
};
const processor = () =>
  new BatchProcessor({
    prisma: ctx.prisma,
    logger: pino({ level: 'silent' }),
    geo,
    hasher: new Hasher('analytics-test-secret-analytics-test-1'),
    now: () => Date.UTC(2026, 9, 20),
  });

let n = 0;
const ev = (
  linkId: string,
  workspaceId: string,
  over: Partial<AnalyticsEvent> = {},
): AnalyticsEvent => ({
  eventId: `a-${Date.now()}-${n++}`,
  linkId,
  workspaceId,
  campaignId: null,
  timestamp: Date.UTC(2026, 8, 10, 12),
  ip: '1.1.1.1',
  userAgent: CHROME,
  referer: null,
  acceptLanguage: null,
  forwardedFor: null,
  ...over,
});
const at = (d: number, h = 12, m = 0) => Date.UTC(2026, 8, d, h, m);

async function setup() {
  const c = await registerUser(app);
  const ws = await createWorkspace(c);
  const mkLink = async (slug: string, extra: object = {}) =>
    (
      await post(c, `/api/v1/workspaces/${ws}/links`, {
        destinationUrl: 'https://example.org/x',
        slug,
        ...extra,
      }).expect(201)
    ).body.data as { id: string };
  return { c, ws, mkLink };
}
const A = (ws: string, qs = '', base = '') => `/api/v1/workspaces/${ws}${base}/analytics${qs}`;
const q = (o: Record<string, string>) => '?' + new URLSearchParams(o).toString();
const RANGE = { from: '2026-09-08', to: '2026-09-12' };

describe('analytics summary, timeline and breakdowns', () => {
  it('rolls events up into summary, zero-filled timeline, breakdowns and labelled top links', async () => {
    const { c, ws, mkLink } = await setup();
    const l1 = await mkLink('alpha', { title: 'Alpha', utmSource: 'instagram' });
    const l2 = await mkLink('beta');
    await processor().process([
      ev(l1.id, ws, {
        timestamp: at(9),
        ip: '1.1.1.1',
        userAgent: IPHONE,
        referer: 'https://t.co/a',
      }),
      ev(l1.id, ws, {
        timestamp: at(9),
        ip: '1.1.1.1',
        userAgent: IPHONE,
        referer: 'https://t.co/a',
      }), // same visitor
      ev(l1.id, ws, { timestamp: at(10), ip: '2.2.2.2', userAgent: CHROME }),
      ev(l2.id, ws, { timestamp: at(10), ip: '2.2.2.3', userAgent: CHROME }),
      ev(l2.id, ws, { timestamp: at(11), ip: '9.9.9.9', userAgent: BOT }),
    ]);
    const d = (await get(c, A(ws, q(RANGE))).expect(200)).body.data;
    expect(d.summary).toEqual({
      clicks: 5,
      humanClicks: 4,
      botClicks: 1,
      uniqueVisitors: 4,
      qrScans: 0,
    });
    expect(d.timeline).toEqual([
      { date: '2026-09-08', clicks: 0, humanClicks: 0, botClicks: 0 },
      { date: '2026-09-09', clicks: 2, humanClicks: 2, botClicks: 0 },
      { date: '2026-09-10', clicks: 2, humanClicks: 2, botClicks: 0 },
      { date: '2026-09-11', clicks: 1, humanClicks: 0, botClicks: 1 },
      { date: '2026-09-12', clicks: 0, humanClicks: 0, botClicks: 0 },
    ]);
    // ties are broken alphabetically, so the order is deterministic
    expect(d.countries).toEqual([
      { value: 'DE', clicks: 2 },
      { value: 'IN', clicks: 2 },
    ]);
    expect(d.devices).toEqual([
      { value: 'DESKTOP', clicks: 2 },
      { value: 'MOBILE', clicks: 2 },
      { value: 'OTHER', clicks: 1 }, // the Googlebot click: bots are included by default
    ]);
    expect(d.referrers).toEqual(
      expect.arrayContaining([
        { value: 't.co', clicks: 2 },
        { value: '(direct)', clicks: 3 },
      ]),
    );
    expect(d.utmSources).toEqual([{ value: 'instagram', clicks: 3 }]);
    expect(d.topLinks.map((t: { slug: string; clicks: number }) => [t.slug, t.clicks])).toEqual([
      ['alpha', 3],
      ['beta', 2],
    ]);
    expect(d.topLinks[0]).toMatchObject({ title: 'Alpha', deleted: false });
    expect(d.meta).toMatchObject({
      timezone: 'UTC',
      from: '2026-09-08',
      to: '2026-09-12',
      granularity: 'day',
      source: 'rollup',
    });
  });

  it('excludes bots when asked (and when the workspace filters them by default)', async () => {
    const { c, ws, mkLink } = await setup();
    const l = await mkLink('alpha');
    await processor().process([ev(l.id, ws), ev(l.id, ws, { ip: '1.1.1.2', userAgent: BOT })]);
    expect((await get(c, A(ws, q(RANGE))).expect(200)).body.data.summary).toMatchObject({
      clicks: 2,
      humanClicks: 1,
      botClicks: 1,
    });
    const off = (await get(c, A(ws, q({ ...RANGE, includeBots: 'false' }))).expect(200)).body.data;
    expect(off.summary).toMatchObject({ clicks: 1, humanClicks: 1, botClicks: 1 });
    expect(off.timeline.find((t: { date: string }) => t.date === '2026-09-10')).toMatchObject({
      clicks: 1,
    });
    await ctx.prisma.workspace.update({ where: { id: ws }, data: { filterBots: true } });
    expect((await get(c, A(ws, q(RANGE))).expect(200)).body.data.summary.clicks).toBe(1);
    expect(
      (await get(c, A(ws, q({ ...RANGE, includeBots: 'true' }))).expect(200)).body.data.summary
        .clicks,
    ).toBe(2);
  });

  it('an empty workspace returns zeros for the whole range, not an error', async () => {
    const { c, ws } = await setup();
    const d = (await get(c, A(ws, q(RANGE))).expect(200)).body.data;
    expect(d.summary).toEqual({
      clicks: 0,
      humanClicks: 0,
      botClicks: 0,
      uniqueVisitors: 0,
      qrScans: 0,
    });
    expect(d.timeline).toHaveLength(5);
    expect(d.countries).toEqual([]);
    expect(d.topLinks).toEqual([]);
  });

  it('defaults to the last 30 days ending today', async () => {
    const { c, ws } = await setup();
    const d = (await get(c, A(ws)).expect(200)).body.data;
    expect(d.timeline).toHaveLength(30);
    expect(d.meta.to).toBe(new Date().toISOString().slice(0, 10));
  });

  it('link-scoped analytics only count that link', async () => {
    const { c, ws, mkLink } = await setup();
    const a = await mkLink('alpha');
    const b = await mkLink('beta');
    await processor().process([ev(a.id, ws), ev(a.id, ws, { ip: '1.1.1.2' }), ev(b.id, ws)]);
    const d = (await get(c, A(ws, q(RANGE), `/links/${a.id}`)).expect(200)).body.data;
    expect(d.summary.clicks).toBe(2);
    expect(d.topLinks).toEqual([]);
    expect(
      (await get(c, A(ws, q({ ...RANGE, linkId: b.id }))).expect(200)).body.data.summary.clicks,
    ).toBe(1);
  });

  it('counts QR scans separately and names the QR codes', async () => {
    const { c, ws, mkLink } = await setup();
    const l = await mkLink('alpha');
    const qr = await ctx.prisma.qRCode.create({
      data: { workspaceId: ws, linkId: l.id, name: 'Poster' },
    });
    await processor().process([
      ev(l.id, ws, { qrId: qr.id }),
      ev(l.id, ws, { qrId: qr.id, ip: '1.1.1.2' }),
      ev(l.id, ws, { ip: '1.1.1.3' }),
    ]);
    const d = (await get(c, A(ws, q(RANGE))).expect(200)).body.data;
    expect(d.summary).toMatchObject({ clicks: 3, qrScans: 2 });
    expect(d.qrCodes).toEqual([{ value: qr.id, clicks: 2, name: 'Poster' }]);
  });
});

describe('timezones', () => {
  // 18:29Z = 23:59 IST (Oct 1 in India), 18:30Z = 00:00 IST next day.
  it('buckets the timeline by local day, exactly, at a +5:30 offset', async () => {
    const { c, ws, mkLink } = await setup();
    const l = await mkLink('alpha');
    await processor().process([
      ev(l.id, ws, { timestamp: Date.UTC(2026, 8, 10, 18, 29, 59), ip: '1.1.1.1' }),
      ev(l.id, ws, { timestamp: Date.UTC(2026, 8, 10, 18, 30, 0), ip: '1.1.1.2' }),
      ev(l.id, ws, { timestamp: Date.UTC(2026, 8, 10, 19, 0, 0), ip: '1.1.1.3' }),
    ]);
    const range = { from: '2026-09-10', to: '2026-09-11' };
    const utc = (await get(c, A(ws, q({ ...range, timezone: 'UTC' }))).expect(200)).body.data;
    expect(utc.timeline.map((t: { clicks: number }) => t.clicks)).toEqual([3, 0]);
    const ist = (await get(c, A(ws, q({ ...range, timezone: 'Asia/Kolkata' }))).expect(200)).body
      .data;
    expect(ist.timeline).toMatchObject([
      { date: '2026-09-10', clicks: 1 },
      { date: '2026-09-11', clicks: 2 },
    ]);
    expect(ist.summary.clicks).toBe(3);
    expect(ist.meta.notes.join(' ')).toMatch(/UTC day/);
  });

  it('handles a +5:45 offset (Nepal) and excludes events outside the local range', async () => {
    const { c, ws, mkLink } = await setup();
    const l = await mkLink('alpha');
    // Local Sep 10 in Kathmandu = 2026-09-09T18:15Z .. 2026-09-10T18:15Z
    await processor().process([
      ev(l.id, ws, { timestamp: Date.UTC(2026, 8, 9, 18, 14, 59), ip: '1.1.1.1' }), // Sep 9 local
      ev(l.id, ws, { timestamp: Date.UTC(2026, 8, 9, 18, 15, 0), ip: '1.1.1.2' }), // Sep 10 local
      ev(l.id, ws, { timestamp: Date.UTC(2026, 8, 10, 18, 14, 59), ip: '1.1.1.3' }), // Sep 10 local
      ev(l.id, ws, { timestamp: Date.UTC(2026, 8, 10, 18, 15, 0), ip: '1.1.1.4' }), // Sep 11 local
    ]);
    const d = (
      await get(
        c,
        A(ws, q({ from: '2026-09-10', to: '2026-09-10', timezone: 'Asia/Kathmandu' })),
      ).expect(200)
    ).body.data;
    expect(d.summary.clicks).toBe(2);
    expect(d.timeline).toEqual([{ date: '2026-09-10', clicks: 2, humanClicks: 2, botClicks: 0 }]);
  });

  it('supports hourly granularity in local time, with zero-filled hours', async () => {
    const { c, ws, mkLink } = await setup();
    const l = await mkLink('alpha');
    await processor().process([
      ev(l.id, ws, { timestamp: Date.UTC(2026, 8, 10, 3, 40) }),
      ev(l.id, ws, { timestamp: Date.UTC(2026, 8, 10, 3, 50), ip: '1.1.1.2' }),
    ]);
    const d = (
      await get(
        c,
        A(
          ws,
          q({
            from: '2026-09-10',
            to: '2026-09-10',
            timezone: 'Asia/Kolkata',
            granularity: 'hour',
          }),
        ),
      ).expect(200)
    ).body.data;
    expect(d.timeline).toHaveLength(24);
    expect(d.timeline.filter((t: { clicks: number }) => t.clicks > 0)).toEqual([
      { date: '2026-09-10T09:00', clicks: 2, humanClicks: 2, botClicks: 0 },
    ]); // 03:40Z = 09:10 IST
  });

  it('defaults to the workspace timezone', async () => {
    const { c, ws, mkLink } = await setup();
    const l = await mkLink('alpha');
    await processor().process([ev(l.id, ws, { timestamp: Date.UTC(2026, 8, 10, 19, 0) })]);
    await post(c, `/api/v1/workspaces/${ws}`, {}).catch(() => undefined);
    await c.agent
      .patch(`/api/v1/workspaces/${ws}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ timezone: 'Asia/Kolkata' })
      .expect(200);
    const d = (await get(c, A(ws, q({ from: '2026-09-10', to: '2026-09-11' }))).expect(200)).body
      .data;
    expect(d.meta.timezone).toBe('Asia/Kolkata');
    expect(d.timeline[1]).toMatchObject({ date: '2026-09-11', clicks: 1 });
  });
});

describe('country and device filters (event path)', () => {
  it('filters every figure consistently', async () => {
    const { c, ws, mkLink } = await setup();
    const l = await mkLink('alpha');
    await processor().process([
      ev(l.id, ws, { ip: '1.1.1.1', userAgent: IPHONE }),
      ev(l.id, ws, { ip: '1.1.1.2', userAgent: CHROME }),
      ev(l.id, ws, { ip: '2.2.2.2', userAgent: IPHONE }),
    ]);
    const india = (await get(c, A(ws, q({ ...RANGE, country: 'in' }))).expect(200)).body.data;
    expect(india.meta.source).toBe('events');
    expect(india.summary).toMatchObject({ clicks: 2, uniqueVisitors: 2 });
    expect(india.countries).toEqual([{ value: 'IN', clicks: 2 }]);
    expect(india.devices).toEqual(
      expect.arrayContaining([
        { value: 'MOBILE', clicks: 1 },
        { value: 'DESKTOP', clicks: 1 },
      ]),
    );
    expect(india.timeline[2]).toMatchObject({ date: '2026-09-10', clicks: 2 });
    const both = (await get(c, A(ws, q({ ...RANGE, country: 'IN', device: 'MOBILE' }))).expect(200))
      .body.data;
    expect(both.summary.clicks).toBe(1);
    expect(both.topLinks[0]).toMatchObject({ slug: 'alpha', clicks: 1 });
    expect(
      (await get(c, A(ws, q({ ...RANGE, device: 'TABLET' }))).expect(200)).body.data.summary.clicks,
    ).toBe(0);
  });

  it('limits filtered queries to 31 days', async () => {
    const { c, ws } = await setup();
    await get(c, A(ws, q({ from: '2026-08-01', to: '2026-09-12', country: 'IN' }))).expect(400);
    await get(c, A(ws, q({ from: '2026-08-01', to: '2026-09-12' }))).expect(200);
  });
});

describe('validation and abuse', () => {
  it.each([
    [{ from: '2026-09-12', to: '2026-09-01' }],
    [{ from: '2024-01-01', to: '2026-09-12' }],
    [{ from: '2026-09-01', to: '2026-09-30', granularity: 'hour' }],
    [{ from: '09/01/2026' }],
    [{ from: '2026-13-45' }],
    [{ timezone: 'Mars/Base' }],
    [{ timezone: 'UTC+3' }],
    [{ limit: '51' }],
    [{ country: 'USA' }],
    [{ device: 'WATCH' }],
    [{ granularity: 'minute' }],
  ])('rejects %j', async (params) => {
    const { c, ws } = await setup();
    await get(c, A(ws, q(params as Record<string, string>))).expect(400);
  });

  it('SQL-ish input stays data', async () => {
    const { c, ws } = await setup();
    await get(c, A(ws, q({ linkId: 'x\'; DROP TABLE "Link";--' }))).expect(404);
    expect(await ctx.prisma.link.count()).toBe(0);
  });
});

describe('database failures are not disguised as validation errors', () => {
  const query = (over: Record<string, string> = {}) =>
    analyticsQuery.parse({ from: '2026-09-01', to: '2026-09-02', ...over });
  const settings = { timezone: 'UTC', filterBots: false };

  it('a database error propagates as an error (a 5xx), not as "Unsupported timezone"', async () => {
    const flaky = new Proxy(ctx.prisma, {
      get(t, k) {
        if (k === '$queryRaw')
          return () => Promise.reject(new Error('Connection terminated unexpectedly'));
        return Reflect.get(t, k);
      },
    });
    const broken = { ...ctx, prisma: flaky as typeof ctx.prisma };
    await expect(queryAnalytics(broken, { workspaceId: 'w' }, query(), settings)).rejects.toThrow(
      'Connection terminated unexpectedly',
    );
  });

  it('a timezone PostgreSQL rejects is still reported as a validation error (bypassing the schema check)', async () => {
    const err = await queryAnalytics(
      ctx,
      { workspaceId: 'w' },
      { ...query(), timezone: 'Mars/Base' },
      settings,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Unsupported timezone' });
  });
});

describe('tenant isolation and roles', () => {
  it("never mixes in another workspace's data; foreign link/campaign filters are 404", async () => {
    const a = await setup();
    const b = await setup();
    const la = await a.mkLink('alpha');
    const lb = await b.mkLink('beta');
    const campB = await ctx.prisma.campaign.create({ data: { workspaceId: b.ws, name: 'B' } });
    await processor().process([
      ev(la.id, a.ws),
      ev(lb.id, b.ws),
      ev(lb.id, b.ws, { ip: '1.1.1.9' }),
    ]);
    const mine = (await get(a.c, A(a.ws, q(RANGE))).expect(200)).body.data;
    expect(mine.summary.clicks).toBe(1);
    expect(mine.topLinks.map((t: { slug: string }) => t.slug)).toEqual(['alpha']);
    await get(a.c, A(a.ws, q({ ...RANGE, linkId: lb.id }))).expect(404);
    await get(a.c, A(a.ws, q({ ...RANGE, campaignId: campB.id }))).expect(404);
    await get(a.c, A(a.ws, q(RANGE), `/links/${lb.id}`)).expect(404);
    await get(a.c, A(b.ws, q(RANGE))).expect(404); // not a member
    await get(a.c, A(b.ws, '/export')).expect(404);
  });

  it('viewers can read analytics but not export; members can export', async () => {
    const { c: owner, ws } = await setup();
    const [viewer, member] = [await registerUser(app), await registerUser(app)];
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
    await get(viewer, A(ws, q(RANGE))).expect(200);
    await get(viewer, A(ws, q(RANGE), '/links/none')).expect(404);
    await get(viewer, A(ws, '/export' + q(RANGE))).expect(403);
    await get(member, A(ws, '/export' + q(RANGE))).expect(200);
  });
});

describe('CSV export', () => {
  const parse = (csv: string) =>
    csv
      .trim()
      .split('\r\n')
      .map((l) => l.split(','));

  it('daily export: headers, attachment, rows, bot filter', async () => {
    const { c, ws, mkLink } = await setup();
    const l = await mkLink('alpha');
    await processor().process([
      ev(l.id, ws),
      ev(l.id, ws, { ip: '1.1.1.2', userAgent: IPHONE }),
      ev(l.id, ws, { ip: '1.1.1.3', userAgent: BOT }),
    ]);
    const res = await get(c, A(ws, '/export' + q(RANGE))).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="analytics-daily-2026-09-08_2026-09-12.csv"',
    );
    const rows = parse(res.text);
    expect(rows[0]).toEqual([
      'date_utc',
      'link_id',
      'hostname',
      'slug',
      'is_bot',
      'clicks',
      'unique_visitors',
      'mobile_clicks',
      'desktop_clicks',
      'tablet_clicks',
    ]);
    expect(rows.slice(1).map((r) => [r[0], r[3], r[4], r[5]])).toEqual([
      ['2026-09-10', 'alpha', 'false', '2'],
      ['2026-09-10', 'alpha', 'true', '1'],
    ]);
    const human = parse(
      (await get(c, A(ws, '/export' + q({ ...RANGE, includeBots: 'false' }))).expect(200)).text,
    );
    expect(human).toHaveLength(2);
    // link-scoped route
    expect(
      parse((await get(c, A(ws, '/export' + q(RANGE), `/links/${l.id}`)).expect(200)).text),
    ).toHaveLength(3);
  });

  it('events export contains no IPs or visitor hashes and neutralizes formula injection', async () => {
    const { c, ws, mkLink } = await setup();
    const l = await mkLink('alpha', { utmSource: '=HYPERLINK("http://evil","x")' });
    await processor().process([
      ev(l.id, ws, { ip: '203.0.113.77', referer: 'https://news.example/a?token=zzz' }),
    ]);
    const text = (await get(c, A(ws, '/export' + q({ ...RANGE, type: 'events' }))).expect(200))
      .text;
    expect(text).not.toMatch(/203\.0\.113\.77|zzz|visitor|ip_hash/i);
    expect(text.split('\r\n')[0]).not.toMatch(/ip|hash/);
    expect(text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(text).toContain('news.example');
  });

  it('streams more than one batch with identical timestamps, without gaps or duplicates (keyset pagination)', async () => {
    const { c, ws, mkLink } = await setup();
    const l = await mkLink('alpha');
    const total = 5200;
    await ctx.prisma.clickEvent.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        id: `ce-${String(i).padStart(5, '0')}`,
        workspaceId: ws,
        linkId: l.id,
        timestamp: new Date(Date.UTC(2026, 8, 10, 12, 0, i % 3)),
        visitorHash: 'v',
        city: `c${i}`,
        device: 'DESKTOP' as const,
      })),
    });
    const text = (await get(c, A(ws, '/export' + q({ ...RANGE, type: 'events' }))).expect(200))
      .text;
    const rows = text.trim().split('\r\n').slice(1);
    expect(rows).toHaveLength(total);
    // Every event appears exactly once: city is unique per row, so no gaps and no duplicates.
    const cities = rows.map((r) => r.split(',')[6]);
    expect(new Set(cities).size).toBe(total);
    expect(cities.every((v) => /^c\d+$/.test(v!))).toBe(true);
    const stamps = rows.map((r) => r.split(',')[0]!);
    expect([...stamps].sort()).toEqual(stamps); // ordered
  });

  it('rate limits exports per workspace', async () => {
    const { c, ws } = await setup();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await get(c, A(ws, '/export' + q(RANGE)))).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('csvCell escapes quotes/commas/newlines and defuses formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    for (const f of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx'])
      expect(csvCell(f).replace(/^"/, '')).toMatch(/^'/);
    expect(csvCell(null)).toBe('');
    expect(csvCell(false)).toBe('false');
    expect(csvCell(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00.000Z');
  });
});

void (null as unknown as Client);

describe('unique visitors never exceed clicks', () => {
  it('is clamped when UTC-day uniques overlap a non-UTC range edge', async () => {
    const { c, ws, mkLink } = await setup();
    const l = await mkLink('alpha');
    // Two visitors on UTC Sep 10; in Pacific/Auckland (UTC+12) only the second falls on local Sep 10.
    await processor().process([
      ev(l.id, ws, { timestamp: Date.UTC(2026, 8, 10, 0, 30), ip: '1.1.1.1' }), // local Sep 10, 12:30 (inside)
      ev(l.id, ws, { timestamp: Date.UTC(2026, 8, 9, 23, 30), ip: '1.1.1.2' }), // local Sep 10, 11:30 (inside)
      ev(l.id, ws, { timestamp: Date.UTC(2026, 8, 10, 23, 30), ip: '1.1.1.3' }), // local Sep 11, 11:30 (outside)
      ev(l.id, ws, { timestamp: Date.UTC(2026, 8, 10, 23, 40), ip: '1.1.1.4' }), // local Sep 11 (outside)
    ]);
    const d = (
      await get(
        c,
        A(ws, q({ from: '2026-09-10', to: '2026-09-10', timezone: 'Pacific/Auckland' })),
      ).expect(200)
    ).body.data;
    expect(d.summary.clicks).toBe(2);
    expect(d.summary.uniqueVisitors).toBeLessThanOrEqual(d.summary.clicks);
  });
});
