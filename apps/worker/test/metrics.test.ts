import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createWorkerMetrics } from '../src/metrics';
import { createRegistry } from '@go-short/shared';

/** A stand-in with the same event surface; `emit` is untyped so tests can send any payload. */
const fakeWorker = () => {
  const e = new EventEmitter();
  return Object.assign(e as unknown as import('bullmq').Worker, {
    send: (event: string, ...args: unknown[]) => e.emit(event, ...args),
  });
};
const values = async (m: ReturnType<typeof createWorkerMetrics>, name: string) =>
  (await m.registry.getMetricsAsJSON()).find((x) => x.name === name)?.values ?? [];
const find = (
  vals: Array<{ value: number; labels: Record<string, unknown> }>,
  l: Record<string, string>,
) => vals.find((v) => Object.entries(l).every(([k, x]) => v.labels[k] === x))?.value ?? 0;

describe('worker metrics', () => {
  it('counts analytics batches and event outcomes from job results', async () => {
    const m = createWorkerMetrics(createRegistry('worker', false));
    const w = fakeWorker();
    m.watchAnalytics(w);
    w.send('active', { id: '1' });
    w.send('completed', { id: '1' }, { received: 10, invalid: 1, duplicates: 2, inserted: 7 });
    w.send('failed', { id: '2' }, new Error('boom'));
    const batches = await values(m, 'goshort_analytics_batches_total');
    expect(find(batches, { result: 'ok' })).toBe(1);
    expect(find(batches, { result: 'failed' })).toBe(1);
    const events = await values(m, 'goshort_analytics_events_total');
    expect(find(events, { outcome: 'inserted' })).toBe(7);
    expect(find(events, { outcome: 'duplicate' })).toBe(2);
    expect(find(events, { outcome: 'invalid' })).toBe(1);
    expect((await values(m, 'goshort_analytics_batch_duration_seconds')).length).toBeGreaterThan(0);
  });

  it('separates delivered, skipped and failed webhooks, and labels cleanup by task', async () => {
    const m = createWorkerMetrics(createRegistry('worker', false));
    const hooks = fakeWorker();
    m.watchWebhooks(hooks);
    hooks.send('completed', {}, { delivered: true });
    hooks.send('completed', {}, { delivered: false, skipped: 'webhook deleted' });
    hooks.send('failed', {}, new Error('x'));
    const wh = await values(m, 'goshort_webhook_jobs_total');
    expect([
      find(wh, { result: 'delivered' }),
      find(wh, { result: 'skipped' }),
      find(wh, { result: 'failed' }),
    ]).toEqual([1, 1, 1]);

    const cleanup = fakeWorker();
    m.watchCleanup(cleanup);
    cleanup.send('completed', { data: { task: 'sessions' } });
    cleanup.send('failed', { data: { task: 'retention' } }, new Error('x'));
    const c = await values(m, 'goshort_cleanup_runs_total');
    expect(find(c, { task: 'sessions', result: 'ok' })).toBe(1);
    expect(find(c, { task: 'retention', result: 'failed' })).toBe(1);
  });

  it('reads queue depth at scrape time and survives Redis being down', async () => {
    const m = createWorkerMetrics(createRegistry('worker', false));
    let down = false;
    m.watchQueues({
      analytics: {
        getJobCounts: async () => {
          if (down) throw new Error('ECONNREFUSED');
          return { waiting: 5, active: 2, delayed: 0, failed: 1 };
        },
      },
    });
    let q = await values(m, 'goshort_queue_jobs');
    expect(find(q, { queue: 'analytics', state: 'waiting' })).toBe(5);
    expect(find(q, { queue: 'analytics', state: 'failed' })).toBe(1);
    down = true;
    q = await values(m, 'goshort_queue_jobs'); // must not throw
    expect(find(q, { queue: 'analytics', state: 'waiting' })).toBe(5); // last known value
  });
});
