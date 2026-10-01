import { loadConfig } from '@go-short/config';
import { getPrisma } from '@go-short/database';
import { QUEUES } from '@go-short/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppContext } from '../src/context';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DnsResolver } from '../src/services/dns';
import { LocalStorageProvider } from '@go-short/shared';
import { ensureSharedDomain } from '../src/services/domains';
import type { EmailMessage, EmailProvider } from '../src/services/email';

export class CapturingEmail implements EmailProvider {
  sent: EmailMessage[] = [];
  async send(m: EmailMessage) {
    this.sent.push(m);
  }
  lastToken(): string {
    const m = this.sent.at(-1)?.text.match(/token=([\w-]+)/);
    if (!m?.[1]) throw new Error('no token in last email');
    return m[1];
  }
}

export class FakeDns implements DnsResolver {
  cname = new Map<string, string[]>();
  txt = new Map<string, string[][]>();
  async resolveCname(h: string) {
    const v = this.cname.get(h);
    if (!v) throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' });
    return v;
  }
  async resolveTxt(h: string) {
    const v = this.txt.get(h);
    if (!v) throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' });
    return v;
  }
}

export function makeCtx(): AppContext & { email: CapturingEmail; dns: FakeDns } {
  return {
    config: loadConfig(),
    prisma: getPrisma(),
    redis: new Redis(process.env.REDIS_URL!),
    logger: pino({ level: 'silent' }),
    email: new CapturingEmail(),
    dns: new FakeDns(),
    queues: {
      analytics: new Queue(QUEUES.analyticsEvents, {
        connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
      }),
      cleanup: new Queue(QUEUES.cleanup, {
        connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
      }),
      webhooks: new Queue(QUEUES.webhooks, {
        connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
      }),
    },
    storage: new LocalStorageProvider(mkdtempSync(join(tmpdir(), 'go-short-test-'))),
  };
}

export async function resetDb(ctx: AppContext) {
  await ctx.prisma.$executeRawUnsafe(
    'TRUNCATE "User","Workspace","ClickEvent","AnalyticsDaily","AnalyticsDimensionDaily","DailyVisitor","AnalyticsBucket","AuditLog" CASCADE',
  );
  await ctx.redis.flushdb();
  await ctx.prisma.domain.deleteMany();
  await ensureSharedDomain(ctx);
}

export interface Client {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  userId: string;
  email: string;
}

let counter = 0;
export async function registerUser(
  app: ReturnType<typeof createApp>,
  name = 'Test',
): Promise<Client> {
  const agent = request.agent(app);
  const email = `user${++counter}-${Date.now()}@example.com`;
  const res = await agent
    .post('/api/v1/auth/register')
    .send({ email, name, password: 'correct-horse-battery' })
    .expect(201);
  return { agent, csrf: res.body.data.csrfToken, userId: res.body.data.user.id, email };
}

export const post = (c: Client, path: string, body: object = {}) =>
  c.agent.post(path).set('X-CSRF-Token', c.csrf).send(body);
export const patch = (c: Client, path: string, body: object = {}) =>
  c.agent.patch(path).set('X-CSRF-Token', c.csrf).send(body);
export const del = (c: Client, path: string) => c.agent.delete(path).set('X-CSRF-Token', c.csrf);

export const get = (c: Client, path: string) => c.agent.get(path);

export async function createWorkspace(c: Client, name = 'Acme'): Promise<string> {
  return (await post(c, '/api/v1/workspaces', { name }).expect(201)).body.data.id as string;
}

export async function sharedDomainId(c: Client, wsId: string): Promise<string> {
  const rows = (await c.agent.get(`/api/v1/workspaces/${wsId}/domains`).expect(200)).body.data as {
    id: string;
    shared: boolean;
  }[];
  return rows.find((d) => d.shared)!.id;
}

/** Adds a custom domain and verifies it through the fake DNS (CNAME to the platform host). */
export async function addVerifiedDomain(
  ctx: ReturnType<typeof makeCtx>,
  c: Client,
  wsId: string,
  hostname: string,
): Promise<string> {
  const id = (await post(c, `/api/v1/workspaces/${wsId}/domains`, { hostname }).expect(201)).body
    .data.id as string;
  ctx.dns.cname.set(hostname, [ctx.config.DEFAULT_SHORT_DOMAIN.split(':')[0]!]);
  await post(c, `/api/v1/workspaces/${wsId}/domains/${id}/verify`).expect(200);
  return id;
}
