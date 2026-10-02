import { Counter, Gauge, Histogram, createRegistry, type Registry } from '@go-short/shared';
import type { Queue, Worker } from 'bullmq';

const SLOW_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
const STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

export interface WorkerMetrics {
  registry: Registry;
  /** Subscribes to job events; call once per worker. */
  watchAnalytics(worker: Worker): void;
  watchWebhooks(worker: Worker): void;
  watchCleanup(worker: Worker): void;
  /** Queue depth is read from Redis when Prometheus scrapes, not on a timer. */
  watchQueues(queues: Record<string, Pick<Queue, 'getJobCounts'>>): void;
}

export function createWorkerMetrics(registry: Registry = createRegistry('worker')): WorkerMetrics {
  const r = { registers: [registry] };
  const batches = new Counter({
    name: 'goshort_analytics_batches_total',
    help: 'Analytics batches processed by result',
    labelNames: ['result'],
    ...r,
  });
  const events = new Counter({
    name: 'goshort_analytics_events_total',
    help: 'Click events seen by the worker by outcome (inserted, duplicate, invalid)',
    labelNames: ['outcome'],
    ...r,
  });
  const duration = new Histogram({
    name: 'goshort_analytics_batch_duration_seconds',
    help: 'Time to process one analytics batch',
    buckets: SLOW_BUCKETS,
    ...r,
  });
  const webhooks = new Counter({
    name: 'goshort_webhook_jobs_total',
    help: 'Webhook delivery attempts by result (delivered, skipped, failed)',
    labelNames: ['result'],
    ...r,
  });
  const cleanup = new Counter({
    name: 'goshort_cleanup_runs_total',
    help: 'Scheduled cleanup task runs by task and result',
    labelNames: ['task', 'result'],
    ...r,
  });
  const timers = (worker: Worker) => {
    const started = new Map<string, bigint>();
    worker.on('active', (job) => started.set(String(job.id), process.hrtime.bigint()));
    return (id: string | undefined): number | undefined => {
      const t = id === undefined ? undefined : started.get(id);
      if (t === undefined) return undefined;
      started.delete(id!);
      return Number(process.hrtime.bigint() - t) / 1e9;
    };
  };

  return {
    registry,
    watchAnalytics(worker) {
      const took = timers(worker);
      worker.on('completed', (job, result: unknown) => {
        batches.inc({ result: 'ok' });
        const s = took(job.id);
        if (s !== undefined) duration.observe(s);
        const x = result as { inserted?: number; duplicates?: number; invalid?: number };
        events.inc({ outcome: 'inserted' }, x.inserted ?? 0);
        events.inc({ outcome: 'duplicate' }, x.duplicates ?? 0);
        events.inc({ outcome: 'invalid' }, x.invalid ?? 0);
      });
      worker.on('failed', (job) => {
        batches.inc({ result: 'failed' });
        took(job?.id);
      });
    },
    watchWebhooks(worker) {
      worker.on('completed', (_job, result: unknown) => {
        const x = result as { delivered?: boolean };
        webhooks.inc({ result: x?.delivered ? 'delivered' : 'skipped' });
      });
      worker.on('failed', () => webhooks.inc({ result: 'failed' }));
    },
    watchCleanup(worker) {
      worker.on('completed', (job) => cleanup.inc({ task: String(job.data?.task), result: 'ok' }));
      worker.on('failed', (job) =>
        cleanup.inc({ task: String(job?.data?.task ?? 'unknown'), result: 'failed' }),
      );
    },
    watchQueues(queues) {
      new Gauge({
        name: 'goshort_queue_jobs',
        help: 'Jobs per queue and state (failed = retained failed jobs awaiting inspection)',
        labelNames: ['queue', 'state'],
        async collect() {
          for (const [name, q] of Object.entries(queues)) {
            try {
              const counts = await q.getJobCounts(...STATES);
              for (const state of STATES) this.set({ queue: name, state }, counts[state] ?? 0);
            } catch {
              // Redis unreachable: leave the last values; goshort_up-style alerts catch the outage.
            }
          }
        },
        ...r,
      });
    },
  };
}
