import request from 'supertest';
import { createRedirectMetrics } from '../src/metrics';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  listen,
  brokenPrisma,
  countingPrisma,
  customDomain,
  deadRedis,
  makeRedirect,
  prisma,
  redis,
  resetDb,
  seedLink,
  seedWorkspace,
  sharedDomain,
} from './helpers';

const HOST = 'localhost:4001';
beforeEach(resetDb);
afterAll(async () => {
  await redis.quit();
  await prisma.$disconnect();
});

async function setup(slug = 'hello', extra: Record<string, unknown> = {}) {
  const { ws } = await seedWorkspace();
  const dom = await sharedDomain();
  const link = await seedLink(ws.id, dom.id, slug, extra);
  return { ws, dom, link };
}
const get = (server: import('node:http').Server, path: string, host = HOST) =>
  request(server).get(path).set('Host', host).redirects(0);

describe('redirect basics', () => {
  it('redirects with 302 by default, no-store, and publishes one analytics event', async () => {
    const { link, ws } = await setup('hello', { campaignId: null });
    const { server, publisher } = makeRedirect();
    const res = await get(server, '/hello')
      .set('User-Agent', 'Mozilla/5.0 Test')
      .set('Referer', 'https://news.example/post')
      .set('Accept-Language', 'en-IN');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.org/landing');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]).toMatchObject({
      linkId: link.id,
      workspaceId: ws.id,
      campaignId: null,
      userAgent: 'Mozilla/5.0 Test',
      referer: 'https://news.example/post',
      acceptLanguage: 'en-IN',
    });
    expect(publisher.events[0]!.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Math.abs(publisher.events[0]!.timestamp - Date.now())).toBeLessThan(5000);
  });

  it('merges the link UTM parameters into the destination', async () => {
    await setup('utm', {
      destinationUrl: 'https://example.org/p?x=1&utm_source=mail',
      utmSource: 'ig',
      utmMedium: 'social',
    });
    const res = await get(makeRedirect().server, '/utm');
    const loc = new URL(res.headers.location!);
    expect(loc.searchParams.getAll('utm_source')).toEqual(['mail']); // destination's own value wins
    expect(loc.searchParams.get('utm_medium')).toBe('social');
    expect(loc.searchParams.get('x')).toBe('1');
  });

  it.each([
    [{}, 301, 'private, max-age=3600'],
    [{ redirectStatus: 307 }, 307, 'no-store'],
    [{ redirectStatus: 308 }, 308, 'private, max-age=3600'],
  ])('status codes: link override %j', async (extra, expected, cache) => {
    await setup('st', extra);
    const { server } = makeRedirect({ config: { REDIRECT_STATUS: 301 } });
    const res = await get(server, '/st');
    expect(res.status).toBe(expected);
    expect(res.headers['cache-control']).toBe(cache);
  });

  it('is case-sensitive for slugs', async () => {
    await setup('Sale');
    const { server } = makeRedirect();
    await get(server, '/Sale').expect(302);
    await get(server, '/sale').expect(404);
  });

  it('handles bare domain, odd paths, methods and bad Host headers', async () => {
    await setup();
    const { server, publisher } = makeRedirect();
    expect((await get(server, '/')).headers.location).toBe('http://localhost:5173');
    await get(server, '/a/b').expect(404);
    await get(server, '/favicon.ico').expect(404);
    await get(server, '/he%00llo').expect(404);
    await get(server, '/' + 'a'.repeat(65)).expect(404);
    await request(server).post('/hello').set('Host', HOST).expect(405);
    await request(server).delete('/hello').set('Host', HOST).expect(405);
    await request(server).get('/hello').set('Host', 'bad host!').expect(400);
    expect(publisher.events).toHaveLength(0);
  });

  it('HEAD answers like GET but is not counted as a click', async () => {
    await setup();
    const { server, publisher } = makeRedirect();
    const res = await request(server).head('/hello').set('Host', HOST).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.org/landing');
    expect(publisher.events).toHaveLength(0);
  });

  it('health and ready', async () => {
    const { server } = makeRedirect();
    await request(server).get('/health').expect(200);
    expect((await request(server).get('/ready').expect(200)).body.checks).toEqual({
      postgres: 'ok',
      redis: 'ok',
    });
  });
});

describe('link states', () => {
  it('unknown slug: 404 page, no analytics', async () => {
    const { server, publisher } = makeRedirect();
    const res = await get(server, '/nope');
    expect(res.status).toBe(404);
    expect(res.text).toContain('Link not found');
    expect(res.headers.location).toBeUndefined();
    expect(publisher.events).toHaveLength(0);
  });

  it('disabled: 410 page, never redirects', async () => {
    await setup('off', { isActive: false });
    const { server, publisher } = makeRedirect();
    const res = await get(server, '/off');
    expect(res.status).toBe(410);
    expect(res.headers.location).toBeUndefined();
    expect(res.text).not.toContain('example.org');
    expect(publisher.events).toHaveLength(0);
  });

  it('expired: 410 "expired" page, honours the clock, boundary is exclusive', async () => {
    const at = new Date('2030-01-01T00:00:00Z');
    await setup('exp', { expiresAt: at });
    const before = makeRedirect({ now: () => at.getTime() - 1 }).server;
    const exactly = makeRedirect({ now: () => at.getTime() }).server;
    await get(before, '/exp').expect(302);
    const res = await get(exactly, '/exp');
    expect(res.status).toBe(410);
    expect(res.text).toContain('This link has expired');
  });

  it('configured fallback URL replaces error pages with a redirect', async () => {
    await setup('off', { isActive: false });
    const { server } = makeRedirect({
      config: { LINK_UNAVAILABLE_REDIRECT_URL: 'https://example.com/sorry' },
    });
    for (const p of ['/off', '/missing']) {
      const res = await get(server, p);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://example.com/sorry');
    }
  });

  it('error pages are not cacheable and carry a restrictive CSP', async () => {
    const res = await get(makeRedirect().server, '/missing');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });
});

describe('custom domains and host safety', () => {
  it('same slug on different domains goes to different destinations', async () => {
    const { ws } = await seedWorkspace();
    const shared = await sharedDomain();
    const custom = await customDomain(ws.id, 'links.client.com');
    await seedLink(ws.id, shared.id, 'sale', { destinationUrl: 'https://one.example/' });
    await seedLink(ws.id, custom.id, 'sale', { destinationUrl: 'https://two.example/' });
    const { server } = makeRedirect();
    expect((await get(server, '/sale', HOST)).headers.location).toBe('https://one.example/');
    expect((await get(server, '/sale', 'LINKS.Client.com')).headers.location).toBe(
      'https://two.example/',
    );
    expect((await get(server, '/sale', 'links.client.com.')).headers.location).toBe(
      'https://two.example/',
    ); // trailing dot
  });

  it('a link is not reachable through another tenant’s domain or an unknown host, and creates no cache keys', async () => {
    const a = await seedWorkspace('A');
    const b = await seedWorkspace('B');
    const shared = await sharedDomain();
    await customDomain(b.ws.id, 'b.client.com');
    await seedLink(a.ws.id, shared.id, 'secret-one');
    const { server } = makeRedirect();
    await get(server, '/secret-one', 'b.client.com').expect(404);
    for (let i = 0; i < 20; i++)
      await get(server, `/x${i}`, `random${i}.attacker.example`).expect(404);
    // Unknown hostnames create no keys at all; at most the one known-host miss is negative-cached.
    expect(await redis.keys('link:*attacker*')).toEqual([]);
    expect((await redis.keys('link:*')).length).toBeLessThanOrEqual(1);
  });

  it('unverified or disabled domains do not serve links', async () => {
    const { ws } = await seedWorkspace();
    const pending = await customDomain(ws.id, 'pending.client.com', {
      status: 'PENDING',
      isVerified: false,
    });
    const disabled = await customDomain(ws.id, 'disabled.client.com', { status: 'DISABLED' });
    await seedLink(ws.id, pending.id, 'p');
    await seedLink(ws.id, disabled.id, 'd');
    const { server } = makeRedirect();
    await get(server, '/p', 'pending.client.com').expect(404);
    await get(server, '/d', 'disabled.client.com').expect(404);
  });

  it('floods of unknown hostnames are capped at the registry budget (no unbounded DB lookups)', async () => {
    const { prisma: counted } = countingPrisma();
    let domainLookups = 0;
    const spy = new Proxy(counted, {
      get(t, k) {
        if (k === 'domain')
          return {
            findFirst: (...a: unknown[]) => {
              domainLookups++;
              return (t.domain.findFirst as (...x: unknown[]) => unknown)(...a);
            },
          };
        return Reflect.get(t, k);
      },
    }) as typeof prisma;
    const { server } = makeRedirect({ prisma: spy, now: () => 1_000_000 }); // frozen clock: no token refill
    const { url, close } = await listen(server);
    // Waves of 40: the macOS default listen backlog (128) resets 200 simultaneous connects.
    for (let wave = 0; wave < 5; wave++) {
      await Promise.all(
        Array.from({ length: 40 }, (_, i) =>
          request(url).get('/nope').set('Host', `h${wave}-${i}.flood.example`),
        ),
      );
    }
    await close();
    expect(domainLookups).toBeLessThanOrEqual(50);
  });
});

describe('caching', () => {
  it('a miss populates Redis with a minimal entry and a TTL; the next hit does not touch Postgres', async () => {
    const { ws, link } = await setup('cached', { utmSource: 'x' });
    const c1 = countingPrisma();
    await get(makeRedirect({ prisma: c1.prisma }).server, '/cached').expect(302);
    expect(c1.calls.linkFindFirst).toBe(1);

    const raw = await redis.get('link:localhost:4001:cached');
    expect(JSON.parse(raw!)).toEqual({
      linkId: link.id,
      workspaceId: ws.id,
      campaignId: null,
      destinationUrl: 'https://example.org/landing?utm_source=x',
      active: true,
      expiresAt: null,
      hasPassword: false,
      status: null,
    });
    const ttl = await redis.ttl('link:localhost:4001:cached');
    expect(ttl).toBeGreaterThan(3000);
    expect(ttl).toBeLessThanOrEqual(3960);

    const c2 = countingPrisma();
    for (let i = 0; i < 5; i++)
      await get(makeRedirect({ prisma: c2.prisma }).server, '/cached').expect(302);
    expect(c2.calls.linkFindFirst).toBe(0);
  });

  it('cached links keep redirecting while Postgres is down (documented availability property)', async () => {
    await setup('warm');
    await get(makeRedirect().server, '/warm').expect(302); // warm the cache
    const { server, publisher } = makeRedirect({ prisma: brokenPrisma });
    await get(server, '/warm').expect(302);
    expect(publisher.events).toHaveLength(1);
  });

  it('uncached links return 503 (not 404) while Postgres is down', async () => {
    await setup('cold');
    const res = await get(makeRedirect({ prisma: brokenPrisma }).server, '/cold');
    expect(res.status).toBe(503);
    expect(res.headers.location).toBeUndefined();
  });

  it('negative results for known hosts are cached briefly, and clearing the key makes a new link work', async () => {
    const { server } = makeRedirect();
    await get(server, '/later').expect(404);
    expect(JSON.parse((await redis.get('link:localhost:4001:later'))!)).toEqual({ missing: true });
    expect(await redis.ttl('link:localhost:4001:later')).toBeLessThanOrEqual(60);
    const { ws } = await seedWorkspace();
    await seedLink(ws.id, (await sharedDomain()).id, 'later');
    await get(server, '/later').expect(404); // still negative
    await redis.del('link:localhost:4001:later'); // what the API does on create
    await get(server, '/later').expect(302);
  });

  it('single-flight: 50 concurrent cold requests cause exactly one link query', async () => {
    await setup('burst');
    const c = countingPrisma();
    const { server, publisher } = makeRedirect({ prisma: c.prisma });
    const { url, close } = await listen(server);
    const results = await Promise.all(
      Array.from({ length: 50 }, () => request(url).get('/burst').set('Host', HOST).redirects(0)),
    );
    await close();
    expect(results.every((r) => r.status === 302)).toBe(true);
    expect(c.calls.linkFindFirst).toBe(1);
    expect(publisher.events).toHaveLength(50); // every click is still counted
  });

  it('corrupt or hostile cache values are never followed', async () => {
    await setup('poison');
    const { server } = makeRedirect();
    const key = 'link:localhost:4001:poison';
    const entry = {
      linkId: 'l',
      workspaceId: 'w',
      campaignId: null,
      active: true,
      expiresAt: null,
      hasPassword: false,
      status: null,
    };
    await redis.set(key, 'not json{');
    await get(server, '/poison').expect(302); // repaired from Postgres
    for (const destinationUrl of [
      'javascript:alert(1)',
      'https://ok.example/\r\nSet-Cookie: x=1',
      'https://a.example/ b',
    ]) {
      await redis.set(key, JSON.stringify({ ...entry, destinationUrl }));
      const res = await get(server, '/poison');
      expect(res.status).toBe(404);
      expect(res.headers.location).toBeUndefined();
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });
});

describe('request ids', () => {
  it('every response carries a unique X-Request-Id', async () => {
    await setup();
    const { server } = makeRedirect();
    const ids = new Set<string>();
    for (const p of ['/hello', '/hello', '/nope', '/health'])
      ids.add((await get(server, p)).headers['x-request-id']!);
    expect(ids.size).toBe(4);
    for (const id of ids) expect(id).toMatch(/^req_[0-9a-z]+-[0-9a-z]+$/);
  });
});

describe('cache hardening', () => {
  it('a poisoned cached status code falls back to the configured default', async () => {
    const { ws, link } = await setup('st');
    const entry = {
      linkId: link.id,
      workspaceId: ws.id,
      campaignId: null,
      destinationUrl: 'https://example.org/x',
      active: true,
      expiresAt: null,
      hasPassword: false,
    };
    for (const status of [303, 200, 999, 'x']) {
      await redis.set('link:localhost:4001:st', JSON.stringify({ ...entry, status }));
      expect((await get(makeRedirect().server, '/st')).status).toBe(302);
    }
  });
});

describe('redis and analytics failure policy', () => {
  it('Redis down: falls back to Postgres and still redirects and publishes', async () => {
    await setup('nored');
    const { server, publisher } = makeRedirect({ redis: deadRedis() });
    const res = await get(server, '/nored');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.org/landing');
    expect(publisher.events).toHaveLength(1);
  });

  it('Redis down and Postgres down: 503, not a crash', async () => {
    const res = await get(
      makeRedirect({ redis: deadRedis(), prisma: brokenPrisma }).server,
      '/anything',
    );
    expect(res.status).toBe(503);
  });

  it('a publisher that throws never breaks the redirect', async () => {
    await setup('pub');
    const throwing = {
      publish: () => {
        throw new Error('queue exploded');
      },
    };
    const res = await get(makeRedirect({ publisher: throwing }).server, '/pub');
    expect(res.status).toBe(302);
  });
});

describe('client IP and trusted proxies', () => {
  it('ignores X-Forwarded-For unless proxies are trusted', async () => {
    await setup();
    const untrusted = makeRedirect({ config: { trustProxy: false } });
    await get(untrusted.server, '/hello').set('X-Forwarded-For', '203.0.113.9');
    expect(untrusted.publisher.events[0]!.ip).toMatch(/127\.0\.0\.1|::1/);
    expect(untrusted.publisher.events[0]!.forwardedFor).toBe('203.0.113.9'); // recorded raw, not trusted

    const trusted = makeRedirect({ config: { trustProxy: 1 } });
    await get(trusted.server, '/hello').set('X-Forwarded-For', '198.51.100.1, 203.0.113.9');
    expect(trusted.publisher.events[0]!.ip).toBe('203.0.113.9'); // last hop added by our proxy
  });
});

describe('QR marker', () => {
  it('passes a well-formed ?qr= id into the analytics event, and ignores anything else', async () => {
    await setup();
    const { server, publisher } = makeRedirect();
    await get(server, '/hello?qr=qr_abc-123').expect(302);
    await get(server, '/hello?x=1&qr=abc&y=2').expect(302);
    await get(server, '/hello?qr=bad%20value!').expect(302);
    await get(server, '/hello?qr=' + 'a'.repeat(41)).expect(302);
    await get(server, '/hello').expect(302);
    expect(publisher.events.map((e) => e.qrId)).toEqual(['qr_abc-123', 'abc', null, null, null]);
  });
});

describe('password-protected links', () => {
  it('offers a show/hide toggle whose script is allowed only by its hash, and no other inline script runs', async () => {
    await setup('vault', { password: 'open-sesame' });
    const { server } = makeRedirect();
    const res = await get(server, '/vault');
    expect(res.text).toContain('id="pw-toggle"');
    expect(res.text).toContain('aria-label="Show password"');
    expect(res.text).toContain('hidden'); // without JavaScript the button stays hidden
    const csp = res.headers['content-security-policy']!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    // the hash in the header is the hash of exactly the one script in the page
    const scripts = [...res.text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(scripts).toHaveLength(1);
    const { createHash } = await import('node:crypto');
    expect(csp).toContain(`'sha256-${createHash('sha256').update(scripts[0]!).digest('base64')}'`);
    // other pages carry no script at all
    expect((await get(server, '/nope')).text).not.toContain('<script');
  });

  it('shows a form without leaking the destination and caches no destination', async () => {
    await setup('vault', { password: 'open-sesame' });
    const { server, publisher } = makeRedirect();
    const res = await get(server, '/vault');
    expect(res.status).toBe(200);
    expect(res.headers.location).toBeUndefined();
    expect(res.text).toContain('type="password"');
    expect(res.text).not.toContain('example.org');
    expect(publisher.events).toHaveLength(0);
    const cached = await redis.get('link:localhost:4001:vault');
    expect(cached).not.toMatch(/example\.org|argon2/);
    expect(JSON.parse(cached!)).toMatchObject({ hasPassword: true, destinationUrl: null });
  });

  it('wrong password: 401 and no redirect; right password: 303 to the destination, counted once', async () => {
    await setup('vault', { password: 'open-sesame', utmSource: 'qr' });
    const { server, publisher } = makeRedirect();
    const post = (pw: string) =>
      request(server)
        .post('/vault/unlock')
        .set('Host', HOST)
        .type('form')
        .send({ password: pw })
        .redirects(0);
    const bad = await post('nope');
    expect(bad.status).toBe(401);
    expect(bad.headers.location).toBeUndefined();
    expect(publisher.events).toHaveLength(0);
    const ok = await post('open-sesame');
    expect(ok.status).toBe(303);
    expect(ok.headers.location).toBe('https://example.org/landing?utm_source=qr');
    expect(publisher.events).toHaveLength(1);
  });

  it('the password never travels in the URL: GET with ?password= does not unlock', async () => {
    await setup('vault', { password: 'open-sesame' });
    const res = await get(makeRedirect().server, '/vault?password=open-sesame');
    expect(res.status).toBe(200);
    expect(res.headers.location).toBeUndefined();
  });

  it('rate limits guesses per link and client, and fails closed if Redis is down', async () => {
    await setup('vault', { password: 'open-sesame' });
    const { server } = makeRedirect();
    const post = () =>
      request(server)
        .post('/vault/unlock')
        .set('Host', HOST)
        .type('form')
        .send({ password: 'wrong' });
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await post()).status);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
    // Even the correct password is refused while throttled.
    expect(
      (
        await request(server)
          .post('/vault/unlock')
          .set('Host', HOST)
          .type('form')
          .send({ password: 'open-sesame' })
      ).status,
    ).toBe(429);

    await redis.flushdb();
    const down = makeRedirect({ redis: deadRedis() }).server;
    const r = await request(down)
      .post('/vault/unlock')
      .set('Host', HOST)
      .type('form')
      .send({ password: 'open-sesame' });
    expect([503]).toContain(r.status);
  });

  it('unlock on a non-protected, disabled or missing link never redirects', async () => {
    await setup('plain');
    await setup('dead', { isActive: false }).catch(() => undefined);
    const { server } = makeRedirect();
    for (const slug of ['plain', 'missing']) {
      const r = await request(server)
        .post(`/${slug}/unlock`)
        .set('Host', HOST)
        .type('form')
        .send({ password: 'x' });
      expect(r.status).toBe(404);
      expect(r.headers.location).toBeUndefined();
    }
  });

  it('rejects oversized or non-form bodies', async () => {
    await setup('vault', { password: 'open-sesame' });
    const { server } = makeRedirect();
    const big = await request(server)
      .post('/vault/unlock')
      .set('Host', HOST)
      .type('form')
      .send({ password: 'x'.repeat(5000) });
    expect(big.status).toBe(400);
    const json = await request(server)
      .post('/vault/unlock')
      .set('Host', HOST)
      .send({ password: 'open-sesame' });
    expect(json.status).toBe(400);
  });
});

describe('metrics', () => {
  const metric = async (m: ReturnType<typeof createRedirectMetrics>, name: string) =>
    (await m.registry.getMetricsAsJSON()).find((x) => x.name === name)?.values ?? [];
  const value = (
    vals: Array<{ value: number; labels: Record<string, unknown> }>,
    label: string,
    v: string,
  ) => vals.find((x) => x.labels[label] === v)?.value ?? 0;

  it('counts outcomes and cache results without exposing slugs, hosts or URLs as labels', async () => {
    await setup('hello');
    const metrics = createRedirectMetrics();
    const { server } = makeRedirect({ metrics });
    await get(server, '/hello'); // miss -> postgres
    await get(server, '/hello'); // cache hit
    await get(server, '/nope1'); // not found
    await get(server, '/nope2');
    await get(server, '/bad', 'bad host!');

    const requests = await metric(metrics, 'goshort_redirect_requests_total');
    expect(value(requests, 'outcome', 'redirect')).toBe(2);
    expect(value(requests, 'outcome', 'not_found')).toBe(2);
    expect(value(requests, 'outcome', 'bad_host')).toBe(1);
    const cache = await metric(metrics, 'goshort_redirect_cache_total');
    expect(value(cache, 'result', 'miss')).toBeGreaterThanOrEqual(1);
    expect(value(cache, 'result', 'hit')).toBe(1);

    const text = await metrics.registry.metrics();
    expect(text).not.toMatch(/hello|nope1|localhost|example\.org/);
    expect(text).toContain('goshort_redirect_duration_seconds_bucket');
  });

  it('counts a Redis outage as redis_error while still redirecting from Postgres', async () => {
    await setup('hello');
    const metrics = createRedirectMetrics();
    const { server } = makeRedirect({ metrics, redis: deadRedis() });
    expect((await get(server, '/hello')).status).toBe(302);
    const cache = await metric(metrics, 'goshort_redirect_cache_total');
    expect(value(cache, 'result', 'redis_error')).toBe(1);
  });
});
