import { timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { Registry, collectDefaultMetrics } from 'prom-client';

export { Counter, Gauge, Histogram, Registry } from 'prom-client';

/** Latency buckets (seconds) from sub-millisecond redirects to slow API calls. */
export const LATENCY_BUCKETS = [
  0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
];

/** One registry per process (never the global one), labelled with the service name. */
export function createRegistry(service: string, defaults = true): Registry {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  if (defaults) collectDefaultMetrics({ register: registry });
  return registry;
}

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Constant-time check of `Authorization: Bearer <token>`. No token configured means open. */
export function metricsAuthorized(header: string | undefined, token: string | undefined): boolean {
  if (!token) return true;
  const m = /^Bearer (.+)$/.exec(header ?? '');
  return !!m && safeEqual(m[1]!, token);
}

export interface MetricsServerOptions {
  registry: Registry;
  host: string;
  port: number;
  token?: string | undefined;
  onError?: (err: unknown) => void;
}

/**
 * A tiny HTTP server that serves only `GET /metrics`, on its own port. Keeping it off the public
 * listener means a reverse proxy can never expose it by accident.
 */
export function startMetricsServer(o: MetricsServerOptions): Server {
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/metrics') return void res.writeHead(404).end();
    if (req.method !== 'GET') return void res.writeHead(405, { Allow: 'GET' }).end();
    if (!metricsAuthorized(req.headers.authorization, o.token)) {
      return void res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();
    }
    o.registry.metrics().then(
      (body) => {
        res.writeHead(200, {
          'Content-Type': o.registry.contentType,
          'Cache-Control': 'no-store',
        });
        res.end(body);
      },
      (err) => {
        o.onError?.(err);
        res.writeHead(500).end();
      },
    );
  });
  server.on('error', (err) => o.onError?.(err));
  server.listen(o.port, o.host);
  return server;
}
