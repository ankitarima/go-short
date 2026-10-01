import { z } from 'zod';
import { ROLE_PERMISSIONS } from '@go-short/shared';
import { type Op, minimumRole, operations } from './operations';
import { envelope, paged, ref, schemas } from './schemas';

type S = Record<string, unknown>;

const strip = (s: S): S => {
  const { $schema: _omit, ...rest } = s;
  void _omit;
  return rest;
};
const toJson = (schema: z.ZodType): S =>
  strip(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as S);

const GUIDE = `
Go-Short is a self-hosted URL shortener, QR code and campaign analytics platform. This is the reference for its HTTP API.

## Authentication
Two ways to call the API:

* **API key** (for scripts and integrations): \`Authorization: Bearer gs_xxxxxxxx_...\`. A key belongs to **one workspace** and is either \`VIEWER\` (read-only) or \`MEMBER\` (read/write). Use the **flat routes** (\`/api/v1/links\`, \`/api/v1/analytics\`, ...): the workspace is the key's own. Keys can also call the nested \`/workspaces/{workspaceId}/...\` routes for their own workspace only. Keys are created in the app (Settings → API keys), are shown **once**, and can be revoked at any time. API keys can never manage keys, members, domains or webhooks, and cannot call user-level endpoints (\`/me\`, listing workspaces, ...).
* **Session cookie** (used by the web app): sign in with \`POST /auth/login\`; send the returned \`csrfToken\` in the \`X-CSRF-Token\` header on every unsafe request (\`POST\`, \`PATCH\`, \`DELETE\`). Nested \`/workspaces/{workspaceId}/...\` routes are available; access is decided by your membership role.

## Roles and permissions
\`OWNER\` > \`ADMIN\` > \`MEMBER\` > \`VIEWER\`. Each operation lists the permission it needs and the lowest role that has it. Users who are not members of a workspace get \`404\` (its existence is not revealed).

## Responses and errors
Successful responses are \`{ "success": true, "data": ... }\`. Errors are
\`{ "success": false, "error": { "code": "LINK_NOT_FOUND", "message": "...", "details": [...] }, "requestId": "req_..." }\`
with an HTTP status of 400 (validation), 401 (not authenticated), 403 (forbidden / CSRF / feature disabled), 404, 409 (conflict), 413, 415, 429 (rate limited) or 5xx. Quote the \`requestId\` (also the \`X-Request-Id\` header) when reporting problems.

## Pagination
List endpoints use **cursor pagination**: \`?limit=50&cursor=...\` (limit 1-100, default 50). The response includes \`nextCursor\`; pass it back as \`cursor\` until it is \`null\`. Never assume a list is complete from one page.

## Rate limits
Fixed windows, enforced per client. Limited responses are \`429\` with \`Retry-After\`. Authentication endpoints: 10 attempts / 15 minutes / IP. API keys: 600 requests / minute / key by default (operator-configurable) with \`RateLimit-Limit\` and \`RateLimit-Remaining\` headers. Link creation 120/min and QR creation 60/min per workspace. Other limits are noted per operation.

## Analytics accuracy
Unique visitors are **approximate** (hash of a day-salted IP and user agent; over several days they are the sum of daily uniques). Bot detection is heuristic. GeoIP is approximate. Referrers are often missing. Timelines are exact in the requested timezone; other figures are aggregated by UTC day (see \`meta.notes\`). Operators are responsible for compliance with the privacy laws that apply to them.
`;

const TAGS = [
  { name: 'Health', description: 'Liveness and readiness probes.' },
  { name: 'Auth', description: 'Accounts and sessions.' },
  { name: 'Workspaces', description: 'Workspaces and their privacy/retention settings.' },
  { name: 'Members', description: 'Team members, roles and invitations.' },
  {
    name: 'Domains',
    description: 'The shared short domain and custom domains (CNAME/TXT verification).',
  },
  {
    name: 'Links',
    description: 'Short links: random or custom slugs, UTM, expiry, passwords, enable/disable.',
  },
  {
    name: 'Campaigns',
    description: 'Campaigns group links and QR codes and roll their analytics together.',
  },
  {
    name: 'QR codes',
    description: 'Locally generated QR codes (SVG/PNG) that point at short links.',
  },
  {
    name: 'Analytics',
    description:
      'Clicks over time, visitors, countries, devices, browsers, OS, referrers, UTM and QR scans. Filter by `from`/`to` (local dates in `timezone`), `linkId`, `campaignId`, `country`, `device` and `includeBots`. Country/device filters are limited to 31 days; ranges to 366 days (hourly: 14). CSV export is streamed.',
  },
  { name: 'API keys', description: 'Create and revoke workspace API keys (signed-in users only).' },
  {
    name: 'Webhooks',
    description:
      'Signed event notifications. Events: `link.created`, `link.updated`, `link.deleted`, `campaign.created`, `domain.verified`. Deliveries carry `X-GoShort-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`; verify it in constant time and reject old timestamps. Failures are retried with exponential backoff.',
  },
  {
    name: 'Admin',
    description:
      'Platform operator endpoints. Require a signed-in system administrator; API keys are refused.',
  },
];

const errorRef = (description: string) => ({
  description,
  content: { 'application/json': { schema: ref('Error') } },
});

export interface BuiltOperation {
  method: Op['method'];
  /** Express-style path, e.g. /api/v1/links/:linkId */
  expressPath: string;
  openApiPath: string;
}

function paramsFromPath(path: string) {
  return [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
    name: m[1]!,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

function queryParams(schema: z.ZodType): S[] {
  const js = toJson(schema) as { properties?: Record<string, S>; required?: string[] };
  return Object.entries(js.properties ?? {}).map(([name, s]) => ({
    name,
    in: 'query',
    required: (js.required ?? []).includes(name),
    schema: s,
  }));
}

function buildOp(op: Op, mode: 'session' | 'nested' | 'flat', openApiPath: string): S {
  const unsafe = op.method !== 'get';
  const permission = op.permission
    ? `${op.permission} (${minimumRole(op.permission)} and above)`
    : undefined;
  const parameters: S[] = [...paramsFromPath(openApiPath)];
  if (op.query) parameters.push(...queryParams(op.query));
  if (op.scope !== 'public' && mode !== 'flat' && unsafe)
    parameters.push({ $ref: '#/components/parameters/CsrfToken' });

  const isList = op.response?.type === 'array';
  const hasCursor = op.query ? 'cursor' in ((toJson(op.query).properties as object) ?? {}) : false;
  const dataSchema = op.response
    ? isList
      ? hasCursor
        ? paged(op.response.items as S)
        : envelope(op.response)
      : op.bare
        ? op.response
        : envelope(op.response)
    : undefined;

  const status = String(op.status ?? 200);
  const responses: Record<string, S> = {};
  if (op.binary) {
    responses[status] = {
      description: op.binary.description,
      content: Object.fromEntries(
        op.binary.contentTypes.map((t) => [t, { schema: { type: 'string', format: 'binary' } }]),
      ),
    };
  } else if (dataSchema) {
    responses[status] = {
      description: status === '201' ? 'Created' : status === '202' ? 'Accepted' : 'OK',
      content: { 'application/json': { schema: dataSchema } },
    };
  }
  if (op.path === '/ready')
    responses['503'] = {
      description: 'A dependency is unavailable',
      content: { 'application/json': { schema: ref('Ready') } },
    };
  if (op.scope !== 'public' || op.body) responses['400'] = errorRef('Validation error');
  if (op.scope !== 'public') {
    responses['401'] = errorRef('Not authenticated, or the API key is invalid, revoked or expired');
    responses['403'] = errorRef('Not permitted, CSRF token missing/invalid, or a disabled feature');
    responses['429'] = {
      ...errorRef('Rate limited'),
      headers: { 'Retry-After': { $ref: '#/components/headers/RetryAfter' } },
    };
  } else if (op.path.startsWith('/auth')) {
    responses['401'] = errorRef('Invalid credentials');
    responses['429'] = {
      ...errorRef('Too many attempts'),
      headers: { 'Retry-After': { $ref: '#/components/headers/RetryAfter' } },
    };
  }
  if (parameters.some((p) => p.in === 'path') || op.scope === 'workspace')
    responses['404'] = errorRef('Not found (or not visible to you)');

  const security =
    op.scope === 'public'
      ? []
      : op.scope === 'workspace'
        ? mode === 'flat'
          ? [{ bearerAuth: [] }]
          : [{ cookieAuth: [] }, { bearerAuth: [] }]
        : [{ cookieAuth: [] }];

  const sessionOnly =
    op.scope === 'workspace' &&
    /\/(api-keys|webhooks)|\/members\/\{memberId\}$|\/audit-logs$/.test(openApiPath) &&
    !openApiPath.endsWith('/members');
  const description = [
    op.description,
    permission ? `**Required permission:** \`${permission}\`.` : undefined,
    op.scope === 'admin' ? '**Requires a system administrator (session only).**' : undefined,
    op.scope === 'session' ? '**Session only:** API keys are refused.' : undefined,
    sessionOnly ? '**Session only:** API keys are refused.' : undefined,
    mode === 'flat' ? 'Flat route: the workspace is the API key’s own workspace.' : undefined,
  ]
    .filter(Boolean)
    .join('\n\n');

  const requestBody = op.body
    ? { required: true, content: { 'application/json': { schema: toJson(op.body) } } }
    : op.rawBody
      ? {
          required: true,
          description: op.rawBody.description,
          content: Object.fromEntries(
            op.rawBody.contentTypes.map((t) => [
              t,
              { schema: { type: 'string', format: 'binary' } },
            ]),
          ),
        }
      : undefined;

  return {
    tags: [op.tag],
    summary: op.summary,
    ...(description ? { description } : {}),
    operationId: `${op.method}${openApiPath.replace(/\{(\w+)\}/g, 'By_$1').replace(/[^A-Za-z0-9_]+/g, '_')}${mode === 'flat' ? '_flat' : ''}`,
    security,
    ...(parameters.length ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses,
  };
}

/** Builds the OpenAPI 3.1 document and the list of (method, express path) pairs it documents. */
export function buildOpenApi(serverUrl: string): { document: S; operations: BuiltOperation[] } {
  const paths: Record<string, Record<string, S>> = {};
  const built: BuiltOperation[] = [];
  const add = (path: string, op: Op, mode: 'session' | 'nested' | 'flat', expressPath: string) => {
    (paths[path] ??= {})[op.method] = buildOp(op, mode, path);
    built.push({ method: op.method, openApiPath: path, expressPath });
  };
  const toExpress = (p: string) => p.replace(/\{(\w+)\}/g, ':$1');

  for (const op of operations) {
    if (op.scope === 'public' && (op.path === '/health' || op.path === '/ready')) {
      add(op.path, op, 'session', op.path);
    } else if (op.scope === 'workspace' && !op.path.startsWith('/workspaces/')) {
      const nested = `/api/v1/workspaces/{workspaceId}${op.path}`;
      add(nested, op, 'nested', toExpress(nested));
      if (op.flat) add(`/api/v1${op.path}`, op, 'flat', toExpress(`/api/v1${op.path}`));
    } else {
      const full = `/api/v1${op.path}`;
      add(full, op, 'session', toExpress(full));
    }
  }

  const rolesText = Object.fromEntries(
    Object.entries(ROLE_PERMISSIONS).map(([r, set]) => [r, [...set]]),
  );
  const document: S = {
    openapi: '3.1.0',
    info: {
      title: 'Go-Short API',
      version: '1.0.0',
      description: GUIDE,
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: serverUrl }],
    tags: TAGS,
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'gs_<prefix>_<secret>',
          description: 'Workspace API key.',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'gs_session',
          description:
            'Session cookie set by POST /auth/login. Unsafe requests must also send X-CSRF-Token.',
        },
      },
      parameters: {
        CsrfToken: {
          name: 'X-CSRF-Token',
          in: 'header',
          required: false,
          description:
            'Required for unsafe requests (POST/PATCH/DELETE) authenticated with the session cookie; not used with API keys.',
          schema: { type: 'string' },
        },
      },
      headers: {
        RetryAfter: {
          description: 'Seconds to wait before retrying.',
          schema: { type: 'integer' },
        },
      },
    },
    'x-permissions-by-role': rolesText,
  };
  return { document, operations: built };
}
