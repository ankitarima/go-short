import type { AnalyticsEvent } from '@go-short/shared';

/**
 * Fire-and-forget. Implementations MUST NOT throw and MUST NOT make the caller wait: analytics is
 * secondary to the redirect (see docs/analytics.md failure policy).
 */
export interface AnalyticsPublisher {
  publish(event: AnalyticsEvent): void;
}

export const noopPublisher: AnalyticsPublisher = { publish: () => undefined };
