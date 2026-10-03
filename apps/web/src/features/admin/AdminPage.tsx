import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Database, Globe, Link2, Megaphone, QrCode, Users } from 'lucide-react';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@go-short/ui/components/badge';
import { Button } from '@go-short/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@go-short/ui/components/card';
import { PageHeader } from '@go-short/ui/components/page-header';
import { NativeSelect } from '@go-short/ui/components/input';
import { StatCard } from '@go-short/ui/components/stat-card';
import { EmptyState, ErrorState, TableSkeleton } from '@go-short/ui/components/states';
import { Table, TBody, TD, TH, THead, TR } from '@go-short/ui/components/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@go-short/ui/components/tabs';
import { useWorkspace } from '@/hooks/useAuth';
import { ApiError, api, apiPage } from '@/lib/api';
import { formatDate, formatDateTime, formatNumber } from '@go-short/ui/lib/format';
import type { AdminStats, AdminUser, AdminWorkspace, FailedJob } from '@/types/api';

const fail = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : 'Something went wrong');
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

export function AdminPage() {
  const { me } = useWorkspace();
  if (me.user.systemRole !== 'ADMIN') return <Navigate to="/dashboard" replace />;
  return (
    <>
      <PageHeader
        title="Platform admin"
        description="Operator tools for the whole installation. Visible only to system administrators."
      />
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="workspaces">Workspaces</TabsTrigger>
          <TabsTrigger value="queues">Queues</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Overview />
        </TabsContent>
        <TabsContent value="users">
          <Users_ />
        </TabsContent>
        <TabsContent value="workspaces">
          <Workspaces />
        </TabsContent>
        <TabsContent value="queues">
          <Queues />
        </TabsContent>
      </Tabs>
    </>
  );
}

function Overview() {
  const stats = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api<AdminStats>('/admin/stats'),
    refetchInterval: 15_000,
  });
  const run = useMutation({
    mutationFn: (t: string) => api(`/admin/cleanup/${t}/run`, { method: 'POST' }),
    onSuccess: (_d, t) => toast.success(`Queued “${t}”`),
    onError: fail,
  });
  const [task, setTask] = useState<string>(TASKS[0]);
  const s = stats.data;
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Users" icon={Users} loading={!s} value={s && formatNumber(s.users)} />
        <StatCard
          label="Workspaces"
          icon={Database}
          loading={!s}
          value={s && formatNumber(s.workspaces)}
        />
        <StatCard label="Links" icon={Link2} loading={!s} value={s && formatNumber(s.links)} />
        <StatCard label="Domains" icon={Globe} loading={!s} value={s && formatNumber(s.domains)} />
        <StatCard
          label="Campaigns"
          icon={Megaphone}
          loading={!s}
          value={s && formatNumber(s.campaigns)}
        />
        <StatCard
          label="QR codes"
          icon={QrCode}
          loading={!s}
          value={s && formatNumber(s.qrCodes)}
        />
        <StatCard
          label="Click events"
          icon={Activity}
          loading={!s}
          value={s && formatNumber(s.clickEventsEstimate)}
          hint="Estimate"
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Queues</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Queue</TH>
                <TH className="text-right">Waiting</TH>
                <TH className="text-right">Active</TH>
                <TH className="text-right">Delayed</TH>
                <TH className="text-right">Failed</TH>
                <TH className="text-right">Completed</TH>
              </TR>
            </THead>
            <TBody>
              {Object.entries(s?.queues ?? {}).map(([name, c]) => (
                <TR key={name}>
                  <TD className="font-medium capitalize">{name}</TD>
                  {['waiting', 'active', 'delayed', 'failed', 'completed'].map((k) => (
                    <TD key={k} className="text-right tabular-nums">
                      {k === 'failed' && (c[k] ?? 0) > 0 ? (
                        <Badge tone="red">{c[k]}</Badge>
                      ) : (
                        formatNumber(c[k] ?? 0)
                      )}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Maintenance</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <NativeSelect
            aria-label="Cleanup task"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            className="sm:w-64"
          >
            {TASKS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NativeSelect>
          <Button variant="secondary" loading={run.isPending} onClick={() => run.mutate(task)}>
            Run now
          </Button>
          <span className="copy-13 text-muted-foreground">Cleanup also runs on a schedule.</span>
        </CardContent>
      </Card>
    </div>
  );
}

function Users_() {
  const { me } = useWorkspace();
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['admin', 'users'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiPage<AdminUser>('/admin/users', { query: { limit: 50, cursor: pageParam } }),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const setRole = useMutation({
    mutationFn: ({ u, role }: { u: AdminUser; role: 'USER' | 'ADMIN' }) =>
      api(`/admin/users/${u.id}`, { method: 'PATCH', body: { systemRole: role } }),
    onSuccess: () => {
      toast.success('Role updated');
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: fail,
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isPending)
    return (
      <Card>
        <TableSkeleton rows={5} cols={4} />
      </Card>
    );
  return (
    <Card>
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>User</TH>
            <TH>Role</TH>
            <TH className="text-right">Workspaces</TH>
            <TH className="hidden md:table-cell">Joined</TH>
            <TH className="w-40">
              <span className="sr-only">Actions</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((u) => (
            <TR key={u.id}>
              <TD>
                <div className="font-medium">{u.name}</div>
                <div className="text-xs text-muted-foreground">
                  {u.email}
                  {!u.emailVerified && ' · unverified'}
                </div>
              </TD>
              <TD>
                <Badge tone={u.systemRole === 'ADMIN' ? 'inverted' : 'gray'}>
                  {u.systemRole === 'ADMIN' ? 'Admin' : 'User'}
                </Badge>
              </TD>
              <TD className="text-right tabular-nums">{u.workspaceCount}</TD>
              <TD className="hidden text-muted-foreground md:table-cell">
                {formatDate(u.createdAt)}
              </TD>
              <TD className="text-right">
                {u.id !== me.user.id && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={setRole.isPending && setRole.variables?.u.id === u.id}
                    onClick={() =>
                      setRole.mutate({ u, role: u.systemRole === 'ADMIN' ? 'USER' : 'ADMIN' })
                    }
                  >
                    {u.systemRole === 'ADMIN' ? 'Revoke admin' : 'Make admin'}
                  </Button>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {q.hasNextPage && (
        <div className="flex justify-center border-t border-border p-3">
          <Button
            variant="secondary"
            size="sm"
            loading={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      )}
    </Card>
  );
}

function Workspaces() {
  const q = useInfiniteQuery({
    queryKey: ['admin', 'workspaces'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiPage<AdminWorkspace>('/admin/workspaces', { query: { limit: 50, cursor: pageParam } }),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isPending)
    return (
      <Card>
        <TableSkeleton rows={5} cols={5} />
      </Card>
    );
  return (
    <Card>
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Workspace</TH>
            <TH className="text-right">Members</TH>
            <TH className="text-right">Links</TH>
            <TH className="text-right">Domains</TH>
            <TH className="text-right">Campaigns</TH>
            <TH className="hidden md:table-cell">Retention</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((w) => (
            <TR key={w.id}>
              <TD>
                <div className="font-medium">{w.name}</div>
                <div className="mono-13 text-xs text-muted-foreground">{w.slug}</div>
              </TD>
              <TD className="text-right tabular-nums">{w.memberCount}</TD>
              <TD className="text-right tabular-nums">{w.linkCount}</TD>
              <TD className="text-right tabular-nums">{w.domainCount}</TD>
              <TD className="text-right tabular-nums">{w.campaignCount}</TD>
              <TD className="hidden text-muted-foreground md:table-cell">
                {w.retentionDays ? `${w.retentionDays} days` : 'Forever'}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {q.hasNextPage && (
        <div className="flex justify-center border-t border-border p-3">
          <Button
            variant="secondary"
            size="sm"
            loading={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      )}
    </Card>
  );
}

function Queues() {
  const qc = useQueryClient();
  const [queue, setQueue] = useState<(typeof QUEUES)[number]>('analytics');
  const failed = useQuery({
    queryKey: ['admin', 'failed', queue],
    queryFn: () => api<FailedJob[]>(`/admin/queues/${queue}/failed`, { query: { limit: 50 } }),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'failed', queue] });
    void qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
  };
  const retry = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/queues/${queue}/failed/${id}/retry`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Job re-queued');
      refresh();
    },
    onError: fail,
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/admin/queues/${queue}/failed/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Job removed');
      refresh();
    },
    onError: fail,
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <NativeSelect
          aria-label="Queue"
          value={queue}
          onChange={(e) => setQueue(e.target.value as typeof queue)}
          className="w-48"
        >
          {QUEUES.map((qn) => (
            <option key={qn} value={qn}>
              {qn}
            </option>
          ))}
        </NativeSelect>
        <span className="copy-13 text-muted-foreground">
          Failed jobs are kept for 14 days. Payloads are not shown: analytics jobs contain raw IP
          addresses.
        </span>
      </div>
      {failed.isError ? (
        <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
      ) : failed.isPending ? (
        <Card>
          <TableSkeleton rows={3} cols={4} />
        </Card>
      ) : failed.data.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No failed jobs"
          description="Jobs that exhaust their retries appear here for inspection."
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Job</TH>
                <TH>Reason</TH>
                <TH className="text-right">Attempts</TH>
                <TH>Failed</TH>
                <TH className="w-40">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {failed.data.map((j) => (
                <TR key={j.id ?? j.createdAt}>
                  <TD>
                    <div className="mono-13">{j.id}</div>
                    <div className="mono-13 text-xs text-muted-foreground">
                      {Object.entries(j.summary)
                        .map(([k, v]) => `${k}=${String(v)}`)
                        .join(' ')}
                    </div>
                  </TD>
                  <TD className="max-w-xs">
                    <span className="line-clamp-2 text-red">{j.failedReason}</span>
                  </TD>
                  <TD className="text-right tabular-nums">{j.attemptsMade}</TD>
                  <TD className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(j.failedAt)}
                  </TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!j.id}
                        onClick={() => j.id && retry.mutate(j.id)}
                      >
                        Retry
                      </Button>
                      <Button
                        variant="destructive-outline"
                        size="sm"
                        disabled={!j.id}
                        onClick={() => j.id && del.mutate(j.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
