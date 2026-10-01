import { createHash } from 'node:crypto';
import { Validator } from '@seriousme/openapi-schema-validator';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import express, { type Express } from 'express';
import { PNG } from 'pngjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { buildOpenApi } from '../src/openapi/build';
import { operations } from '../src/openapi/operations';
import { addVerifiedDomain, makeCtx, resetDb } from './helpers';

const ctx = makeCtx();
beforeEach(() => resetDb(ctx));
afterAll(async () => {
  await ctx.redis.quit();
  await ctx.prisma.$disconnect();
});

const { document, operations: built } = buildOpenApi('http://localhost:5173');
type Doc = {
  paths: Record<
    string,
    Record<
      string,
      {
        operationId: string;
        summary: string;
        tags: string[];
        responses: Record<string, unknown>;
        security?: unknown[];
        parameters?: Array<{ name: string; in: string }>;
      }
    >
  >;
};
const doc = document as unknown as Doc;

// ---------------------------------------------------------------------------------------------
// 1. The document itself
// ---------------------------------------------------------------------------------------------
describe('OpenAPI document', () => {
  it('is a valid OpenAPI 3.1 document', async () => {
    const result = await new Validator().validate(JSON.parse(JSON.stringify(document)));
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('documents every operation completely and uniquely', () => {
    const ids = new Set<string>();
    let count = 0;
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        count++;
        const where = `${method.toUpperCase()} ${path}`;
        expect(op.summary, where).toBeTruthy();
        expect(op.tags?.length, where).toBeGreaterThan(0);
        expect(ids.has(op.operationId), `duplicate operationId ${op.operationId}`).toBe(false);
        ids.add(op.operationId);
        // every {param} in the path is declared
        for (const m of path.matchAll(/\{(\w+)\}/g)) {
          expect(
            op.parameters?.some((p) => p.in === 'path' && p.name === m[1]),
            `${where} declares {${m[1]}}`,
          ).toBe(true);
        }
        const authed = (op.security?.length ?? 0) > 0;
        if (authed)
          for (const code of ['401', '403', '429'])
            expect(op.responses[code], `${where} documents ${code}`).toBeTruthy();
        expect(
          Object.keys(op.responses).some((c) => c.startsWith('2')),
          `${where} documents a success response`,
        ).toBe(true);
      }
    }
    expect(count).toBe(built.length);
    expect(count).toBeGreaterThan(80);
  });

  it('describes authentication, errors, pagination and rate limits', () => {
    const info = (document.info as { description: string }).description;
    for (const needle of [
      'Bearer gs_',
      'X-CSRF-Token',
      'nextCursor',
      'Retry-After',
      'requestId',
      'approximate',
    ])
      expect(info).toContain(needle);
    const schemes = (document.components as { securitySchemes: Record<string, unknown> })
      .securitySchemes;
    expect(Object.keys(schemes).sort()).toEqual(['bearerAuth', 'cookieAuth']);
  });

  it('flat routes are API-key only; nested routes accept a session or a key; auth endpoints are public', () => {
    expect(doc.paths['/api/v1/links']!.get!.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths['/api/v1/workspaces/{workspaceId}/links']!.get!.security).toEqual([
      { cookieAuth: [] },
      { bearerAuth: [] },
    ]);
    expect(doc.paths['/api/v1/auth/login']!.post!.security).toEqual([]);
    expect(doc.paths['/api/v1/admin/stats']!.get!.security).toEqual([{ cookieAuth: [] }]);
  });

  it('never advertises secrets: API key / webhook secret fields are described as shown once', () => {
    const s = (
      document.components as {
        schemas: Record<string, { properties: Record<string, { description?: string }> }>;
      }
    ).schemas;
    expect(s.ApiKeyCreated!.properties.key!.description).toMatch(/ONLY/);
    expect(s.WebhookCreated!.properties.secret!.description).toMatch(/ONLY/);
    expect(JSON.stringify(s.ApiKey)).not.toMatch(/keyHash|"key":/);
    expect(JSON.stringify(s.Link)).not.toMatch(/passwordHash/);
  });

  it('request schemas come from the real validation schemas (limits are visible)', () => {
    const body = (p: string, m: string) =>
      (
        doc.paths[p]![m] as unknown as {
          requestBody: {
            content: {
              'application/json': {
                schema: { properties: Record<string, Record<string, unknown>> };
              };
            };
          };
        }
      ).requestBody.content['application/json'].schema.properties;
    expect(body('/api/v1/auth/register', 'post').password).toMatchObject({ minLength: 12 });
    expect(body('/api/v1/qr', 'post').size).toMatchObject({ minimum: 128, maximum: 2048 });
    expect(body('/api/v1/links', 'post').redirectStatus).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Route drift guard: documented operations == implemented routes (both directions)
// ---------------------------------------------------------------------------------------------
type Fn = (this: object, ...args: unknown[]) => unknown;
interface Collected {
  method: string;
  path: string;
}

/** Records every router.use()/route() made while building the app, then walks the mount tree. */
function collectRoutes(build: () => Express): Collected[] {
  // Router 2.x defines its methods on the prototype; instances inherit them.
  const R = (express.Router as unknown as { prototype: { use: Fn; route: Fn } }).prototype;
  const origUse = R.use;
  const origRoute = R.route;
  const edges: Array<{ parent: object; path: string; child: object }> = [];
  const routes: Array<{
    parent: object;
    path: string;
    route: { methods: Record<string, boolean> };
  }> = [];
  R.use = function (this: object, ...args: unknown[]) {
    const hasPath = typeof args[0] === 'string';
    const path = hasPath ? (args[0] as string) : '/';
    for (const a of (hasPath ? args.slice(1) : args).flat(Infinity as 1)) {
      if (typeof a === 'function' && Array.isArray((a as unknown as { stack?: unknown }).stack))
        edges.push({ parent: this, path, child: a });
    }
    return origUse.apply(this, args);
  };
  R.route = function (this: object, path: unknown) {
    const route = origRoute.call(this, path) as { methods: Record<string, boolean> };
    routes.push({ parent: this, path: String(path), route });
    return route;
  };
  let app: Express;
  try {
    app = build();
  } finally {
    R.use = origUse;
    R.route = origRoute;
  }
  const join = (a: string, b: string) =>
    ('/' + a + '/' + b).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
  const out: Collected[] = [];
  const walk = (router: object, prefix: string) => {
    for (const r of routes.filter((x) => x.parent === router)) {
      for (const m of Object.keys(r.route.methods))
        if (r.route.methods[m] && m !== '_all') out.push({ method: m, path: join(prefix, r.path) });
    }
    for (const e of edges.filter((x) => x.parent === router)) walk(e.child, join(prefix, e.path));
  };
  walk((app as unknown as { router: object }).router, '/');
  return out;
}

describe('route drift guard', () => {
  // Routes that exist but are deliberately not part of the public API reference.
  const INTERNAL = new Set([
    'get /internal/tls-check',
    'get /openapi.json',
    'get /docs',
    'get /docs/assets/init.js',
    'get /docs/assets/:file',
  ]);
  const key = (m: string, p: string) => `${m} ${p}`;

  it('every implemented route is documented, and every documented operation is implemented', () => {
    const actual = collectRoutes(() => createApp(ctx));
    expect(actual.length).toBeGreaterThan(80); // the collector really walked the tree
    const implemented = new Set(actual.map((r) => key(r.method, r.path)));
    const documented = new Set(built.map((o) => key(o.method, o.expressPath)));
    const undocumented = [...implemented]
      .filter((k) => !documented.has(k) && !INTERNAL.has(k))
      .sort();
    const missing = [...documented].filter((k) => !implemented.has(k)).sort();
    expect({ undocumented, missing }).toEqual({ undocumented: [], missing: [] });
  });

  it('catches drift: a route added without documentation would be reported', () => {
    const fake = collectRoutes(() => {
      const app = createApp(ctx);
      app.get('/api/v1/sneaky-new-route', (_q, r) => void r.end());
      return app;
    });
    const implemented = new Set(fake.map((r) => key(r.method, r.path)));
    const documented = new Set(built.map((o) => key(o.method, o.expressPath)));
    expect([...implemented].filter((k) => !documented.has(k) && !INTERNAL.has(k))).toEqual([
      'get /api/v1/sneaky-new-route',
    ]);
  });

  it('documented flat routes are exactly the ones the app mounts for API keys', () => {
    const flat = built.filter(
      (o) =>
        !o.expressPath.includes('/workspaces/') &&
        /^\/api\/v1\/(links|domains|campaigns|qr|analytics)/.test(o.expressPath),
    );
    expect(flat.length).toBe(operations.filter((o) => o.flat).length);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Real responses conform to the documented schemas
// ---------------------------------------------------------------------------------------------
describe('responses conform to the documented schemas', () => {
  const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false });
  addFormats(ajv);
  ajv.addSchema(JSON.parse(JSON.stringify(document)), 'spec');
  const pointer = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');
  const problems: string[] = [];

  /** Validate a real response body against the documented schema for (method, path, status). */
  function conforms(
    method: string,
    openApiPath: string,
    status: number,
    body: unknown,
    contentType = 'application/json',
  ) {
    const op = doc.paths[openApiPath]?.[method];
    if (!op) return problems.push(`${method.toUpperCase()} ${openApiPath} is not documented`);
    const res = op.responses[String(status)];
    if (!res)
      return problems.push(`${method.toUpperCase()} ${openApiPath} does not document ${status}`);
    const ref = `spec#/paths/${pointer(openApiPath)}/${method}/responses/${status}/content/${pointer(contentType)}/schema`;
    const validate = ajv.compile({ $ref: ref });
    if (!validate(body))
      problems.push(
        `${method.toUpperCase()} ${openApiPath} -> ${status}: ${ajv.errorsText(validate.errors, { dataVar: 'body' })}\n    body: ${JSON.stringify(body).slice(0, 400)}`,
      );
  }

  let app: Express;
  beforeAll(() => {
    app = createApp(ctx);
  });

  it('auth, workspace, member, domain, link, campaign, QR, key, webhook, admin and analytics responses match their schemas', async () => {
    problems.length = 0;
    const W = '/api/v1/workspaces/{workspaceId}';
    const agent = request.agent(app);
    const reg = await agent
      .post('/api/v1/auth/register')
      .send({ email: 'doc@example.com', name: 'Doc', password: 'correct-horse-battery' });
    conforms('post', '/api/v1/auth/register', 201, reg.body);
    const csrf = reg.body.data.csrfToken as string;
    const s = {
      get: async (p: string) => agent.get(p),
      post: async (p: string, b: object = {}) => agent.post(p).set('X-CSRF-Token', csrf).send(b),
      patch: async (p: string, b: object) => agent.patch(p).set('X-CSRF-Token', csrf).send(b),
      del: async (p: string) => agent.delete(p).set('X-CSRF-Token', csrf),
    };
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'doc@example.com', password: 'correct-horse-battery' });
    conforms('post', '/api/v1/auth/login', 200, login.body);
    conforms('get', '/api/v1/me', 200, (await s.get('/api/v1/me')).body);
    conforms('get', '/health', 200, (await request(app).get('/health')).body);
    const ready = await request(app).get('/ready');
    conforms('get', '/ready', ready.status, ready.body);
    conforms(
      'post',
      '/api/v1/auth/forgot-password',
      200,
      (await request(app).post('/api/v1/auth/forgot-password').send({ email: 'doc@example.com' }))
        .body,
    );

    // workspaces & members
    const wsRes = await s.post('/api/v1/workspaces', { name: 'Docs WS' });
    conforms('post', '/api/v1/workspaces', 201, wsRes.body);
    conforms('get', '/api/v1/workspaces', 200, (await s.get('/api/v1/workspaces')).body);
    const ws = wsRes.body.data.id as string;
    const base = `/api/v1/workspaces/${ws}`;
    conforms(
      'get',
      `${W}`.replace('/api/v1/workspaces/{workspaceId}', '/api/v1/workspaces/{workspaceId}'),
      200,
      (await s.get(base)).body,
    );
    conforms(
      'patch',
      '/api/v1/workspaces/{workspaceId}',
      200,
      (await s.patch(base, { timezone: 'Asia/Kolkata' })).body,
    );
    conforms('get', `${W}/members`, 200, (await s.get(`${base}/members`)).body);
    conforms(
      'post',
      `${W}/members/invite`,
      201,
      (await s.post(`${base}/members/invite`, { email: 'new@example.com', role: 'VIEWER' })).body,
    );
    conforms('get', `${W}/audit-logs`, 200, (await s.get(`${base}/audit-logs`)).body);

    // domains
    conforms('get', `${W}/domains`, 200, (await s.get(`${base}/domains`)).body);
    const domId = await addVerifiedDomain(
      ctx,
      { agent, csrf, userId: '', email: '' } as never,
      ws,
      'links.docs.example.com',
    );
    conforms('get', `${W}/domains/{domainId}`, 200, (await s.get(`${base}/domains/${domId}`)).body);
    const pending = await s.post(`${base}/domains`, { hostname: 'pending.docs.example.com' });
    conforms('post', `${W}/domains`, 201, pending.body);
    conforms(
      'post',
      `${W}/domains/{domainId}/verify`,
      200,
      (await s.post(`${base}/domains/${pending.body.data.id}/verify`)).body,
    );
    conforms(
      'patch',
      `${W}/domains/{domainId}`,
      200,
      (await s.patch(`${base}/domains/${domId}`, { isDefault: true })).body,
    );

    // links
    const link = await s.post(`${base}/links`, {
      destinationUrl: 'https://example.org/x',
      slug: 'docs-link',
      title: 'T',
      utmSource: 'x',
      expiresAt: '2099-01-01T00:00:00Z',
      password: 'open-sesame',
      redirectStatus: 307,
    });
    conforms('post', `${W}/links`, 201, link.body);
    const lid = link.body.data.id as string;
    conforms('get', `${W}/links`, 200, (await s.get(`${base}/links`)).body);
    conforms('get', `${W}/links/{linkId}`, 200, (await s.get(`${base}/links/${lid}`)).body);
    conforms(
      'patch',
      `${W}/links/{linkId}`,
      200,
      (await s.patch(`${base}/links/${lid}`, { title: 'T2' })).body,
    );
    conforms(
      'post',
      `${W}/links/{linkId}/disable`,
      200,
      (await s.post(`${base}/links/${lid}/disable`)).body,
    );
    conforms(
      'post',
      `${W}/links/{linkId}/enable`,
      200,
      (await s.post(`${base}/links/${lid}/enable`)).body,
    );
    conforms(
      'get',
      `${W}/links/{linkId}/analytics`,
      200,
      (await s.get(`${base}/links/${lid}/analytics?from=2026-09-01&to=2026-09-03`)).body,
    );
    conforms(
      'get',
      `${W}/analytics`,
      200,
      (
        await s.get(
          `${base}/analytics?from=2026-09-01&to=2026-09-03&timezone=Asia/Kolkata&granularity=day`,
        )
      ).body,
    );
    conforms(
      'get',
      `${W}/analytics`,
      200,
      (await s.get(`${base}/analytics?from=2026-09-01&to=2026-09-03&country=IN`)).body,
    ); // events path
    const csv = await s.get(`${base}/analytics/export?from=2026-09-01&to=2026-09-03`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(doc.paths[`${W}/analytics/export`]!.get!.responses['200']).toBeTruthy();

    // campaigns
    const camp = await s.post(`${base}/campaigns`, {
      name: 'Docs campaign',
      startDate: '2026-10-01T00:00:00Z',
      utmCampaign: 'docs',
    });
    conforms('post', `${W}/campaigns`, 201, camp.body);
    const cid = camp.body.data.id as string;
    conforms('get', `${W}/campaigns`, 200, (await s.get(`${base}/campaigns`)).body);
    conforms(
      'get',
      `${W}/campaigns/{campaignId}`,
      200,
      (await s.get(`${base}/campaigns/${cid}`)).body,
    );
    conforms(
      'patch',
      `${W}/campaigns/{campaignId}`,
      200,
      (await s.patch(`${base}/campaigns/${cid}`, { name: 'Renamed' })).body,
    );
    conforms(
      'get',
      `${W}/campaigns/{campaignId}/analytics`,
      200,
      (await s.get(`${base}/campaigns/${cid}/analytics?from=2026-09-01&to=2026-09-03`)).body,
    );

    // QR
    const logoPng = PNG.sync.write(Object.assign(new PNG({ width: 16, height: 16 }), {}));
    const logo = await agent
      .post(`${base}/qr/logos`)
      .set('X-CSRF-Token', csrf)
      .set('Content-Type', 'image/png')
      .send(logoPng);
    conforms('post', `${W}/qr/logos`, 201, logo.body);
    const qr = await s.post(`${base}/qr`, {
      name: 'Poster',
      linkId: lid,
      campaignId: cid,
      format: 'svg',
      logoPath: logo.body.data.logoPath,
    });
    conforms('post', `${W}/qr`, 201, qr.body);
    const qid = qr.body.data.id as string;
    conforms(
      'post',
      `${W}/qr`,
      201,
      (await s.post(`${base}/qr`, { name: 'PNG', linkId: lid, format: 'png' })).body,
    );
    conforms('get', `${W}/qr`, 200, (await s.get(`${base}/qr`)).body);
    conforms('get', `${W}/qr/{qrId}`, 200, (await s.get(`${base}/qr/${qid}`)).body);
    conforms(
      'patch',
      `${W}/qr/{qrId}`,
      200,
      (await s.patch(`${base}/qr/${qid}`, { name: 'Poster v2' })).body,
    );
    expect((await s.get(`${base}/qr/${qid}/image`)).headers['content-type']).toMatch(
      /image\/svg\+xml/,
    );

    // api keys & webhooks (created through the session)
    conforms('get', `${W}/api-keys`, 200, (await s.get(`${base}/api-keys`)).body);
    const key = await s.post(`${base}/api-keys`, { name: 'ci', role: 'MEMBER' });
    conforms('post', `${W}/api-keys`, 201, key.body);
    conforms('get', `${W}/api-keys`, 200, (await s.get(`${base}/api-keys`)).body);
    conforms('get', `${W}/webhooks`, 200, (await s.get(`${base}/webhooks`)).body);
    const hook = await s.post(`${base}/webhooks`, {
      url: 'https://hooks.example.com/in',
      events: ['link.created'],
    });
    conforms('post', `${W}/webhooks`, 201, hook.body);
    const hid = hook.body.data.id as string;
    conforms(
      'patch',
      `${W}/webhooks/{webhookId}`,
      200,
      (await s.patch(`${base}/webhooks/${hid}`, { isActive: false })).body,
    );
    conforms(
      'post',
      `${W}/webhooks/{webhookId}/rotate-secret`,
      200,
      (await s.post(`${base}/webhooks/${hid}/rotate-secret`)).body,
    );
    conforms(
      'post',
      `${W}/webhooks/{webhookId}/test`,
      202,
      (await s.post(`${base}/webhooks/${hid}/test`)).body,
    );

    // the same data through the flat, API-key routes
    const flat = (p: string) =>
      request(app).get(p).set('Authorization', `Bearer ${key.body.data.key}`);
    conforms('get', '/api/v1/links', 200, (await flat('/api/v1/links')).body);
    conforms('get', '/api/v1/campaigns', 200, (await flat('/api/v1/campaigns')).body);
    conforms('get', '/api/v1/qr', 200, (await flat('/api/v1/qr')).body);
    conforms(
      'get',
      '/api/v1/analytics',
      200,
      (await flat('/api/v1/analytics?from=2026-09-01&to=2026-09-03')).body,
    );
    conforms('get', '/api/v1/domains', 200, (await flat('/api/v1/domains')).body);

    // admin
    await ctx.prisma.user.updateMany({
      where: { email: 'doc@example.com' },
      data: { systemRole: 'ADMIN' },
    });
    const admin = request.agent(app);
    await admin
      .post('/api/v1/auth/login')
      .send({ email: 'doc@example.com', password: 'correct-horse-battery' });
    for (const [p, tmpl] of [
      ['/stats', '/api/v1/admin/stats'],
      ['/users', '/api/v1/admin/users'],
      ['/workspaces', '/api/v1/admin/workspaces'],
      ['/domains', '/api/v1/admin/domains'],
      ['/links', '/api/v1/admin/links'],
      ['/audit-logs', '/api/v1/admin/audit-logs'],
      ['/queues', '/api/v1/admin/queues'],
      ['/queues/analytics/failed', '/api/v1/admin/queues/{queue}/failed'],
    ] as const) {
      conforms('get', tmpl, 200, (await admin.get(`/api/v1/admin${p}`)).body);
    }

    // deletes and error envelopes
    conforms('delete', `${W}/links/{linkId}`, 200, (await s.del(`${base}/links/${lid}`)).body);
    const notFound = await s.get(`${base}/links/does-not-exist`);
    conforms('get', `${W}/links/{linkId}`, 404, notFound.body);
    conforms(
      'post',
      `${W}/links`,
      400,
      (await s.post(`${base}/links`, { destinationUrl: 'javascript:alert(1)' })).body,
    );
    conforms('get', `${W}/links`, 401, (await request(app).get(`${base}/links`)).body);
    conforms(
      'get',
      `${W}/api-keys`,
      403,
      (
        await request(app)
          .get(`${base}/api-keys`)
          .set('Authorization', `Bearer ${key.body.data.key}`)
      ).body,
    );

    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Serving the document and the UI
// ---------------------------------------------------------------------------------------------
describe('/openapi.json and /docs', () => {
  const app = createApp(ctx);

  it('serves the same document that was validated', async () => {
    const res = await request(app).get('/openapi.json').expect(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.servers).toEqual([{ url: 'http://localhost:5173' }]);
    expect(res.body.paths).toEqual(JSON.parse(JSON.stringify(document.paths)));
    expect(createHash('sha256').update(res.text).digest('hex')).toHaveLength(64);
  });

  it('serves Swagger UI from bundled assets with no external hosts and a strict CSP', async () => {
    const page = await request(app).get('/docs').expect(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.text).toContain('/docs/assets/swagger-ui-bundle.js');
    expect(page.text).not.toMatch(/https?:\/\/(?!localhost)/); // no CDN / external references
    expect(page.text).not.toMatch(/<script>[^<]/); // no inline script
    const csp = String(page.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    const js = await request(app).get('/docs/assets/swagger-ui-bundle.js').expect(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.text.length).toBeGreaterThan(100_000);
    await request(app).get('/docs/assets/swagger-ui.css').expect(200);
    const init = await request(app).get('/docs/assets/init.js').expect(200);
    expect(init.text).toContain("url: '/openapi.json'");
  });

  it('serves only whitelisted asset files (no package metadata, source maps or traversal)', async () => {
    for (const p of [
      '/docs/assets/package.json',
      '/docs/assets/swagger-ui-bundle.js.map',
      '/docs/assets/absolute-path.js',
      '/docs/assets/..%2f..%2fpackage.json',
      '/docs/assets/%2e%2e/%2e%2e/etc/passwd',
    ]) {
      const r = await request(app).get(p);
      expect([404, 400], p).toContain(r.status);
    }
  });
});
