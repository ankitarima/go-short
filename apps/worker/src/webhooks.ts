import { lookup as dnsLookup } from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import type { PrismaClient } from '@go-short/database';
import {
  QUEUES,
  WEBHOOK_TEST_EVENT,
  type WebhookJob,
  isPublicIp,
  openSecret,
  signWebhook,
} from '@go-short/shared';
import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

export class WebhookDeliveryError extends Error {}

export interface DeliveryDeps {
  prisma: PrismaClient;
  logger: Logger;
  /** Master secret used to open stored webhook secrets. */
  masterSecret: string;
  /** Dev/test only: allow http:// and private targets. */
  allowInsecure: boolean;
  timeoutMs?: number;
  /** Injectable for tests (DNS rebinding simulations). */
  resolve?: (hostname: string) => Promise<string[]>;
  now?: () => number;
}

const MAX_RESPONSE_BYTES = 64 * 1024;
const defaultResolve = async (h: string) =>
  (await dnsLookup(h, { all: true })).map((a) => a.address);

/**
 * POSTs to a user-supplied URL. This is the one place the platform makes outbound requests on a
 * user's behalf, so it is hardened against SSRF:
 *  - the hostname is resolved HERE, every returned address must be public, and the TCP connection is
 *    pinned to the vetted address (no second DNS lookup, so DNS rebinding cannot swap in a private IP);
 *  - TLS is still verified against the original hostname (servername);
 *  - redirects are never followed (a 3xx is a failure), the request has a hard timeout, and the
 *    response body is read only up to 64 KB and discarded.
 */
export async function postJson(
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  d: Pick<DeliveryDeps, 'allowInsecure' | 'timeoutMs' | 'resolve'>,
): Promise<{ status: number }> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' && !(d.allowInsecure && url.protocol === 'http:'))
    throw new WebhookDeliveryError('Only https URLs are allowed');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await (d.resolve ?? defaultResolve)(hostname).catch(() => {
    throw new WebhookDeliveryError('Could not resolve the webhook host');
  });
  if (addresses.length === 0) throw new WebhookDeliveryError('Could not resolve the webhook host');
  if (!d.allowInsecure && !addresses.every(isPublicIp)) {
    // Refuse if ANY answer is private: an attacker-controlled name can return a mix.
    throw new WebhookDeliveryError(
      'Webhook host resolves to a non-public address; delivery blocked',
    );
  }
  const address = addresses[0]!;
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        host: address,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: { ...headers, Host: url.host, 'Content-Length': Buffer.byteLength(body) },
        ...(isHttps ? { servername: hostname } : {}),
        timeout: d.timeoutMs ?? 10_000,
        lookup: undefined, // we connect to a literal IP; never let the stack resolve again
      },
      (res) => {
        let read = 0;
        res.on('data', (c: Buffer) => {
          read += c.length;
          if (read > MAX_RESPONSE_BYTES) res.destroy();
        });
        res.on('error', () => undefined);
        res.on('end', () => finish(res.statusCode ?? 0));
        res.on('close', () => finish(res.statusCode ?? 0));
      },
    );
    let done = false;
    const finish = (status: number) => {
      if (done) return;
      done = true;
      resolve({ status });
    };
    req.on('timeout', () => req.destroy(new WebhookDeliveryError('Webhook request timed out')));
    req.on('error', (err) => {
      if (done) return;
      done = true;
      reject(
        err instanceof WebhookDeliveryError
          ? err
          : new WebhookDeliveryError(
              `Webhook request failed: ${(err as NodeJS.ErrnoException).code ?? err.message}`,
            ),
      );
    });
    req.end(body);
  });
}

export interface DeliveryResult {
  delivered: boolean;
  skipped?: string;
  status?: number;
}

/** Delivers one queued event. Throws on failure so BullMQ retries with backoff. */
export async function deliverWebhook(d: DeliveryDeps, job: WebhookJob): Promise<DeliveryResult> {
  const hook = await d.prisma.webhook.findUnique({ where: { id: job.webhookId } });
  if (!hook) return { delivered: false, skipped: 'webhook deleted' };
  if (!hook.isActive) return { delivered: false, skipped: 'webhook disabled' };
  // Subscriptions can change between enqueue and delivery; honour the current ones.
  if (job.type !== WEBHOOK_TEST_EVENT && !hook.events.includes(job.type))
    return { delivered: false, skipped: 'no longer subscribed' };

  const body = JSON.stringify({
    id: job.deliveryId,
    type: job.type,
    createdAt: job.createdAt,
    workspaceId: job.workspaceId,
    data: job.data,
  });
  const secret = openSecret(hook.secret, d.masterSecret);
  const t = Math.floor((d.now ?? Date.now)() / 1000);
  const { status } = await postJson(
    hook.url,
    body,
    {
      'Content-Type': 'application/json',
      'User-Agent': 'GoShort-Webhooks/1',
      'X-GoShort-Event': job.type,
      'X-GoShort-Delivery': job.deliveryId,
      'X-GoShort-Signature': signWebhook(secret, t, body),
    },
    d,
  );
  if (status >= 200 && status < 300) return { delivered: true, status };
  if (status >= 300 && status < 400)
    throw new WebhookDeliveryError(`Webhook responded ${status}; redirects are not followed`);
  throw new WebhookDeliveryError(`Webhook responded ${status}`);
}

export function createWebhookWorker(o: {
  connection: Redis;
  deps: DeliveryDeps;
  concurrency?: number;
}): Worker<WebhookJob> {
  const worker = new Worker<WebhookJob>(
    QUEUES.webhooks,
    (job) => deliverWebhook(o.deps, job.data),
    {
      connection: o.connection,
      concurrency: o.concurrency ?? 5,
    },
  );
  worker.on('failed', (job, err) =>
    o.deps.logger.warn(
      {
        webhookId: job?.data.webhookId,
        deliveryId: job?.data.deliveryId,
        attempt: job?.attemptsMade,
        err: err.message,
      },
      'webhook delivery failed',
    ),
  );
  return worker;
}
