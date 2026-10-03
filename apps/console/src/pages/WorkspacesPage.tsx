import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '@go-short/ui/components/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@go-short/ui/components/card';
import { EmptyState, ErrorState, TableSkeleton } from '@go-short/ui/components/states';
import { PageHeader } from '@go-short/ui/components/page-header';
import { StatCard } from '@go-short/ui/components/stat-card';
import { TBody, TD, TH, THead, TR, Table } from '@go-short/ui/components/table';
import { api } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/format';
import type { AdminWorkspace, AdminWorkspaceDetail } from '@/types';
import { LoadMore, RoleBadge, SearchBox } from '@/components/bits';
import { useCursorList } from '@/hooks/useCursorList';
import { useDebounced } from '@/hooks/useDebounced';

export function WorkspacesPage() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const list = useCursorList<AdminWorkspace>('/admin/workspaces', { q: dq || undefined });
  return (
    <>
      <PageHeader title="Workspaces" description="Every workspace and how much it holds." />
      <div className="mb-4">
        <SearchBox value={q} onChange={setQ} placeholder="Search by name or slug" />
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <Card>
          <TableSkeleton rows={6} cols={5} />
        </Card>
      ) : list.rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No workspaces found"
          description={dq ? 'Try a different search.' : 'No workspace has been created yet.'}
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Workspace</TH>
                <TH>Members</TH>
                <TH>Links</TH>
                <TH className="hidden md:table-cell">Domains</TH>
                <TH className="hidden md:table-cell">Campaigns</TH>
                <TH className="hidden lg:table-cell">Created</TH>
              </TR>
            </THead>
            <TBody>
              {list.rows.map((w) => (
                <TR key={w.id}>
                  <TD>
                    <Link to={`/workspaces/${w.id}`} className="block font-medium hover:underline">
                      {w.name}
                    </Link>
                    <span className="mono-13 text-xs text-muted-foreground">{w.slug}</span>
                  </TD>
                  <TD>{formatNumber(w.memberCount)}</TD>
                  <TD>{formatNumber(w.linkCount)}</TD>
                  <TD className="hidden md:table-cell">{w.domainCount}</TD>
                  <TD className="hidden md:table-cell">{w.campaignCount}</TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">
                    {formatDate(w.createdAt)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <LoadMore
            hasNext={!!list.hasNextPage}
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          />
        </Card>
      )}
    </>
  );
}

export function WorkspaceDetailPage() {
  const { id = '' } = useParams();
  const q = useQuery({
    queryKey: ['console', 'workspace', id],
    queryFn: () => api<AdminWorkspaceDetail>(`/admin/workspaces/${id}`),
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const w = q.data;
  return (
    <>
      <PageHeader
        title={w?.name ?? 'Workspace'}
        description={
          w ? (
            <span className="mono-13">
              {w.slug} · {w.timezone} · created {formatDate(w.createdAt)}
            </span>
          ) : undefined
        }
        actions={
          <Link
            to="/workspaces"
            className="text-[13px] text-muted-foreground hover:text-foreground"
          >
            All workspaces
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Clicks (30 days)"
          loading={q.isPending}
          value={formatNumber(w?.clicksLast30Days ?? 0)}
        />
        <StatCard
          label="Links"
          loading={q.isPending}
          value={formatNumber(w?.counts.links ?? 0)}
          hint={`${w?.counts.campaigns ?? 0} campaigns`}
        />
        <StatCard
          label="QR codes"
          loading={q.isPending}
          value={formatNumber(w?.counts.qrCodes ?? 0)}
        />
        <StatCard
          label="Integrations"
          loading={q.isPending}
          value={`${w?.counts.apiKeys ?? 0} keys`}
          hint={`${w?.counts.webhooks ?? 0} webhooks`}
        />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Person</TH>
                  <TH>Role</TH>
                  <TH>Joined</TH>
                </TR>
              </THead>
              <TBody>
                {w?.members.map((m) => (
                  <TR key={m.userId}>
                    <TD>
                      <span className="block font-medium">{m.name}</span>
                      <span className="text-xs text-muted-foreground">{m.email}</span>
                      {m.disabled && (
                        <Badge tone="red" className="ml-2">
                          Suspended
                        </Badge>
                      )}
                    </TD>
                    <TD>
                      <RoleBadge role={m.role} />
                    </TD>
                    <TD className="text-muted-foreground">{formatDate(m.joinedAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Domains</CardTitle>
            </CardHeader>
            <CardContent>
              {w && w.domains.length === 0 && (
                <p className="copy-14 text-muted-foreground">Uses the shared short domain only.</p>
              )}
              <ul className="flex flex-col gap-2">
                {w?.domains.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-[14px]">
                    <span className="mono-13 truncate">{d.hostname}</span>
                    <Badge
                      tone={
                        d.status === 'VERIFIED'
                          ? 'green'
                          : d.status === 'PENDING'
                            ? 'amber'
                            : 'gray'
                      }
                    >
                      {d.status.toLowerCase()}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Privacy settings</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-[14px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">IP hashing</span>
                <span>{w?.hashIps ? 'On' : 'Off'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bots hidden by default</span>
                <span>{w?.filterBots ? 'Yes' : 'No'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Click retention</span>
                <span>{w?.retentionDays ? `${w.retentionDays} days` : 'Forever'}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
