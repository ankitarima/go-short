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
}
