import { UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@go-short/ui/components/badge';
import { Card } from '@go-short/ui/components/card';
import { NativeSelect } from '@go-short/ui/components/input';
import { EmptyState, ErrorState, TableSkeleton } from '@go-short/ui/components/states';
import { PageHeader } from '@go-short/ui/components/page-header';
import { TBody, TD, TH, THead, TR, Table } from '@go-short/ui/components/table';
import { formatDate } from '@/lib/format';
import type { TeamMember } from '@/types';
import { LoadMore, RoleBadge, SearchBox } from '@/components/bits';
import { useCursorList } from '@/hooks/useCursorList';
import { useDebounced } from '@/hooks/useDebounced';

export function TeamsPage() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const dq = useDebounced(q.trim());
  const list = useCursorList<TeamMember>('/admin/teams', {
    q: dq || undefined,
    role: role || undefined,
  });
  return (
    <>
      <PageHeader
        title="Teams"
        description="Every membership across all workspaces: who belongs where, with which role."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBox value={q} onChange={setQ} placeholder="Search person or workspace" />
        <NativeSelect
          aria-label="Filter by role"
          className="w-44"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="">All roles</option>
          {['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'].map((r) => (
            <option key={r} value={r}>
              {r[0] + r.slice(1).toLowerCase()}
            </option>
          ))}
        </NativeSelect>
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <Card>
          <TableSkeleton rows={6} cols={4} />
        </Card>
      ) : list.rows.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No memberships found"
          description="Try a different search or role."
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Person</TH>
                <TH>Workspace</TH>
                <TH>Role</TH>
                <TH className="hidden md:table-cell">Joined</TH>
              </TR>
            </THead>
            <TBody>
              {list.rows.map((m) => (
                <TR key={m.id}>
                  <TD>
                    <span className="block font-medium">{m.user.name}</span>
                    <span className="text-xs text-muted-foreground">{m.user.email}</span>
                    {m.user.disabled && (
                      <Badge tone="red" className="ml-2">
                        Suspended
                      </Badge>
                    )}
                  </TD>
                  <TD>
                    <Link
                      to={`/workspaces/${m.workspace.id}`}
                      className="font-medium hover:underline"
                    >
                      {m.workspace.name}
                    </Link>
                  </TD>
                  <TD>
                    <RoleBadge role={m.role} />
                  </TD>
                  <TD className="hidden text-muted-foreground md:table-cell">
                    {formatDate(m.joinedAt)}
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
