import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Config } from '@go-short/config';
import type { PrismaClient } from '@go-short/database';
import { resolveDestination, type AnalyticsEvent, type RedirectCacheEntry } from '@go-short/shared';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { makeClientIp } from './clientIp';
import { DomainRegistry } from './domainRegistry';
import {
  disabledPage,
  errorPage,
  expiredPage,
  notFoundPage,
  passwordPage,
  tooManyPage,
} from './pages';
import type { AnalyticsPublisher } from './publisher';
import { LINK_SELECT, LinkResolver } from './resolver';

export interface RedirectDeps {
  config: Config;
  prisma: PrismaClient;
  redis: Redis;
  logger: Logger;
  publisher: AnalyticsPublisher;
  now?: () => number;
}

const SLUG_PATH = /^\/([A-Za-z0-9_-]{1,64})$/;
const UNLOCK_PATH = /^\/([A-Za-z0-9_-]{1,64})\/unlock$/;
const HOST_RE = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/;
// Defence in depth: whatever is in Redis, only emit plain http(s) URLs without control characters.
function isSafeLocation(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return false;
  }
  return true;
}
const ALLOWED_STATUS: ReadonlySet<number> = new Set([301, 302, 307, 308]);
const QR_PARAM = /(?:^|&)qr=([A-Za-z0-9_-]{1,40})(?:&|$)/;
/** `?qr=<id>` marks a scan of a QR code. Only parsed when a query string exists; validated later by the worker. */
function qrIdFrom(url: string | undefined): string | null {
  const q = url?.indexOf('?') ?? -1;
  return q === -1 ? null : (QR_PARAM.exec(url!.slice(q + 1))?.[1] ?? null);
}
const UNLOCK_MAX_ATTEMPTS = 10;
const UNLOCK_WINDOW_SECONDS = 900;

const trunc = (v: string | string[] | undefined, n: number): string | null =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, n) : null;

export function createRedirectServer(deps: RedirectDeps): Server {
  const { config, prisma, redis, logger, publisher } = deps;
  const now = deps.now ?? Date.now;
  const clientIp = makeClientIp(config.trustProxy);
  const domains = new DomainRegistry(prisma, now);
  const resolver = new LinkResolver({
    prisma,
    redis,
    logger,
    domains,
    ttlSeconds: config.REDIRECT_CACHE_TTL_SECONDS,
  });
  const sharedHost = config.DEFAULT_SHORT_DOMAIN.toLowerCase();

  function html(res: ServerResponse, status: number, body: string, head: boolean): void {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
    });
    res.end(head ? undefined : body);
  }

  /** Expired/disabled/not-found: optional configured fallback redirect, otherwise a page. */
  function unavailable(res: ServerResponse, status: number, page: string, head: boolean): void {
    const fallback = config.LINK_UNAVAILABLE_REDIRECT_URL;
    if (fallback) {
      res.writeHead(302, { Location: fallback, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    html(res, status, page, head);
  }

  function redirect(res: ServerResponse, status: number, location: string): void {
    // 301/308 are cached by browsers (repeat visits skip us and analytics); temporary codes never are.
    const permanent = status === 301 || status === 308;
    res.writeHead(status, {
      Location: location,
      'Cache-Control': permanent ? 'private, max-age=3600' : 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end();
  }

  function publish(
    req: IncomingMessage,
    e: { linkId: string; workspaceId: string; campaignId: string | null },
  ): void {
    try {
      const event: AnalyticsEvent = {
        eventId: randomUUID(),
        ...e,
        timestamp: now(),
        ip: clientIp(req),
        userAgent: trunc(req.headers['user-agent'], 512),
        referer: trunc(req.headers.referer, 1024),
        acceptLanguage: trunc(req.headers['accept-language'], 128),
        forwardedFor: trunc(req.headers['x-forwarded-for'], 512),
        qrId: qrIdFrom(req.url),
      };
      publisher.publish(event);
    } catch (err) {
      // Analytics must never break a redirect.
      logger.error({ err }, 'analytics publish failed');
    }
  }

  const isExpired = (e: RedirectCacheEntry) =>
    e.expiresAt !== null && Date.parse(e.expiresAt) <= now();

  /** Shared outcome for non-redirecting states. Returns true if it handled the response. */
  function handleUnavailable(
    res: ServerResponse,
    entry: RedirectCacheEntry,
    head: boolean,
  ): boolean {
    if (!entry.active) return (unavailable(res, 410, disabledPage(), head), true);
    if (isExpired(entry)) return (unavailable(res, 410, expiredPage(), head), true);
    return false;
  }

  async function serveLink(
    req: IncomingMessage,
    res: ServerResponse,
    host: string,
    slug: string,
    head: boolean,
  ) {
    const r = await resolver.resolve(host, slug);
    if (r.kind === 'missing') return unavailable(res, 404, notFoundPage(), head);
    if (r.kind === 'unavailable') return html(res, 503, errorPage(), head);
    const e = r.entry;
    if (handleUnavailable(res, e, head)) return;
    if (e.hasPassword) return html(res, 200, passwordPage(slug), head);
    if (!e.destinationUrl || !isSafeLocation(e.destinationUrl)) {
      logger.error({ linkId: e.linkId }, 'refusing unsafe or missing cached destination');
      return html(res, 404, notFoundPage(), head);
    }
    // HEAD (link-preview probes, uptime checks) gets the same answer but is not counted as a click.
    if (!head) publish(req, e);
    // A cached status outside the allowed set (corruption/poisoning) falls back to the default.
    const status =
      e.status !== null && ALLOWED_STATUS.has(e.status) ? e.status : config.REDIRECT_STATUS;
    redirect(res, status, e.destinationUrl);
  }

  async function readForm(req: IncomingMessage): Promise<URLSearchParams | null> {
    if (!/^application\/x-www-form-urlencoded/i.test(req.headers['content-type'] ?? ''))
      return null;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req as AsyncIterable<Buffer>) {
      size += c.length;
      if (size > 2048) return null;
      chunks.push(c);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  }

  async function unlock(req: IncomingMessage, res: ServerResponse, host: string, slug: string) {
    const r = await resolver.resolve(host, slug);
    if (r.kind === 'missing') return unavailable(res, 404, notFoundPage(), false);
    if (r.kind === 'unavailable') return html(res, 503, errorPage(), false);
    const e = r.entry;
    if (handleUnavailable(res, e, false)) return;
    if (!e.hasPassword) return html(res, 404, notFoundPage(), false);

    // Brute-force guard. Fails CLOSED: if we cannot count attempts we do not accept guesses.
    try {
      const key = `unlock:${e.linkId}:${clientIp(req)}`;
      const [[, n]] = (await redis
        .multi()
        .incr(key)
        .expire(key, UNLOCK_WINDOW_SECONDS, 'NX')
        .exec()) as [[Error | null, number], unknown];
      if (n > UNLOCK_MAX_ATTEMPTS) return html(res, 429, tooManyPage(), false);
    } catch (err) {
      logger.error({ err }, 'unlock rate limiter unavailable');
      return html(res, 503, errorPage(), false);
    }

    const form = await readForm(req);
    const password = form?.get('password');
    if (!password || password.length > 128)
      return html(res, 400, passwordPage(slug, 'Enter the password.'), false);

    const link = await prisma.link.findFirst({ where: { id: e.linkId }, select: LINK_SELECT });
    if (!link?.passwordHash) return html(res, 404, notFoundPage(), false);
    const ok = await argon2.verify(link.passwordHash, password).catch(() => false);
    if (!ok) return html(res, 401, passwordPage(slug, 'Incorrect password.'), false);

    const destination = resolveDestination(link);
    if (!isSafeLocation(destination)) return html(res, 404, notFoundPage(), false);
    publish(req, e);
    // 303: the browser follows with GET, so the password POST is never replayed at the destination.
    redirect(res, 303, destination);
  }

  async function ready(res: ServerResponse): Promise<void> {
    const check = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        () => 'fail',
      );
    const [postgres, redisState] = await Promise.all([
      check(prisma.$queryRaw`SELECT 1`),
      check(redis.ping()),
    ]);
    const ok = postgres === 'ok' && redisState === 'ok';
    const body = JSON.stringify({
      status: ok ? 'ready' : 'unavailable',
      checks: { postgres, redis: redisState },
    });
    res.writeHead(ok ? 200 : 503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

  // Cheap unique ids (no crypto on the hot path): process-start timestamp + counter.
  const idPrefix = Date.now().toString(36);
  let seq = 0;
  const debugLog = logger.isLevelEnabled('debug');

  const server = createServer((req, res) => {
    const requestId = `req_${idPrefix}-${(seq++).toString(36)}`;
    res.setHeader('X-Request-Id', requestId);
    const started = debugLog ? process.hrtime.bigint() : 0n;
    if (debugLog) {
      res.once('finish', () =>
        logger.debug(
          {
            requestId,
            method: req.method,
            // Slugs identify links but are not secrets; query strings are never logged.
            path: (req.url ?? '').split('?')[0],
            status: res.statusCode,
            durationMs: Number(process.hrtime.bigint() - started) / 1e6,
          },
          'request',
        ),
      );
    }
    void handle(req, res).catch((err) => {
      logger.error({ err, requestId }, 'unhandled redirect error');
      if (!res.headersSent) html(res, 500, errorPage(), false);
      else res.destroy();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const q = url.indexOf('?');
    const path = q === -1 ? url : url.slice(0, q);
    const method = req.method ?? 'GET';

    if (path === '/health')
      return void res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}');
    if (path === '/ready') return ready(res);

    // Host is only ever used as a lookup key; unknown hosts simply miss. Reject malformed ones early.
    const host = (req.headers.host ?? '').toLowerCase().replace(/\.(?=$|:)/, '');
    if (!HOST_RE.test(host)) return void res.writeHead(400).end();

    const head = method === 'HEAD';
    if (method === 'GET' || head) {
      if (path === '/') {
        // The bare shared domain points people at the app; custom domains have no landing page.
        if (host === sharedHost) return void res.writeHead(302, { Location: config.APP_URL }).end();
        return html(res, 404, notFoundPage(), head);
      }
      const m = SLUG_PATH.exec(path);
      if (!m) return html(res, 404, notFoundPage(), head);
      return serveLink(req, res, host, m[1]!, head);
    }
    if (method === 'POST') {
      const m = UNLOCK_PATH.exec(path);
      if (m) return unlock(req, res, host, m[1]!);
    }
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
  }

  // Keep-alive above typical proxy idle timeouts so the proxy never reuses a connection we just closed.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 15_000;
  return server;
}
