/** BullMQ queue names shared by the redirect service (producer) and the worker (consumer). */
export const QUEUES = {
  analyticsEvents: 'analytics-events',
  analyticsAggregation: 'analytics-aggregation',
  cleanup: 'cleanup',
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

/** Default BullMQ options for analytics jobs: bounded retries, then kept for inspection (dead letter). */
export const ANALYTICS_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 14 * 24 * 3600, count: 10_000 },
};
