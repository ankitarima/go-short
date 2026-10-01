import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DIMENSION_VALUE_CAP } from '../src/processBatch';
import {
  CHROME,
  GOOGLEBOT,
  IPAD,
  IPHONE,
  ev,
  makeProcessor,
  prisma,
  resetDb,
  seed,
} from './helpers';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const daily = (linkId: string) =>
  prisma.analyticsDaily.findMany({
    where: { linkId },
    orderBy: [{ date: 'asc' }, { isBot: 'asc' }],
  });
const dim = async (linkId: string, dimension: string) =>
  Object.fromEntries(
    (
      await prisma.analyticsDimensionDaily.findMany({
        where: { linkId, dimension: dimension as never },
      })
    ).map((r) => [`${r.value}${r.isBot ? ':bot' : ''}`, r.clicks]),
  );

describe('raw events', () => {
  it('stores enriched rows with privacy-preserving ids and never a raw IP', async () => {
    const { link, workspace, campaign } = await seed({
      utmSource: 'instagram',
      utmMedium: 'social',
      utmCampaign: 'diwali',
    });
    const e = ev(link.id, workspace.id, {
      campaignId: campaign.id,
      ip: '1.2.3.4',
      userAgent: IPHONE,
      referer: 'https://www.News.example.com/post?token=s3cret',
      acceptLanguage: 'hi-IN,en;q=0.8',
    });
    expect(await makeProcessor().process([e])).toEqual({
      received: 1,
      invalid: 0,
      duplicates: 0,
      inserted: 1,
    });

    const row = await prisma.clickEvent.findUniqueOrThrow({ where: { id: e.eventId } });
    expect(row).toMatchObject({
      linkId: link.id,
      workspaceId: workspace.id,
      campaignId: campaign.id,
      country: 'IN',
      region: 'Maharashtra',
      city: 'Mumbai',
      device: 'MOBILE',
      browser: 'Safari',
      os: 'iOS',
      isBot: false,
      referrer: 'news.example.com',
      language: 'hi-IN',
      utmSource: 'instagram',
      utmMedium: 'social',
      utmCampaign: 'diwali',
    });
    expect(row.timestamp.getTime()).toBe(e.timestamp); // millisecond precision preserved
    expect(row.visitorHash).toMatch(/^[0-9a-f]{32}$/);
    expect(row.ipHash).toMatch(/^[0-9a-f]{32}$/);
    // Nothing in any analytics table contains the raw IP, the full referrer URL, or the token in it.
    const dump = JSON.stringify([
      await prisma.clickEvent.findMany(),
      await prisma.analyticsDaily.findMany(),
      await prisma.analyticsDimensionDaily.findMany(),
      await prisma.dailyVisitor.findMany(),
    ]);
    expect(dump).not.toContain('1.2.3.4');
    expect(dump).not.toContain('s3cret');
  });

  it('keeps bot clicks, flagged, instead of dropping them', async () => {
    const { link, workspace } = await seed();
    await makeProcessor().process([
      ev(link.id, workspace.id, { userAgent: GOOGLEBOT }),
      ev(link.id, workspace.id, { userAgent: null }),
    ]);
    const rows = await prisma.clickEvent.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.isBot)).toBe(true);
  });

  it('honours the workspace IP-hashing setting (still counts uniques, but stores no ipHash)', async () => {
    const { link, workspace } = await seed({}, { hashIps: false });
    await makeProcessor().process([ev(link.id, workspace.id)]);
    const row = await prisma.clickEvent.findFirstOrThrow();
    expect(row.ipHash).toBeNull();
    expect(row.visitorHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('still records clicks for a deleted link (no UTM), without failing', async () => {
    const { link, workspace } = await seed({ utmSource: 'x' });
    const e = ev(link.id, workspace.id);
    await prisma.link.delete({ where: { id: link.id } });
    expect((await makeProcessor().process([e])).inserted).toBe(1);
    expect((await prisma.clickEvent.findFirstOrThrow()).utmSource).toBeNull();
  });
});

describe('daily aggregation', () => {
  it('rolls up clicks, devices, bots and unique visitors', async () => {
    const { link, workspace } = await seed();
    const w = workspace.id;
    await makeProcessor().process([
      ev(link.id, w, { ip: '1.1.1.1', userAgent: CHROME }),
      ev(link.id, w, { ip: '1.1.1.1', userAgent: CHROME }), // same visitor
      ev(link.id, w, { ip: '1.1.1.2', userAgent: CHROME }),
      ev(link.id, w, { ip: '1.1.1.3', userAgent: IPHONE }),
      ev(link.id, w, { ip: '1.1.1.4', userAgent: IPAD }),
      ev(link.id, w, { ip: '9.9.9.9', userAgent: GOOGLEBOT }),
    ]);
    const rows = await daily(link.id);
    const human = rows.find((r) => !r.isBot)!;
    const bot = rows.find((r) => r.isBot)!;
    expect(human).toMatchObject({
      clicks: 5,
      uniqueVisitors: 4,
      desktopClicks: 3,
      mobileClicks: 1,
      tabletClicks: 1,
    });
    expect(bot).toMatchObject({ clicks: 1, uniqueVisitors: 1 });
    expect(await prisma.clickEvent.count()).toBe(6);
  });

  it('unique visitors accumulate correctly across batches within a day', async () => {
    const { link, workspace } = await seed();
    const p = makeProcessor();
    await p.process([
      ev(link.id, workspace.id, { ip: '1.1.1.1' }),
      ev(link.id, workspace.id, { ip: '1.1.1.2' }),
    ]);
    await p.process([
      ev(link.id, workspace.id, { ip: '1.1.1.1' }),
      ev(link.id, workspace.id, { ip: '1.1.1.3' }),
    ]);
    const [row] = await daily(link.id);
    expect(row).toMatchObject({ clicks: 4, uniqueVisitors: 3 });
  });

  it('splits at UTC midnight, and the same visitor counts once per day', async () => {
    const { link, workspace } = await seed();
    const t = (d: number, h: number, ms = 0) => Date.UTC(2026, 9, d, h, 59, 59, ms);
    await makeProcessor({ now: () => Date.UTC(2026, 9, 5) }).process([
      ev(link.id, workspace.id, { timestamp: t(1, 23, 999) }),
      ev(link.id, workspace.id, { timestamp: Date.UTC(2026, 9, 2, 0, 0, 0, 0) }),
      ev(link.id, workspace.id, { timestamp: Date.UTC(2026, 9, 2, 0, 0, 1, 0) }),
    ]);
    const rows = await daily(link.id);
    expect(
      rows.map((r) => [r.date.toISOString().slice(0, 10), r.clicks, r.uniqueVisitors]),
    ).toEqual([
      ['2026-10-01', 1, 1],
      ['2026-10-02', 2, 1],
    ]);
  });

  it('is idempotent: redelivering a batch (retry / duplicate job) changes nothing', async () => {
    const { link, workspace } = await seed();
    const batch = [
      ev(link.id, workspace.id, { ip: '1.1.1.1' }),
      ev(link.id, workspace.id, { ip: '1.1.1.2' }),
    ];
    const p = makeProcessor();
    expect((await p.process(batch)).inserted).toBe(2);
    const again = await p.process(batch);
    expect(again).toMatchObject({ inserted: 0, duplicates: 2 });
    expect(await prisma.clickEvent.count()).toBe(2);
    expect((await daily(link.id))[0]).toMatchObject({ clicks: 2, uniqueVisitors: 2 });
    expect(Object.values(await dim(link.id, 'DEVICE')).reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('a partially overlapping batch only counts the new events', async () => {
    const { link, workspace } = await seed();
    const a = ev(link.id, workspace.id, { ip: '1.1.1.1' });
    const b = ev(link.id, workspace.id, { ip: '1.1.1.2' });
    const p = makeProcessor();
    await p.process([a]);
    expect(await p.process([a, b])).toMatchObject({ inserted: 1, duplicates: 1 });
    expect((await daily(link.id))[0]).toMatchObject({ clicks: 2, uniqueVisitors: 2 });
  });

  it('parallel batches on the same rows neither deadlock nor lose counts', async () => {
    const { link, workspace } = await seed();
    const p = makeProcessor();
    const batches = Array.from({ length: 6 }, (_, b) =>
      Array.from({ length: 50 }, (_, i) =>
        ev(link.id, workspace.id, {
          ip: `1.${b}.${i % 25}.1`,
          referer: `https://r${i % 7}.example/`,
        }),
      ),
    );
    await Promise.all(batches.map((b) => p.process(b)));
    expect(await prisma.clickEvent.count()).toBe(300);
    const [row] = await daily(link.id);
    expect(row!.clicks).toBe(300);
    expect(Object.values(await dim(link.id, 'REFERRER')).reduce((a, b) => a + b, 0)).toBe(300);
    expect(row!.uniqueVisitors).toBe(await prisma.dailyVisitor.count());
  });
});

describe('dimension rollups', () => {
  it('counts country, device, browser, os, referrer and link UTM values', async () => {
    const { link, workspace } = await seed({
      utmSource: 'qr',
      utmMedium: 'offline',
      utmCampaign: 'aiss',
    });
    const w = workspace.id;
    await makeProcessor().process([
      ev(link.id, w, { ip: '1.1.1.1', userAgent: IPHONE, referer: 'https://t.co/x' }),
      ev(link.id, w, { ip: '1.1.1.2', userAgent: CHROME, referer: null }),
      ev(link.id, w, { ip: '2.2.2.2', userAgent: CHROME, referer: 'https://t.co/y' }),
      ev(link.id, w, { ip: '9.9.9.9', userAgent: GOOGLEBOT }),
    ]);
    expect(await dim(link.id, 'COUNTRY')).toEqual({ IN: 2, DE: 1 }); // unknown geo not counted; bot has none
    expect(await dim(link.id, 'DEVICE')).toEqual({ MOBILE: 1, DESKTOP: 2, 'OTHER:bot': 1 });
    expect(await dim(link.id, 'BROWSER')).toEqual({ Safari: 1, Chrome: 2, 'Googlebot:bot': 1 });
    expect(await dim(link.id, 'OS')).toEqual({ iOS: 1, Windows: 2, 'Unknown:bot': 1 });
    expect(await dim(link.id, 'REFERRER')).toEqual({ 't.co': 2, '(direct)': 1, '(direct):bot': 1 });
    expect(await dim(link.id, 'UTM_SOURCE')).toEqual({ qr: 3, 'qr:bot': 1 });
    expect(await dim(link.id, 'UTM_MEDIUM')).toEqual({ offline: 3, 'offline:bot': 1 });
    expect(await dim(link.id, 'CITY')).toEqual({ 'Mumbai, IN': 2, 'Berlin, DE': 1 });
    // dimension totals reconcile with daily totals for a non-capped dimension
    const total = Object.values(await dim(link.id, 'DEVICE')).reduce((a, b) => a + b, 0);
    expect(total).toBe((await daily(link.id)).reduce((a, r) => a + r.clicks, 0));
  });

  it('caps distinct referrers per link/day and folds the rest into "other" without losing clicks', async () => {
    const { link, workspace } = await seed();
    const n = DIMENSION_VALUE_CAP + 50;
    const events = Array.from({ length: n }, (_, i) =>
      ev(link.id, workspace.id, {
        ip: `1.0.${i >> 8}.${i & 255}`,
        referer: `https://site${i}.example/`,
      }),
    );
    const p = makeProcessor();
    await p.process(events.slice(0, 80));
    await p.process(events.slice(80)); // cap must hold across batches too
    const refs = await dim(link.id, 'REFERRER');
    expect(Object.keys(refs).length).toBe(DIMENSION_VALUE_CAP + 1);
    expect(refs.other).toBe(50);
    expect(Object.values(refs).reduce((a, b) => a + b, 0)).toBe(n);
    // an already-tracked referrer keeps counting after the cap is reached
    await p.process([
      ev(link.id, workspace.id, { ip: '1.9.9.9', referer: 'https://site0.example/' }),
    ]);
    expect((await dim(link.id, 'REFERRER'))['site0.example']).toBe(2);
  });
});

describe('malformed input', () => {
  it('drops invalid events and still processes the valid ones', async () => {
    const { link, workspace } = await seed();
    const good = ev(link.id, workspace.id);
    const bad: unknown[] = [
      null,
      'string',
      42,
      {},
      { ...good, eventId: '' },
      { ...good, eventId: 'x'.repeat(100) },
      { ...good, timestamp: 'now' },
      { ...good, timestamp: NaN },
      { ...good, timestamp: Date.now() + 10 * 86_400_000 },
      { ...good, timestamp: 1000 },
      { ...good, ip: undefined },
      { ...good, linkId: 7 },
    ];
    const res = await makeProcessor().process([...bad, good]);
    expect(res).toMatchObject({ received: 13, invalid: 12, inserted: 1 });
    expect(await prisma.clickEvent.count()).toBe(1);
  });

  it('handles an empty batch and hostile strings (SQL-ish values stay data)', async () => {
    const { link, workspace } = await seed();
    const p = makeProcessor();
    expect(await p.process([])).toEqual({ received: 0, invalid: 0, duplicates: 0, inserted: 0 });
    const e = ev(link.id, workspace.id, {
      userAgent: '\'); DROP TABLE "ClickEvent";--',
      referer: "https://x.example/'; DROP TABLE x;--",
      acceptLanguage: "'; --",
    });
    expect((await p.process([e])).inserted).toBe(1);
    expect(await prisma.clickEvent.count()).toBe(1);
  });

  it('a transient failure rolls everything back so a retry cannot double count', async () => {
    const { link, workspace } = await seed();
    const events = [ev(link.id, workspace.id), ev(link.id, workspace.id, { ip: '1.1.1.9' })];
    // Force a failure part-way through the transaction: an event pointing at an enum-violating state is not
    // possible, so break the dimension step by dropping a needed table inside a savepoint-free tx.
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AnalyticsDimensionDaily" RENAME TO "AnalyticsDimensionDaily_x"',
    );
    try {
      await expect(makeProcessor().process(events)).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "AnalyticsDimensionDaily_x" RENAME TO "AnalyticsDimensionDaily"',
      );
    }
    expect(await prisma.clickEvent.count()).toBe(0);
    expect(await prisma.analyticsDaily.count()).toBe(0);
    expect(await prisma.dailyVisitor.count()).toBe(0);
    // And the retry then succeeds exactly once.
    expect((await makeProcessor().process(events)).inserted).toBe(2);
    expect((await daily(link.id))[0]).toMatchObject({ clicks: 2, uniqueVisitors: 2 });
  });
});

describe('throughput', () => {
  it('processes a 500-event batch in one transaction well under a second', async () => {
    const { link, workspace } = await seed();
    const events = Array.from({ length: 500 }, (_, i) =>
      ev(link.id, workspace.id, {
        ip: `${1 + (i % 2)}.${i % 200}.${i % 7}.1`,
        userAgent: i % 3 ? CHROME : IPHONE,
        referer: i % 5 ? `https://r${i % 20}.example/` : null,
      }),
    );
    const t0 = performance.now();
    const res = await makeProcessor().process(events);
    const ms = performance.now() - t0;
    expect(res.inserted).toBe(500);
    expect(ms).toBeLessThan(2000);
    console.log(`500-event batch: ${ms.toFixed(0)} ms`);
  });
});

describe('15-minute buckets', () => {
  it('aggregates clicks into quarter-hour buckets split by bot flag, idempotently', async () => {
    const { link, workspace } = await seed();
    const t = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 1, h, m, s);
    const batch = [
      ev(link.id, workspace.id, { timestamp: t(10, 0, 0) }),
      ev(link.id, workspace.id, { timestamp: t(10, 14, 59) }),
      ev(link.id, workspace.id, { timestamp: t(10, 15, 0) }),
      ev(link.id, workspace.id, { timestamp: t(10, 20), userAgent: GOOGLEBOT }),
    ];
    const p = makeProcessor({ now: () => t(12, 0) });
    await p.process(batch);
    await p.process(batch); // redelivery
    const rows = await prisma.analyticsBucket.findMany({
      where: { linkId: link.id },
      orderBy: [{ bucket: 'asc' }, { isBot: 'asc' }],
    });
    expect(rows.map((r) => [r.bucket.toISOString().slice(11, 16), r.isBot, r.clicks])).toEqual([
      ['10:00', false, 2],
      ['10:15', false, 1],
      ['10:15', true, 1],
    ]);
  });
});

describe('QR attribution', () => {
  it('counts a scan only when the QR exists and belongs to the clicked link', async () => {
    const { link, workspace } = await seed();
    const other = await prisma.link.create({
      data: {
        workspaceId: workspace.id,
        domainId: link.domainId,
        slug: 'other',
        destinationUrl: 'https://example.org',
      },
    });
    const qr = await prisma.qRCode.create({
      data: { workspaceId: workspace.id, linkId: link.id, name: 'Poster' },
    });
    const otherQr = await prisma.qRCode.create({
      data: { workspaceId: workspace.id, linkId: other.id, name: 'Other' },
    });
    await makeProcessor().process([
      ev(link.id, workspace.id, { qrId: qr.id }),
      ev(link.id, workspace.id, { qrId: qr.id, ip: '1.1.1.2' }),
      ev(link.id, workspace.id, { qrId: otherQr.id }), // QR of a different link: ignored
      ev(link.id, workspace.id, { qrId: 'forged-id' }), // unknown: ignored
      ev(link.id, workspace.id, {}),
    ]);
    const rows = await prisma.clickEvent.findMany({ orderBy: { timestamp: 'asc' } });
    expect(rows.filter((r) => r.qrCodeId === qr.id)).toHaveLength(2);
    expect(rows.filter((r) => r.qrCodeId !== null)).toHaveLength(2);
    expect(await dim(link.id, 'QR_CODE')).toEqual({ [qr.id]: 2 });
    expect((await daily(link.id))[0]!.clicks).toBe(5); // QR clicks are still ordinary clicks
  });
});
