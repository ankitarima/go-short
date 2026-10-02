import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Counter, createRegistry, metricsAuthorized, startMetricsServer } from './metrics';

describe('metricsAuthorized', () => {
  it('is open without a token and constant-time bearer otherwise', () => {
    expect(metricsAuthorized(undefined, undefined)).toBe(true);
    expect(metricsAuthorized(undefined, 'secret-token-1234')).toBe(false);
    expect(metricsAuthorized('Bearer secret-token-1234', 'secret-token-1234')).toBe(true);
    expect(metricsAuthorized('Bearer secret-token-1235', 'secret-token-1234')).toBe(false);
    expect(metricsAuthorized('Bearer short', 'secret-token-1234')).toBe(false);
    expect(metricsAuthorized('secret-token-1234', 'secret-token-1234')).toBe(false);
    expect(metricsAuthorized('Basic c2VjcmV0', 'secret-token-1234')).toBe(false);
  });
});

describe('metrics server', () => {
  const servers: Array<{ close: () => void }> = [];
  afterEach(() => servers.splice(0).forEach((s) => s.close()));

  async function start(token?: string) {
    const registry = createRegistry('test', false);
    new Counter({ name: 'demo_total', help: 'demo', registers: [registry] }).inc(3);
    const server = startMetricsServer({ registry, host: '127.0.0.1', port: 0, token });
    servers.push(server);
    await new Promise((r) => server.once('listening', r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('serves Prometheus text with the service label, on /metrics only', async () => {
    const base = await start();
    const res = await fetch(`${base}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('demo_total{service="test"} 3');
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/health`)).status).toBe(404);
    expect((await fetch(`${base}/metrics`, { method: 'POST' })).status).toBe(405);
  });

  it('requires the bearer token when one is configured', async () => {
    const base = await start('scrape-token-0123456789');
    const denied = await fetch(`${base}/metrics`);
    expect(denied.status).toBe(401);
    expect(await denied.text()).not.toContain('demo_total');
    const ok = await fetch(`${base}/metrics`, {
      headers: { Authorization: 'Bearer scrape-token-0123456789' },
    });
    expect(ok.status).toBe(200);
  });
});
