import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Play, RotateCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@go-short/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@go-short/ui/components/card';
import { Segmented } from '@go-short/ui/components/segmented';
import { EmptyState, ErrorState } from '@go-short/ui/components/states';
import { PageHeader } from '@go-short/ui/components/page-header';
import { TBody, TD, TH, THead, TR, Table } from '@go-short/ui/components/table';
import { ApiError, api } from '@/lib/api';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { FailedJob } from '@/types';
import { useConsole } from '@/hooks/useConsole';

const QUEUES = ['analytics', 'webhooks', 'cleanup'] as const;
const TASKS = [
  'sessions',
  'stale-domains',
  'click-retention',
  'visitors-and-buckets',
  'audit-logs',
  'expired-links',
  'orphan-logos',
  'failed-jobs',
] as const;

export function QueuesPage() {
  const { can } = useConsole();
  const act = can('queues:manage');
  const qc = useQueryClient();
  const [queue, setQueue] = useState<(typeof QUEUES)[number]>('analytics');
  const counts = useQuery({
    queryKey: ['console', 'queues'],
    queryFn: () => api<Record<string, Record<string, number>>>('/admin/queues'),
    refetchInterval: 15_000,
  });
  const failed = useQuery({
    queryKey: ['console', 'failed', queue],
    queryFn: () => api<FailedJob[]>(`/admin/queues/${queue}/failed`, { query: { limit: 50 } }),
  });
  const done = () => void qc.invalidateQueries({ queryKey: ['console'] });
  const fail = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : 'Something went wrong');
  const retry = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/queues/${queue}/failed/${id}/retry`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Job queued again');
      done();
    },
    onError: fail,
  });
  const drop = useMutation({
    mutationFn: (id: string) => api(`/admin/queues/${queue}/failed/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Job deleted');
      done();
    },
    onError: fail,
  });
  const run = useMutation({
    mutationFn: (t: string) => api(`/admin/cleanup/${t}/run`, { method: 'POST' }),
    onSuccess: (_d, t) => toast.success(`Cleanup “${t}” started`),
    onError: fail,
  });

  return (
    <>
      <PageHeader
        title="Queues and jobs"
        description="Background work: click analytics, webhook deliveries and scheduled cleanups."
      />
      {counts.isError && (
        <ErrorState error={counts.error} onRetry={() => void counts.refetch()} className="mb-6" />
      )}
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        {QUEUES.map((n) => {
          const c = counts.data?.[n];
          return (
            <Card key={n}>
              <CardHeader>
                <CardTitle className="capitalize">{n}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-y-2 text-[14px]">
                  {(['waiting', 'active', 'delayed', 'failed'] as const).map((s) => (
                    <div key={s} className="contents">
                      <dt className="text-muted-foreground capitalize">{s}</dt>
                      <dd
                        className={
                          s === 'failed' && (c?.[s] ?? 0) > 0
                            ? 'text-right font-medium text-red'
                            : 'text-right font-medium'
                        }
                      >
                        {counts.isPending ? '…' : formatNumber(c?.[s] ?? 0)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="heading-20">Failed jobs</h2>
        <Segmented
          label="Queue"
          value={queue}
          onChange={setQueue}
          options={QUEUES.map((q) => ({ value: q, label: q[0]!.toUpperCase() + q.slice(1) }))}
        />
      </div>
      {failed.isError ? (
        <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
      ) : failed.data?.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No failed jobs"
          description="Jobs that exhaust their retries appear here for review. Payloads are summarised, never shown."
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Job</TH>
                <TH>Reason</TH>
                <TH>Attempts</TH>
                <TH className="hidden md:table-cell">Failed</TH>
                {act && (
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {failed.data?.map((j) => (
                <TR key={String(j.id)}>
                  <TD>
                    <span className="mono-13">{String(j.id)}</span>
                    <div className="mono-13 text-xs text-muted-foreground">
                      {JSON.stringify(j.summary)}
                    </div>
                  </TD>
                  <TD
                    className="max-w-[320px] truncate text-muted-foreground"
                    title={j.failedReason ?? ''}
                  >
                    {j.failedReason ?? '—'}
                  </TD>
                  <TD>{j.attemptsMade}</TD>
                  <TD className="hidden text-muted-foreground md:table-cell">
                    {formatDateTime(j.failedAt)}
                  </TD>
                  {act && (
                    <TD className="whitespace-nowrap text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Retry job ${j.id}`}
                        onClick={() => retry.mutate(String(j.id))}
                      >
                        <RotateCw />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete job ${j.id}`}
                        onClick={() => drop.mutate(String(j.id))}
                      >
                        <Trash2 />
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <h2 className="heading-20 mb-3 mt-10">Cleanup tasks</h2>
      <p className="copy-14 mb-4 max-w-2xl text-muted-foreground">
        These run on a schedule. Run one now if you need it immediately.
        {!act && ' Admins can run them.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {TASKS.map((t) => (
          <Button
            key={t}
            variant="secondary"
            size="sm"
            disabled={!act}
            loading={run.isPending && run.variables === t}
            onClick={() => run.mutate(t)}
          >
            <Play /> {t}
          </Button>
        ))}
      </div>
    </>
  );
}
