import { loadConfig } from '@go-short/config';
import { getPrisma } from '@go-short/database';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppContext } from '../src/context';
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

export function makeCtx(): AppContext & { email: CapturingEmail } {
  return {
    config: loadConfig(),
    prisma: getPrisma(),
    redis: new Redis(process.env.REDIS_URL!),
    logger: pino({ level: 'silent' }),
    email: new CapturingEmail(),
  };
}

export async function resetDb(ctx: AppContext) {
  await ctx.prisma.$executeRawUnsafe(
    'TRUNCATE "User","Workspace","ClickEvent","AnalyticsDaily","AnalyticsDimensionDaily","DailyVisitor","AuditLog" CASCADE',
  );
  await ctx.redis.flushdb();
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
