import type { Request } from 'express';
import { Counter, Histogram, LATENCY_BUCKETS, type Registry } from '@go-short/shared';

export interface ApiMetrics {
  registry: Registry;
  requests: Counter<'method' | 'route' | 'status'>;
  duration: Histogram<'method' | 'route'>;
  rateLimited: Counter<'limiter'>;
  logins: Counter<'result'>;
}

export function createApiMetrics(registry: Registry): ApiMetrics {
  const r = { registers: [registry] };
  return {
    registry,
    requests: new Counter({
      name: 'goshort_http_requests_total',
      help: 'API requests by method, route pattern and status code',
      labelNames: ['method', 'route', 'status'],
      ...r,
    }),
    duration: new Histogram({
      name: 'goshort_http_request_duration_seconds',
      help: 'API request duration by method and route pattern',
      labelNames: ['method', 'route'],
      buckets: LATENCY_BUCKETS,
      ...r,
    }),
    rateLimited: new Counter({
      name: 'goshort_rate_limited_total',
      help: 'Requests rejected by a rate limiter',
      labelNames: ['limiter'],
      ...r,
    }),
    logins: new Counter({
      name: 'goshort_logins_total',
      help: 'Password login attempts by result',
      labelNames: ['result'],
      ...r,
    }),
  };
}

/**
 * Words in a mount path are route structure ("workspaces", "api-keys", "v1"); anything else is an id and
 * collapses to ":id". Ids (cuid) are 25 characters, longer than any route word, so a long all-letter id
 * can never pass for one.
 */
const WORD = /^(?:[a-z][a-z-]{0,19}|v\d{1,2})$/;

/**
 * Low-cardinality route label. Uses the matched route pattern, and normalises the mount path (which
 * contains real ids such as `/workspaces/ws_123`). Unmatched requests (404s, scanners) share one label
 * so a client cannot create unbounded series by probing random URLs.
 */
export function routeLabel(req: Pick<Request, 'baseUrl' | 'route'>): string {
  if (!req.route) return 'unmatched';
  const base = req.baseUrl
    .split('/')
    .map((seg) => (seg === '' || WORD.test(seg) ? seg : ':id'))
    .join('/');
  const path = typeof req.route.path === 'string' ? req.route.path : '';
  return base + (path === '/' ? '' : path) || '/';
}
