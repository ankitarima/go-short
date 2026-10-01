import { QUEUES } from '@go-short/shared';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  CLEANUP_SCHEDULE,
  CLEANUP_TASKS,
  type CleanupDeps,
  type CleanupTask,
  runCleanup,
} from './cleanup';

/** Registers (idempotently) one repeatable job per task. Safe to call on every worker start. */
export async function scheduleCleanup(queue: Pick<Queue, 'upsertJobScheduler'>): Promise<void> {
  for (const task of CLEANUP_TASKS) {
    await queue.upsertJobScheduler(
      `cleanup:${task}`,
      { pattern: CLEANUP_SCHEDULE[task], tz: 'UTC' },
      {
        name: 'cleanup',
        data: { task },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { age: 86_400, count: 100 },
          removeOnFail: { age: 14 * 86_400 },
        },
      },
    );
  }
}

export function createCleanupWorker(o: {
  connection: Redis;
  deps: CleanupDeps;
}): Worker<{ task: CleanupTask }> {
  const worker = new Worker<{ task: CleanupTask }>(
    QUEUES.cleanup,
    async (job) => {
      if (!(CLEANUP_TASKS as readonly string[]).includes(job.data.task))
        throw new Error(`Unknown cleanup task: ${job.data.task}`);
      return runCleanup(o.deps, job.data.task);
    },
    { connection: o.connection, concurrency: 1 }, // one cleanup at a time: they are background work, not latency-sensitive
  );
  worker.on('failed', (job, err) =>
    o.deps.logger.error({ task: job?.data.task, err: err.message }, 'cleanup job failed'),
  );
  return worker;
}
