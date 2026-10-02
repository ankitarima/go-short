import { randomUUID } from 'node:crypto';
import { ANALYTICS_JOB_OPTIONS, type AnalyticsBatch, type AnalyticsEvent } from '@go-short/shared';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import type { PublishEvent } from './metrics';
import type { AnalyticsPublisher } from './publisher';

interface Options {
  queue: Pick<Queue<AnalyticsBatch>, 'add'>;
  logger: Logger;
  flushMs: number;
  batchMax: number;
  bufferMax: number;
  onEvent?: (event: PublishEvent, count: number) => void;
}

/**
 * Buffers click events in memory and enqueues them as batches (one BullMQ job per batch).
 *
 * Why batch: one job per click would cost several Redis round trips per redirect; one job per
 * ~250 ms or 500 events is ~100x fewer operations at burst rates.
 *
 * Failure policy (analytics is secondary to redirects):
 *  - publish() is synchronous, O(1) and never throws or waits.
 *  - If the queue is unreachable, events stay buffered and are retried; memory is bounded by
 *    `bufferMax`, beyond which the OLDEST events are dropped (and counted/logged).
 *  - A crash can lose at most the unflushed buffer (~one flush interval) - accepted tradeoff.
 */
export class BullmqPublisher implements AnalyticsPublisher {
  private buffer: AnalyticsEvent[] = [];
  private timer: NodeJS.Timeout | undefined;
  private flushing = false;
  private retryNotBefore = 0;
  private lastErrLog = 0;
  dropped = 0;

  constructor(private readonly o: Options) {}

  publish(event: AnalyticsEvent): void {
    this.buffer.push(event);
    this.enforceCap();
    if (this.buffer.length >= this.o.batchMax) {
      if (Date.now() >= this.retryNotBefore) void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, this.o.flushMs);
      this.timer.unref();
    }
  }

  /** Keeps memory bounded: drops the OLDEST events (in chunks, not one by one) once over the cap. */
  private enforceCap(): void {
    if (this.buffer.length <= this.o.bufferMax) return;
    const drop = this.buffer.length - this.o.bufferMax + this.o.batchMax;
    this.buffer.splice(0, drop);
    this.dropped += drop;
    this.o.onEvent?.('dropped', drop);
    this.o.logger.error(
      { dropped: this.dropped, bufferMax: this.o.bufferMax },
      'analytics buffer full, dropped oldest events',
    );
  }

  get pending(): number {
    return this.buffer.length;
  }

  /** Sends at most one batch; on failure the events go back to the head of the buffer. */
  async flush(): Promise<boolean> {
    if (this.flushing || this.buffer.length === 0) return true;
    this.flushing = true;
    const events = this.buffer.splice(0, this.o.batchMax);
    try {
      const batchId = randomUUID();
      await this.o.queue.add(
        'batch',
        { batchId, events },
        { ...ANALYTICS_JOB_OPTIONS, jobId: batchId },
      );
      this.retryNotBefore = 0; // healthy again: clear the failure backoff
      this.o.onEvent?.('published', events.length);
      return true;
    } catch (err) {
      this.buffer.unshift(...events);
      this.o.onEvent?.('failed', 1);
      this.enforceCap(); // in-flight events returning to the buffer must not break the memory bound
      this.retryNotBefore = Date.now() + 1000; // do not hammer a down Redis on every publish
      const t = Date.now();
      if (t - this.lastErrLog > 5000) {
        this.lastErrLog = t;
        this.o.logger.error(
          { err, pending: this.buffer.length },
          'analytics enqueue failed; events buffered for retry',
        );
      }
      this.rearm();
      return false;
    } finally {
      this.flushing = false;
      // More than one batch waiting (burst): keep draining without waiting for the timer.
      if (this.buffer.length >= this.o.batchMax && Date.now() >= this.retryNotBefore)
        void this.flush();
      // A partial batch can remain (e.g. the tail after an outage); make sure it is not stranded
      // until the next click happens to arrive.
      else this.rearm();
    }
  }

  private rearm(): void {
    if (!this.timer && this.buffer.length > 0) {
      // Back off to >= 1 s while failing; otherwise use the normal flush interval.
      const delay =
        Date.now() < this.retryNotBefore ? Math.max(this.o.flushMs, 1000) : this.o.flushMs;
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, delay);
      this.timer.unref();
    }
  }

  /** Graceful shutdown: try to drain the buffer, bounded by a deadline. */
  async close(deadlineMs = 5000): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const end = Date.now() + deadlineMs;
    while (this.buffer.length > 0 && Date.now() < end) {
      if (!(await this.flush())) break;
    }
    if (this.buffer.length > 0) {
      this.o.logger.error(
        { lost: this.buffer.length },
        'shutdown with undelivered analytics events',
      );
    }
  }
}
