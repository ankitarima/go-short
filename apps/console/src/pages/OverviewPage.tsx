import { useQuery } from '@tanstack/react-query';
import { Activity, BarChart3, Building2, Globe, Link2, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@go-short/ui/components/card';
import { PageHeader } from '@go-short/ui/components/page-header';
import { Segmented } from '@go-short/ui/components/segmented';
import { StatCard } from '@go-short/ui/components/stat-card';
import { ErrorState } from '@go-short/ui/components/states';
import { api } from '@/lib/api';
import { formatCompact, formatNumber } from '@/lib/format';
import type { Stats, Usage } from '@/types';
import { SeriesChart } from '@/components/bits';

export function OverviewPage() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const stats = useQuery({
    queryKey: ['console', 'stats'],
    queryFn: () => api<Stats>('/admin/stats'),
    refetchInterval: 30_000,
  });
  const usage = useQuery({
    queryKey: ['console', 'usage', days],
    queryFn: () => api<Usage>('/admin/usage', { query: { days } }),
  });
  const failed = Object.values(stats.data?.queues ?? {}).reduce((n, q) => n + (q.failed ?? 0), 0);
  const waiting = stats.data?.queues.analytics?.waiting ?? 0;
  return (
    <>
      <PageHeader
        title="Overview"
        description="Usage and health across the whole platform."
        actions={
          <Segmented
            label="Range"
            value={days}
            onChange={setDays}
            options={[
              { value: '7', label: '7d' },
              { value: '30', label: '30d' },
              { value: '90', label: '90d' },
            ]}
          />
        }
      />
      {stats.isError && (
        <ErrorState error={stats.error} onRetry={() => void stats.refetch()} className="mb-6" />
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Users"
          icon={Users}
          loading={stats.isPending}
          value={formatNumber(stats.data?.users ?? 0)}
          hint={
            usage.data ? `+${formatNumber(usage.data.totals.signups)} in ${days} days` : undefined
          }
        />
        <StatCard
          label="Workspaces"
          icon={Building2}
          loading={stats.isPending}
          value={formatNumber(stats.data?.workspaces ?? 0)}
          hint={
            usage.data
              ? `${formatNumber(usage.data.totals.activeWorkspaces)} active in ${days} days`
              : undefined
          }
        />
        <StatCard
          label="Links"
          icon={Link2}
          loading={stats.isPending}
          value={formatNumber(stats.data?.links ?? 0)}
          hint={
            usage.data
              ? `+${formatNumber(usage.data.totals.linksCreated)} in ${days} days`
              : undefined
          }
        />
        <StatCard
          label="Custom domains"
          icon={Globe}
          loading={stats.isPending}
          value={formatNumber(stats.data?.domains ?? 0)}
          hint={`${formatNumber(stats.data?.campaigns ?? 0)} campaigns · ${formatNumber(stats.data?.qrCodes ?? 0)} QR codes`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Clicks</CardTitle>
            <p className="copy-13 text-muted-foreground">
              {usage.data
                ? `${formatCompact(usage.data.totals.clicks)} in ${days} days, all workspaces`
                : ' '}
            </p>
          </CardHeader>
          <CardContent>
            {usage.isError ? (
              <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
            ) : (
              <SeriesChart
                label="Clicks"
                data={(usage.data?.clicks ?? []).map((p) => ({ x: p.date, y: p.count }))}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>New users</CardTitle>
            <p className="copy-13 text-muted-foreground">Sign-ups per day</p>
          </CardHeader>
          <CardContent>
            <SeriesChart
              label="Sign-ups"
              color="var(--chart-2)"
              data={(usage.data?.signups ?? []).map((p) => ({ x: p.date, y: p.count }))}
            />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Busiest workspaces</CardTitle>
            <p className="copy-13 text-muted-foreground">By clicks in the last {days} days</p>
          </CardHeader>
          <CardContent>
            {usage.data && usage.data.topWorkspaces.length === 0 && (
              <p className="copy-14 text-muted-foreground">No clicks recorded in this period.</p>
            )}
            <ol className="flex flex-col">
              {usage.data?.topWorkspaces.map((w, i) => (
                <li
                  key={w.workspaceId}
                  className="flex items-center gap-3 border-b border-border py-2.5 last:border-0"
                >
                  <span className="mono-13 w-5 text-subtle-foreground">{i + 1}</span>
                  <Link
                    to={`/workspaces/${w.workspaceId}`}
                    className="min-w-0 flex-1 truncate text-[14px] font-medium hover:underline"
                  >
                    {w.name}
                  </Link>
                  <span className="mono-13 text-muted-foreground">{formatNumber(w.clicks)}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
            <p className="copy-13 text-muted-foreground">Background queues right now</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Row
              label="Analytics batches waiting"
              value={formatNumber(waiting)}
              warn={waiting > 200}
            />
            <Row
              label="Failed jobs awaiting review"
              value={formatNumber(failed)}
              warn={failed > 0}
            />
            <Row
              label="Click events (estimate)"
              value={formatCompact(stats.data?.clickEventsEstimate ?? 0)}
            />
            <Link
              to="/queues"
              className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-blue hover:underline"
            >
              <Activity className="size-3.5" aria-hidden /> Queues and jobs
            </Link>
            <Link
              to="/monitoring"
              className="inline-flex items-center gap-1 text-[13px] font-medium text-blue hover:underline"
            >
              <BarChart3 className="size-3.5" aria-hidden /> Live monitoring
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[14px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={warn ? 'font-medium text-amber' : 'font-medium'}>{value}</span>
    </div>
  );
}
