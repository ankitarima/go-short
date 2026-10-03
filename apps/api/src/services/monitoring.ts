import { AppError } from '@go-short/shared';
import type { AppContext } from '../context';

/**
 * Platform metrics for the console. Prometheus is never exposed to the browser: the API runs a fixed
 * set of NAMED queries (no client-supplied PromQL), so staff get charts without a query console that
 * could be used to read or overload anything else.
 */
export interface MetricDef {
  name: string;
  label: string;
  unit: 'rps' | 'ms' | 'percent' | 'count' | 'per_minute';
  query: string;
}

export const METRICS: readonly MetricDef[] = [
  {
    name: 'redirects_per_second',
    label: 'Redirects per second',
    unit: 'rps',
    query: 'sum(rate(goshort_redirect_requests_total{outcome=~"redirect|unlock_success"}[1m]))',
  },
  {
    name: 'redirect_p95_ms',
    label: 'Redirect p95 handling time',
    unit: 'ms',
    query:
      'histogram_quantile(0.95, sum by (le) (rate(goshort_redirect_duration_seconds_bucket[5m]))) * 1000',
  },
  {
    name: 'redirect_backend_errors',
    label: 'Redirects failing on backend errors',
    unit: 'percent',
    query:
      '100 * sum(rate(goshort_redirect_requests_total{outcome="unavailable"}[5m])) / clamp_min(sum(rate(goshort_redirect_requests_total[5m])), 0.001)',
  },
  {
    name: 'cache_hit_ratio',
    label: 'Redirect cache hit ratio',
    unit: 'percent',
    query:
      '100 * sum(rate(goshort_redirect_cache_total{result=~"hit|negative_hit"}[5m])) / clamp_min(sum(rate(goshort_redirect_cache_total[5m])), 0.001)',
  },
  {
    name: 'api_requests_per_second',
    label: 'API requests per second',
    unit: 'rps',
    query: 'sum(rate(goshort_http_requests_total[1m]))',
  },
  {
    name: 'api_5xx_ratio',
    label: 'API 5xx responses',
    unit: 'percent',
    query:
      '100 * sum(rate(goshort_http_requests_total{status=~"5.."}[5m])) / clamp_min(sum(rate(goshort_http_requests_total[5m])), 0.001)',
  },
  {
    name: 'api_p95_ms',
    label: 'API p95 latency',
    unit: 'ms',
    query:
      'histogram_quantile(0.95, sum by (le) (rate(goshort_http_request_duration_seconds_bucket[5m]))) * 1000',
  },
  {
    name: 'failed_logins_per_minute',
    label: 'Failed logins per minute',
    unit: 'per_minute',
    query: 'sum(rate(goshort_logins_total{result="failure"}[5m])) * 60',
  },
  {
    name: 'events_ingested_per_second',
    label: 'Click events stored per second',
    unit: 'rps',
    query: 'sum(rate(goshort_analytics_events_total{outcome="inserted"}[1m]))',
  },
  {
    name: 'analytics_queue_waiting',
    label: 'Analytics batches waiting',
    unit: 'count',
    query: 'sum(goshort_queue_jobs{queue="analytics-events",state="waiting"})',
  },
  {
    name: 'failed_jobs',
    label: 'Failed jobs awaiting review',
    unit: 'count',
    query: 'sum(goshort_queue_jobs{state="failed"})',
  },
  {
    name: 'services_up',
    label: 'Services up (api, redirect, worker)',
    unit: 'count',
    query: 'count(up{job=~"api|redirect|worker"} == 1)',
  },
];

export const metricByName = (name: string): MetricDef | undefined =>
  METRICS.find((m) => m.name === name);

interface PromResponse {
  status: string;
  data?: { result?: Array<{ value?: [number, string]; values?: Array<[number, string]> }> };
}

async function prom(
  ctx: AppContext,
  path: string,
  params: Record<string, string>,
): Promise<PromResponse> {
  const base = ctx.config.PROMETHEUS_URL;
  if (!base)
    throw new AppError('SERVICE_UNAVAILABLE', 'Metrics are not configured (PROMETHEUS_URL)');
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as PromResponse;
  } catch (err) {
    ctx.logger.warn({ err }, 'prometheus query failed');
    throw new AppError('SERVICE_UNAVAILABLE', 'Metrics are temporarily unavailable');
  }
}

const num = (s: string | undefined): number | null => {
  const n = Number(s);
  return s !== undefined && Number.isFinite(n) ? n : null;
};

/** One value per metric (null when the series has no data yet). */
export async function metricsSummary(ctx: AppContext) {
  return Promise.all(
    METRICS.map(async (m) => {
      try {
        const r = await prom(ctx, '/api/v1/query', { query: m.query });
        return {
          name: m.name,
          label: m.label,
          unit: m.unit,
          value: num(r.data?.result?.[0]?.value?.[1]),
        };
      } catch {
        return { name: m.name, label: m.label, unit: m.unit, value: null };
      }
    }),
  );
}

export async function metricRange(ctx: AppContext, m: MetricDef, minutes: number) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - minutes * 60;
  const step = Math.max(15, Math.ceil((minutes * 60) / 120));
  const r = await prom(ctx, '/api/v1/query_range', {
    query: m.query,
    start: String(start),
    end: String(end),
    step: String(step),
  });
  const values = r.data?.result?.[0]?.values ?? [];
  return values.map(([t, v]) => ({ t: t * 1000, v: num(v) }));
}
