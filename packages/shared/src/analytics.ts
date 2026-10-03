/** BullMQ queue names shared by the redirect service (producer) and the worker (consumer). */
export const QUEUES = {
  analyticsEvents: 'analytics-events',
  analyticsAggregation: 'analytics-aggregation',
  cleanup: 'cleanup',
  webhooks: 'webhooks',
} as const;

/**
 * Raw click event published by the redirect service. Deliberately unprocessed: UA parsing, GeoIP,
 * bot detection and IP hashing all happen in the worker. `ip` exists only in the queue payload and
 * is never persisted.
 */
export interface AnalyticsEvent {
  eventId: string;
  linkId: string;
  workspaceId: string;
  campaignId: string | null;
  /** Unix epoch milliseconds (UTC). */
  timestamp: number;
  ip: string;
  userAgent: string | null;
  referer: string | null;
  acceptLanguage: string | null;
  forwardedFor: string | null;
  /** QR code id from the `?qr=` marker on QR-encoded URLs; validated by the worker, never trusted. */
  qrId?: string | null;
}

/** One queue job = one batch of events (the redirect service buffers and flushes in batches). */
export interface AnalyticsBatch {
  batchId: string;
  events: AnalyticsEvent[];
}

/**
 * Default BullMQ options for analytics jobs: bounded retries, then kept for inspection (dead letter).
 *
 * A job's payload holds RAW client IPs, so a finished job must not linger: `removeOnComplete: true`
 * deletes it the moment its batch is stored. (Measured in the phase 17 load tests: retaining the last
 * 1,000 completed jobs held about 200 MB in Valkey, rewrote it into every persistence snapshot, and kept
 * raw IPs for up to an hour.) Failed jobs are kept so they can be inspected and retried, but capped: a
 * long database outage must not turn into unbounded queue memory.
 */
export const ANALYTICS_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: true,
  removeOnFail: { age: 14 * 24 * 3600, count: 500 },
};

/** Scheduled/manual maintenance tasks run by the worker's `cleanup` queue. */
export const CLEANUP_TASKS = [
  'sessions',
  'stale-domains',
  'click-retention',
  'visitors-and-buckets',
  'audit-logs',
  'expired-links',
  'orphan-logos',
  'failed-jobs',
] as const;
export type CleanupTask = (typeof CLEANUP_TASKS)[number];
