import { type IncomingHttpHeaders, type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  QUEUES,
  WEBHOOK_JOB_OPTIONS,
  type WebhookJob,
  sealSecret,
  verifyWebhookSignature,
} from '@go-short/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DeliveryDeps, createWebhookWorker, deliverWebhook } from '../src/webhooks';
import { prisma, resetDb, seed } from './helpers';

const MASTER = 'webhook-test-master-webhook-test-master-1';
const SECRET = 'whsec_plain_secret_value';

interface Hit {
  path: string;
  method: string;
  headers: IncomingHttpHeaders;
  body: string;
}
let server: Server;
let hits: Hit[] = [];
let handler: (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  body: string,
) => void;
let port: number;

beforeEach(async () => {
  await resetDb();
  hits = [];
  handler = (_req, res) => res.writeHead(200).end('ok');
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      hits.push({ path: req.url ?? '', method: req.method ?? '', headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});
afterAll(() => prisma.$disconnect());

const deps = (over: Partial<DeliveryDeps> = {}): DeliveryDeps => ({
  prisma,
  logger: pino({ level: 'silent' }),
  masterSecret: MASTER,
  allowInsecure: true,
  timeoutMs: 2000,
  ...over,
});

async function hook(url: string, over: Record<string, unknown> = {}) {
  const { workspace } = await seed();
  const row = await prisma.webhook.create({
    data: {
      workspaceId: workspace.id,
      url,
      secret: sealSecret(SECRET, MASTER),
      events: ['link.created', 'link.updated'],
      ...over,
    },
  });
  return { row, workspace };
}
const job = (
  webhookId: string,
  workspaceId: string,
  over: Partial<WebhookJob> = {},
): WebhookJob => ({
  webhookId,
  deliveryId: 'del_1',
  type: 'link.created',
  workspaceId,
  createdAt: new Date().toISOString(),
  data: { link: { id: 'l1', slug: 'abc' } },
  ...over,
});

describe('delivery', () => {
  it('POSTs a signed JSON body that a receiver can verify, with identifying headers', async () => {
    const { row, workspace } = await hook(`http://127.0.0.1:${port}/hooks/in`);
    const r = await deliverWebhook(deps(), job(row.id, workspace.id));
    expect(r).toEqual({ delivered: true, status: 200 });
    const h = hits[0]!;
    expect(h).toMatchObject({ path: '/hooks/in', method: 'POST' });
    expect(h.headers['content-type']).toBe('application/json');
    expect(h.headers['user-agent']).toBe('GoShort-Webhooks/1');
    expect(h.headers['x-goshort-event']).toBe('link.created');
    expect(h.headers['x-goshort-delivery']).toBe('del_1');
    expect(JSON.parse(h.body)).toMatchObject({
      id: 'del_1',
      type: 'link.created',
      workspaceId: workspace.id,
      data: { link: { slug: 'abc' } },
    });
    expect(
      verifyWebhookSignature(
        SECRET,
        String(h.headers['x-goshort-signature']),
        h.body,
        Math.floor(Date.now() / 1000),
      ),
    ).toBe(true);
    // The secret itself is never sent.
    expect(JSON.stringify(h)).not.toContain(SECRET);
  });

  it.each([500, 502, 404, 429])(
    'a %i response is a failure (so the job is retried)',
    async (code) => {
      handler = (_q, res) => res.writeHead(code).end();
      const { row, workspace } = await hook(`http://127.0.0.1:${port}/`);
      await expect(deliverWebhook(deps(), job(row.id, workspace.id))).rejects.toThrow(String(code));
    },
  );

  it('never follows redirects (a 3xx is a failure and the target is never requested)', async () => {
    handler = (req, res) =>
      req.url === '/'
        ? res.writeHead(302, { Location: `http://127.0.0.1:${port}/internal-admin` }).end()
        : res.writeHead(200).end();
    const { row, workspace } = await hook(`http://127.0.0.1:${port}/`);
    await expect(deliverWebhook(deps(), job(row.id, workspace.id))).rejects.toThrow(
      /redirects are not followed/,
    );
    expect(hits.map((h) => h.path)).toEqual(['/']);
  });

  it('times out on a server that never answers', async () => {
    handler = () => undefined;
    const { row, workspace } = await hook(`http://127.0.0.1:${port}/`);
    const t0 = Date.now();
    await expect(
      deliverWebhook(deps({ timeoutMs: 250 }), job(row.id, workspace.id)),
    ).rejects.toThrow(/timed out/);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('does not buffer an unbounded response body', async () => {
    handler = (_q, res) => {
      res.writeHead(200);
      const chunk = Buffer.alloc(64 * 1024, 'x');
      let sent = 0;
      const pump = () => {
        while (sent < 200 && res.write(chunk)) sent++; // up to ~12 MB if the client kept reading
        if (sent < 200) res.once('drain', pump);
        else res.end();
      };
      pump();
    };
    const { row, workspace } = await hook(`http://127.0.0.1:${port}/`);
    const r = await deliverWebhook(deps(), job(row.id, workspace.id));
    expect(r.delivered).toBe(true);
  });

  it('skips deleted, disabled and no-longer-subscribed webhooks; sends test events regardless of subscription', async () => {
    const { row, workspace } = await hook(`http://127.0.0.1:${port}/`);
    expect(await deliverWebhook(deps(), job('missing', workspace.id))).toMatchObject({
      delivered: false,
      skipped: 'webhook deleted',
    });
    expect(
      await deliverWebhook(deps(), job(row.id, workspace.id, { type: 'link.deleted' })),
    ).toMatchObject({ delivered: false, skipped: 'no longer subscribed' });
    expect(
      await deliverWebhook(deps(), job(row.id, workspace.id, { type: 'webhook.test' })),
    ).toMatchObject({ delivered: true });
    await prisma.webhook.update({ where: { id: row.id }, data: { isActive: false } });
    expect(await deliverWebhook(deps(), job(row.id, workspace.id))).toMatchObject({
      delivered: false,
      skipped: 'webhook disabled',
    });
    expect(hits).toHaveLength(1);
  });

  it('fails closed (no request) if the stored secret cannot be opened', async () => {
    const { row, workspace } = await hook(`http://127.0.0.1:${port}/`, {
      secret: 'plaintext-not-sealed',
    });
    await expect(deliverWebhook(deps(), job(row.id, workspace.id))).rejects.toThrow();
    expect(hits).toHaveLength(0);
  });
});

describe('SSRF protection (guard enabled)', () => {
  const strict = (resolve: (h: string) => Promise<string[]>) =>
    deps({ allowInsecure: false, resolve });

  it.each([
    ['loopback', ['127.0.0.1']],
    ['private 10/8', ['10.0.0.8']],
    ['private 192.168/16', ['192.168.1.10']],
    ['cloud metadata', ['169.254.169.254']],
    ['IPv6 loopback', ['::1']],
    ['IPv4-mapped loopback', ['::ffff:127.0.0.1']],
    ['unique-local IPv6', ['fd00::1']],
    ['mixed answer (one public, one private)', ['93.184.216.34', '10.0.0.8']],
  ])(
    'blocks a public-looking hostname that resolves to %s, without connecting',
    async (_n, addrs) => {
      const { row, workspace } = await hook('https://hooks.attacker.example/x');
      await expect(
        deliverWebhook(
          strict(async () => addrs),
          job(row.id, workspace.id),
        ),
      ).rejects.toThrow(/non-public address/);
      expect(hits).toHaveLength(0);
    },
  );

  it('rejects http:// URLs and resolution failures', async () => {
    const { row, workspace } = await hook(`http://127.0.0.1:${port}/`);
    await expect(
      deliverWebhook(
        strict(async () => ['93.184.216.34']),
        job(row.id, workspace.id),
      ),
    ).rejects.toThrow(/https/);
    const { row: r2, workspace: w2 } = await hook('https://nx.example/x');
    await expect(
      deliverWebhook(
        strict(async () => {
          throw new Error('ENOTFOUND');
        }),
        job(r2.id, w2.id),
      ),
    ).rejects.toThrow(/resolve/);
    await expect(
      deliverWebhook(
        strict(async () => []),
        job(r2.id, w2.id),
      ),
    ).rejects.toThrow(/resolve/);
    expect(hits).toHaveLength(0);
  });

  it('pins the connection to the vetted address (no second lookup) and keeps the original Host header', async () => {
    const { row, workspace } = await hook(`http://hooks.example.test:${port}/pinned`);
    let lookups = 0;
    const d = deps({
      resolve: async () => {
        lookups++;
        return ['127.0.0.1'];
      },
    }); // allowInsecure: true so loopback is allowed here
    await deliverWebhook(d, job(row.id, workspace.id));
    expect(lookups).toBe(1);
    expect(hits[0]!.headers.host).toBe(`hooks.example.test:${port}`);
    expect(hits[0]!.path).toBe('/pinned');
  });
});

describe('queue integration (real BullMQ): retries, then retained for inspection', () => {
  const closers: Array<() => Promise<unknown>> = [];
  afterEach(async () => {
    for (const c of closers.splice(0)) await c().catch(() => undefined);
  });
  const redis = (o = {}) => new Redis(process.env.REDIS_URL!, o);

  async function setup() {
    await redis().flushdb();
    const q = new Queue<WebhookJob>(QUEUES.webhooks, { connection: redis() });
    const w = createWebhookWorker({
      connection: redis({ maxRetriesPerRequest: null }),
      deps: deps(),
    });
    closers.push(
      () => q.close(),
      () => w.close(),
    );
    return q;
  }
  const quick = {
    ...WEBHOOK_JOB_OPTIONS,
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 20 },
  };

  it('retries a flaky endpoint until it succeeds', async () => {
    let n = 0;
    handler = (_q, res) => res.writeHead(++n < 3 ? 503 : 200).end();
    const { row, workspace } = await hook(`http://127.0.0.1:${port}/`);
    const q = await setup();
    await q.add('d', job(row.id, workspace.id), { ...quick, jobId: 'flaky' });
    for (let i = 0; i < 200 && (await q.getCompletedCount()) === 0; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(await q.getCompletedCount()).toBe(1);
    expect(hits).toHaveLength(3);
    expect(await q.getFailedCount()).toBe(0);
  });

  it('gives up after the configured attempts and keeps the failed job (dead letter)', async () => {
    handler = (_q, res) => res.writeHead(500).end();
    const { row, workspace } = await hook(`http://127.0.0.1:${port}/`);
    const q = await setup();
    await q.add('d', job(row.id, workspace.id), { ...quick, jobId: 'dead' });
    for (let i = 0; i < 200 && (await q.getFailedCount()) === 0; i++)
      await new Promise((r) => setTimeout(r, 25));
    const [failed] = await q.getFailed();
    expect(failed).toMatchObject({ attemptsMade: 3 });
    expect(failed!.failedReason).toBe('Webhook responded 500');
    expect(hits).toHaveLength(3); // bounded, not forever
    expect(WEBHOOK_JOB_OPTIONS.removeOnFail.age).toBeGreaterThanOrEqual(7 * 86_400);
  });
});
