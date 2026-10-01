import { QUEUES, type AnalyticsBatch } from '@go-short/shared';
import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { BatchProcessor } from './processBatch';

/** Consumes analytics batches. Shared by the production entrypoint and the pipeline tests. */
export function createAnalyticsWorker(o: {
  connection: Redis; // must be created with maxRetriesPerRequest: null (BullMQ blocking commands)
  processor: BatchProcessor;
  concurrency: number;
  logger: Logger;
}): Worker<AnalyticsBatch> {
  const worker = new Worker<AnalyticsBatch>(
    QUEUES.analyticsEvents,
    async (job) => {
      const started = Date.now();
      const result = await o.processor.process(job.data.events);
      o.logger.debug(
        { jobId: job.id, ...result, ms: Date.now() - started },
        'analytics batch processed',
      );
      return result;
    },
    { connection: o.connection, concurrency: o.concurrency },
  );
  worker.on('failed', (job, err) =>
    o.logger.error(
      { jobId: job?.id, attemptsMade: job?.attemptsMade, err: err.message },
      'analytics job failed',
    ),
  );
  worker.on('error', (err) => o.logger.error({ err }, 'worker error'));
  return worker;
}
