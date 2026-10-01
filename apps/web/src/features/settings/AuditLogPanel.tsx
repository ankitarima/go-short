import { useInfiniteQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useWorkspace, wsKey, wsPath } from '@/hooks/useAuth';
import { apiPage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { AuditLog } from '@/types/api';

const human = (a: string) => a.toLowerCase().replace(/_/g, ' ');

export function AuditLogPanel() {
  const { workspace } = useWorkspace();
  const q = useInfiniteQuery({
    queryKey: wsKey(workspace.id, 'audit'),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiPage<AuditLog>(wsPath(workspace, '/audit-logs'), {
        query: { limit: 50, cursor: pageParam },
      }),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isPending)
    return (
      <Card>
        <TableSkeleton rows={6} cols={3} />
      </Card>
    );
  if (rows.length === 0)
    return (
      <EmptyState
        icon={ScrollText}
        title="No activity yet"
        description="Changes to links, domains, members and settings are recorded here."
      />
    );
  return (
    <Card>
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Action</TH>
            <TH>Resource</TH>
            <TH>When</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD className="font-medium capitalize">{human(r.action)}</TD>
              <TD className="text-muted-foreground">
                <span className="mono-13">{r.resourceType}</span>
                {r.resourceId && (
                  <span className="mono-13 ml-2 text-subtle-foreground">
                    {r.resourceId.slice(0, 10)}
                  </span>
                )}
              </TD>
              <TD className="whitespace-nowrap text-muted-foreground">
                {formatDateTime(r.createdAt)}
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
