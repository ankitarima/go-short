import type { Server } from 'node:http';
import { loadConfig } from '@go-short/config';
import { getPrisma } from '@go-short/database';
import { ANALYTICS_JOB_OPTIONS, QUEUES, type AnalyticsBatch } from '@go-short/shared';
import { Queue, Worker } from 'bullmq';
import { Redis, type RedisOptions } from 'ioredis';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BullmqPublisher } from '../apps/redirect/src/bullPublisher';
import { createRedirectServer } from '../apps/redirect/src/handler';
import { Hasher } from '../apps/worker/src/enrich';
import type { GeoLookup } from '../apps/worker/src/geo';
import { BatchProcessor } from '../apps/worker/src/processBatch';
import { createAnalyticsWorker } from '../apps/worker/src/worker';

const HOST = 'localhost:4001';
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const prisma = getPrisma();
const logger = pino({ level: 'silent' });
const geo: GeoLookup = { lookup: () => ({ country: 'IN', region: 'Maharashtra', city: 'Mumbai' }) };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => Promise<T | false | undefined>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await sleep(50);
  }
}

const redisUrl = process.env.REDIS_URL!;
const open: Array<{ close: () => Promise<unknown> }> = [];
const track = <T extends { close: () => Promise<unknown> }>(x: T): T => (open.push(x), x);
const conns: Redis[] = [];
const conn = (opts: RedisOptions = {}) => {
  const r = new Redis(redisUrl, opts);
  r.on('error', () => undefined);
  conns.push(r);
  return r;
};

function startWorker(concurrency = 2) {
  const processor = new BatchProcessor({
    prisma,
    logger,
    geo,
    hasher: new Hasher('test-secret-test-secret-test-secret-1'),
  });
  return track(
    createAnalyticsWorker({
      connection: conn({ maxRetriesPerRequest: null }),
      processor,
      concurrency,
      logger,
    }),
  );
}

function startRedirect(flushMs = 20) {
  const queue = track(
    new Queue<AnalyticsBatch>(QUEUES.analyticsEvents, {
      connection: conn({ enableOfflineQueue: false, maxRetriesPerRequest: 1 }),
    }),
  );
  const publisher = new BullmqPublisher({
    queue,
    logger,
    flushMs,
    batchMax: 500,
    bufferMax: 20_000,
  });
  const server: Server = createRedirectServer({
    config: loadConfig(),
    prisma,
    redis: conn({ enableOfflineQueue: false, maxRetriesPerRequest: 1 }),
    logger,
    publisher,
  });
  return { server, publisher, queue };
}

async function seedLink(extra: Record<string, unknown> = {}) {
  const user = await prisma.user.create({
    data: { email: `p${Math.random()}@example.com`, name: 'p', passwordHash: 'x' },
  });
  const ws = await prisma.workspace.create({
    data: {
      name: 'P',
      slug: `p-${Math.random().toString(36).slice(2, 8)}`,
      members: { create: { userId: user.id, role: 'OWNER' } },
    },
  });
  const domain = await prisma.domain.findFirstOrThrow({ where: { hostname: HOST } });
  const campaign = await prisma.campaign.create({ data: { workspaceId: ws.id, name: 'Camp' } });
  const link = await prisma.link.create({
    data: {
      workspaceId: ws.id,
      domainId: domain.id,
      slug: 'pipe',
      destinationUrl: 'https://example.org/landing',
      campaignId: campaign.id,
      utmSource: 'qr',
      ...extra,
    },
  });
  return { ws, link, campaign };
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "User","Workspace","Domain","ClickEvent","AnalyticsDaily","AnalyticsDimensionDaily","DailyVisitor","AnalyticsBucket" CASCADE',
  );
  const r = conn();
  await r.flushdb();
  await prisma.domain.create({
    data: {
      hostname: HOST,
      workspaceId: null,
      status: 'VERIFIED',
      isVerified: true,
      isDefault: true,
      verificationToken: 'shared',
    },
  });
});

afterEach(async () => {
  for (const x of open.splice(0)) await x.close().catch(() => undefined);
  for (const r of conns.splice(0)) r.disconnect();
});
afterAll(() => prisma.$disconnect());

const hit = (server: Server, ua = CHROME, extra: Record<string, string> = {}) => {
  let req = request(server).get('/pipe').set('Host', HOST).set('User-Agent', ua).redirects(0);
  for (const [k, v] of Object.entries(extra)) req = req.set(k, v);
  return req;
};

describe('redirect -> BullMQ -> worker -> Postgres', () => {
  it('does not keep finished jobs: raw IPs leave the queue as soon as the batch is stored', async () => {
    await seedLink();
    startWorker();
    const { server } = startRedirect();
    const IP = '198.51.100.77';
    expect((await hit(server, CHROME, { 'X-Forwarded-For': IP })).status).toBe(302);
    await waitFor(() => prisma.clickEvent.findFirst());

    const r = conn();
    await waitFor(async () => (await r.zcard('bull:analytics-events:completed')) === 0);
    // No key anywhere in Valkey may still contain the client address (job data lives in hashes).
    const leaks: string[] = [];
    for (const key of await r.keys('bull:*')) {
      if ((await r.type(key)) !== 'hash') continue;
      const fields = Object.values(await r.hgetall(key));
      if (fields.some((v) => v.includes(IP))) leaks.push(key);
    }
    expect(leaks).toEqual([]);
  });

  it('a click becomes an enriched raw event and a daily rollup, end to end', async () => {
    const { ws, link, campaign } = await seedLink();
    startWorker();
    const { server, publisher } = startRedirect();

    const res = await hit(server, IPHONE, {
      Referer: 'https://www.news.example/post?secret=1',
      'Accept-Language': 'en-IN,en;q=0.9',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.org/landing?utm_source=qr');

    const row = await waitFor(() => prisma.clickEvent.findFirst());
    expect(row).toMatchObject({
      linkId: link.id,
      workspaceId: ws.id,
      campaignId: campaign.id,
      device: 'MOBILE',
      browser: 'Safari',
      os: 'iOS',
      isBot: false,
      referrer: 'news.example',
      language: 'en-IN',
      country: 'IN',
      utmSource: 'qr',
    });
    const daily = await waitFor(() =>
      prisma.analyticsDaily.findFirst({ where: { linkId: link.id } }),
    );
    expect(daily).toMatchObject({
      clicks: 1,
      uniqueVisitors: 1,
      mobileClicks: 1,
      isBot: false,
      campaignId: campaign.id,
    });
    expect(publisher.pending).toBe(0);
    // Redirect-time identifiers never reached the database in raw form.
    const dump = JSON.stringify(await prisma.clickEvent.findMany());
    expect(dump).not.toMatch(/127\.0\.0\.1|::1|secret=1/);
  });

  it('many clicks (humans, repeat visitors, bots) roll up consistently', async () => {
    const { link } = await seedLink();
    startWorker(4);
    const { server } = startRedirect();
    const uas = [CHROME, IPHONE, GOOGLEBOT];
    const N = 150;
    for (let wave = 0; wave < N / 30; wave++) {
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => hit(server, uas[(wave * 30 + i) % 3])),
      );
      expect(results.every((r) => r.status === 302)).toBe(true);
    }
    await waitFor(async () => (await prisma.clickEvent.count()) === N);
    const rows = await prisma.analyticsDaily.findMany({ where: { linkId: link.id } });
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
    expect(sum((r) => r.clicks)).toBe(N);
    expect(rows.find((r) => r.isBot)!.clicks).toBe(50); // every third request was Googlebot
    expect(sum((r) => r.mobileClicks)).toBe(50);
    expect(sum((r) => r.desktopClicks)).toBe(50);
    // All clicks came from one IP, so each (UA) is a single approximate visitor.
    expect(sum((r) => r.uniqueVisitors)).toBe(3);
  });

  it('redirects keep working while the worker is down; the backlog is processed when it returns', async () => {
    await seedLink();
    const { server, publisher, queue } = startRedirect();
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) statuses.push((await hit(server)).status);
    expect(statuses.every((s) => s === 302)).toBe(true);
    await waitFor(async () => (await queue.getWaitingCount()) > 0 && publisher.pending === 0);
    expect(await prisma.clickEvent.count()).toBe(0); // nothing consumed yet: no worker

    startWorker();
    await waitFor(async () => (await prisma.clickEvent.count()) === 40);
    expect((await prisma.analyticsDaily.findFirstOrThrow()).clicks).toBe(40);
  });

  it('a redelivered job (same events, new job id) is not double counted', async () => {
    await seedLink();
    // Enqueue first, with no worker yet, so the batch can be copied while it is still in the queue
    // (finished jobs are deleted immediately).
    const { server, queue, publisher } = startRedirect();
    for (let i = 0; i < 5; i++) await hit(server);
    await publisher.flush();
    const [waiting] = await waitFor(async () => {
      const jobs = await queue.getWaiting();
      return jobs.length ? jobs : false;
    });
    const batch = structuredClone(waiting!.data);

    const w = startWorker();
    await waitFor(async () => (await prisma.clickEvent.count()) === 5);
    await queue.add(
      'batch',
      { ...batch, batchId: 'replay' },
      { ...ANALYTICS_JOB_OPTIONS, jobId: 'replay' },
    );
    // The replay is processed and removed; a job that vanished without failing was handled.
    await waitFor(async () => (await queue.getJob('replay')) === undefined);
    expect(await queue.getFailedCount()).toBe(0);
    expect(await prisma.clickEvent.count()).toBe(5);
    expect((await prisma.analyticsDaily.findFirstOrThrow()).clicks).toBe(5);
    await w.close();
  });

  it('malformed events inside a real job are dropped without failing the job', async () => {
    const { link, ws } = await seedLink();
    startWorker();
    const { queue } = startRedirect();
    const good = {
      eventId: 'good-1',
      linkId: link.id,
      workspaceId: ws.id,
      campaignId: null,
      timestamp: Date.now(),
      ip: '1.1.1.1',
      userAgent: CHROME,
      referer: null,
      acceptLanguage: null,
      forwardedFor: null,
    };
    await queue.add(
      'batch',
      { batchId: 'mixed', events: [null, { nope: 1 }, good] as never },
      { ...ANALYTICS_JOB_OPTIONS, jobId: 'mixed' },
    );
    await waitFor(async () => (await prisma.clickEvent.count()) === 1);
    await waitFor(async () => (await queue.getJob('mixed')) === undefined); // finished and removed
    expect(await queue.getFailedCount()).toBe(0);
    expect(await prisma.clickEvent.count()).toBe(1);
  });

  it('a job that keeps failing is retried a bounded number of times, then retained for inspection', async () => {
    const queue = track(new Queue<AnalyticsBatch>(QUEUES.analyticsEvents, { connection: conn() }));
    let calls = 0;
    track(
      new Worker<AnalyticsBatch>(
        QUEUES.analyticsEvents,
        async () => {
          calls++;
          throw new Error('boom: database unavailable');
        },
        { connection: conn({ maxRetriesPerRequest: null }) },
      ),
    );
    // The production options, with a short backoff so the test is quick.
    await queue.add(
      'batch',
      { batchId: 'dead', events: [] },
      {
        ...ANALYTICS_JOB_OPTIONS,
        attempts: 3,
        backoff: { type: 'exponential', delay: 20 },
        jobId: 'dead',
      },
    );
    await waitFor(async () => (await queue.getFailedCount()) === 1);
    await sleep(200);
    expect(calls).toBe(3); // not retried forever
    const [failed] = await queue.getFailed();
    expect(failed).toMatchObject({ attemptsMade: 3, failedReason: 'boom: database unavailable' });
    expect(ANALYTICS_JOB_OPTIONS.removeOnFail.age).toBeGreaterThanOrEqual(7 * 24 * 3600); // kept long enough to inspect
    expect(await queue.getFailedCount()).toBe(1); // still there, not auto-removed
  });
});
