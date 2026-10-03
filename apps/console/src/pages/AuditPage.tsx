import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Card } from '@go-short/ui/components/card';
import { EmptyState, ErrorState, TableSkeleton } from '@go-short/ui/components/states';
import { PageHeader } from '@go-short/ui/components/page-header';
import { TBody, TD, TH, THead, TR, Table } from '@go-short/ui/components/table';
import { formatDateTime } from '@/lib/format';
import type { AuditEntry } from '@/types';
import { PagerFooter, SearchBox } from '@/components/bits';
import { usePagedList } from '@/hooks/usePaging';
import { useDebounced } from '@/hooks/useDebounced';

const label = (a: string) => a.toLowerCase().replace(/_/g, ' ');

export function AuditPage() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const { rows, pager, query } = usePagedList<AuditEntry>('/admin/audit-logs', {
    q: dq || undefined,
  });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Security-relevant actions across the platform, including everything staff do in this console. Secrets are never recorded."
      />
      <div className="mb-4">
        <SearchBox value={q} onChange={setQ} placeholder="Search by action or person" />
      </div>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <Card>
          <TableSkeleton rows={8} cols={4} />
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="Nothing logged"
          description={dq ? 'No entries match your search.' : 'Activity will appear here.'}
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>When</TH>
                <TH>Action</TH>
                <TH>By</TH>
                <TH className="hidden md:table-cell">Resource</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((a) => (
                <TR
                  key={a.id}
                  className="cursor-pointer"
                  onClick={() => setOpen(open === a.id ? null : a.id)}
                >
                  <TD className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(a.createdAt)}
                  </TD>
                  <TD>
                    <span className="font-medium capitalize">{label(a.action)}</span>
                    {open === a.id && (
                      <pre className="mono-13 mt-2 max-w-full overflow-x-auto rounded-md border border-border bg-surface p-3 text-xs">
                        {JSON.stringify(
                          {
                            workspaceId: a.workspaceId,
                            resourceId: a.resourceId,
                            metadata: a.metadata ?? null,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    )}
                  </TD>
                  <TD>
                    {a.actor ? (
                      <>
                        <span className="block">{a.actor.name}</span>
                        <span className="text-xs text-muted-foreground">{a.actor.email}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">System</span>
                    )}
                  </TD>
                  <TD className="hidden text-muted-foreground md:table-cell">{a.resourceType}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <PagerFooter pager={pager} />
        </Card>
      )}
    </>
  );
}
