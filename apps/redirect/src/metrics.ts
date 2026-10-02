import {
  Counter,
  Gauge,
  Histogram,
  LATENCY_BUCKETS,
  createRegistry,
  type Registry,
} from '@go-short/shared';

export type RedirectOutcome =
  | 'redirect'
  | 'password_page'
  | 'not_found'
  | 'disabled'
  | 'expired'
  | 'unavailable'
  | 'unsafe_destination'
  | 'bad_host'
  | 'unlock_success'
  | 'unlock_wrong_password'
  | 'unlock_rate_limited'
  | 'unlock_unavailable';

export type CacheResult = 'hit' | 'negative_hit' | 'miss' | 'redis_error';
export type PublishEvent = 'published' | 'failed' | 'dropped';

export interface RedirectMetrics {
  registry: Registry;
  requests: Counter<'outcome'>;
  cache: Counter<'result'>;
  duration: Histogram;
  analytics: Counter<'event'>;
}

/** `pending` is read at scrape time: how many click events are buffered in this process right now. */
export function createRedirectMetrics(
  registry: Registry = createRegistry('redirect', false),
  pending: () => number = () => 0,
): RedirectMetrics {
  const r = { registers: [registry] };
  new Gauge({
    name: 'goshort_analytics_buffered_events',
    help: 'Click events waiting in memory to be queued (non-zero for long means the queue is unreachable)',
    collect() {
      this.set(pending());
    },
    ...r,
  });
  return {
    registry,
    requests: new Counter({
      name: 'goshort_redirect_requests_total',
      help: 'Redirect-service responses by outcome',
      labelNames: ['outcome'],
      ...r,
    }),
    cache: new Counter({
      name: 'goshort_redirect_cache_total',
      help: 'Link lookups by cache result (miss = served from Postgres)',
      labelNames: ['result'],
      ...r,
    }),
    duration: new Histogram({
      name: 'goshort_redirect_duration_seconds',
      help: 'Time to resolve and answer a short-link GET (excludes network time)',
      buckets: LATENCY_BUCKETS,
      ...r,
    }),
    analytics: new Counter({
      name: 'goshort_analytics_publish_total',
      help: 'Click-event publishing: events published or dropped from a full buffer, and failed enqueue attempts',
      labelNames: ['event'],
      ...r,
    }),
  };
}
