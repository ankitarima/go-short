import { useQuery } from '@tanstack/react-query';
import { BarChart3, ExternalLink, Flame, ServerCrash } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@go-short/ui/components/button';
import { Callout } from '@go-short/ui/components/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@go-short/ui/components/card';
import { Segmented } from '@go-short/ui/components/segmented';
import { ErrorState } from '@go-short/ui/components/states';
import { PageHeader } from '@go-short/ui/components/page-header';
import { Skeleton } from '@go-short/ui/components/skeleton';
import { api } from '@/lib/api';
import { formatMetric } from '@/lib/format';
import type { MetricRange, MetricValue, Monitoring } from '@/types';
import { SeriesChart } from '@/components/bits';

const CHARTS = [
  { name: 'redirects_per_second', color: 'var(--chart-1)' },
  { name: 'redirect_p95_ms', color: 'var(--chart-2)' },
  { name: 'api_5xx_ratio', color: 'var(--red)' },
  { name: 'analytics_queue_waiting', color: 'var(--chart-3)' },
] as const;

/** Highlights values that deserve a look. Thresholds mirror the alert rules, and are guides, not limits. */
function tone(m: MetricValue): 'ok' | 'warn' | 'none' {
  const v = m.value;
  if (v === null) return 'none';
  switch (m.name) {
    case 'redirect_backend_errors':
    case 'api_5xx_ratio':
      return v > 1 ? 'warn' : 'ok';
    case 'redirect_p95_ms':
      return v > 100 ? 'warn' : 'ok';
    case 'failed_jobs':
      return v > 0 ? 'warn' : 'ok';
    case 'analytics_queue_waiting':
      return v > 200 ? 'warn' : 'ok';
    case 'cache_hit_ratio':
      return v < 50 ? 'warn' : 'ok';
    case 'services_up':
      return v < 3 ? 'warn' : 'ok';
    default:
      return 'ok';
  }
}

export function MonitoringPage() {
  const [minutes, setMinutes] = useState<'60' | '360' | '1440'>('60');
  const mon = useQuery({
    queryKey: ['console', 'monitoring'],
    queryFn: () => api<Monitoring>('/admin/monitoring'),
    refetchInterval: 15_000,
  });
  const configured = mon.data?.configured ?? false;
  return (
    <>
      <PageHeader
        title="Monitoring"
        description="Live platform health from Prometheus. Open Grafana for the full dashboards."
        actions={
          <>
            {mon.data?.links.grafana && (
              <Button asChild variant="secondary">
                <a href={mon.data.links.grafana} target="_blank" rel="noreferrer noopener">
                  <BarChart3 /> Grafana <ExternalLink className="opacity-60" />
                </a>
              </Button>
            )}
            {mon.data?.links.prometheus && (
              <Button asChild variant="secondary">
                <a href={mon.data.links.prometheus} target="_blank" rel="noreferrer noopener">
                  <Flame /> Prometheus <ExternalLink className="opacity-60" />
                </a>
              </Button>
            )}
          </>
        }
      />
      {mon.isError && (
        <ErrorState error={mon.error} onRetry={() => void mon.refetch()} className="mb-6" />
      )}
      {mon.data && !configured && (
        <Callout tone="warning" title="Prometheus is not connected" className="mb-6">
          Set <code className="font-mono">PROMETHEUS_URL</code> for the API (for example{' '}
          <code className="font-mono">http://prometheus:9090</code>) to see live metrics here. See
          the monitoring guide in the repository.
        </Callout>
      )}
      {configured && mon.data?.metrics.every((m) => m.value === null) && (
        <Callout tone="danger" title="No data from Prometheus" className="mb-6">
          <ServerCrash className="mr-1 inline size-4" aria-hidden />
          It is configured, but returned nothing. Check that it is running and scraping the
          services.
        </Callout>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {mon.isPending
          ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
          : mon.data?.metrics.map((m) => {
              const t = tone(m);
              return (
                <div key={m.name} className="rounded-xl border border-border bg-background p-4">
                  <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <span
                      className={
                        t === 'warn'
                          ? 'size-2 rounded-full bg-amber'
                          : t === 'ok'
                            ? 'size-2 rounded-full bg-green'
                            : 'size-2 rounded-full bg-border-strong'
                      }
                      aria-hidden
                    />
                    {m.label}
                  </div>
                  <div
                    className="mt-2 text-[24px] font-semibold tracking-[-0.03em] tabular-nums"
                    data-testid={`metric-${m.name}`}
                  >
                    {formatMetric(m.unit, m.value)}
                  </div>
                </div>
              );
            })}
      </div>

      {configured && (
        <>
          <div className="mb-3 mt-10 flex items-center justify-between">
            <h2 className="heading-20">Trends</h2>
            <Segmented
              label="Time range"
              value={minutes}
              onChange={setMinutes}
              options={[
                { value: '60', label: '1h' },
                { value: '360', label: '6h' },
                { value: '1440', label: '24h' },
              ]}
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {CHARTS.map((c) => (
              <TrendCard key={c.name} name={c.name} color={c.color} minutes={minutes} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function TrendCard({ name, color, minutes }: { name: string; color: string; minutes: string }) {
  const q = useQuery({
    queryKey: ['console', 'range', name, minutes],
    queryFn: () => api<MetricRange>('/admin/monitoring/range', { query: { query: name, minutes } }),
    refetchInterval: 30_000,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{q.data?.label ?? name.replace(/_/g, ' ')}</CardTitle>
      </CardHeader>
      <CardContent>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.isPending ? (
          <Skeleton className="h-[220px]" />
        ) : (
          <SeriesChart
            label={q.data.label}
            color={color}
            data={q.data.points.map((p) => ({ x: p.t, y: p.v }))}
          />
        )}
      </CardContent>
    </Card>
  );
}
