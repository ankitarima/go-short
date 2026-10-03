import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Card } from '@go-short/ui/components/card';
import { CopyButton } from '@go-short/ui/components/copy-button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@go-short/ui/components/dialog';
import { Link } from 'react-router-dom';
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
  const [selected, setSelected] = useState<AuditEntry | null>(null);
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
                <TR key={a.id} className="cursor-pointer" onClick={() => setSelected(a)}>
                  <TD className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(a.createdAt)}
                  </TD>
                  <TD>
                    <button
                      className="text-left font-medium capitalize hover:underline"
                      aria-label={`Details: ${label(a.action)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(a);
                      }}
                    >
                      {label(a.action)}
                    </button>
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
      <AuditDetails entry={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-[14px]">{children}</dd>
    </div>
  );
}

/** One audit entry in full: who, what, when, which resource, and the recorded metadata. */
function AuditDetails({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  const details = entry
    ? JSON.stringify(
        {
          workspaceId: entry.workspaceId,
          resourceId: entry.resourceId,
          metadata: entry.metadata ?? null,
        },
        null,
        2,
      )
    : '';
  return (
    <Dialog open={Boolean(entry)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="capitalize">
            {entry ? label(entry.action) : 'Audit entry'}
          </DialogTitle>
          <DialogDescription>{entry ? formatDateTime(entry.createdAt) : ''}</DialogDescription>
        </DialogHeader>
        {entry && (
          <DialogBody className="flex flex-col gap-5">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Item label="Done by">
                {entry.actor ? (
                  <>
                    {entry.actor.name}
                    <span className="block text-[13px] text-muted-foreground">
                      {entry.actor.email}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">System</span>
                )}
              </Item>
              <Item label="Resource">
                {entry.resourceType}
                {entry.resourceId && (
                  <span className="mono-13 block text-[12px] text-muted-foreground">
                    {entry.resourceId}
                  </span>
                )}
              </Item>
              <Item label="Workspace">
                {entry.workspaceId ? (
                  <Link
                    to={`/workspaces/${entry.workspaceId}`}
                    onClick={onClose}
                    className="text-blue hover:underline"
                  >
                    Open workspace
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Platform-level</span>
                )}
              </Item>
              <Item label="Entry id">
                <span className="mono-13 text-[12px]">{entry.id}</span>
              </Item>
            </dl>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="label-14">Recorded details</h4>
                <CopyButton value={details} label="Copy JSON" />
              </div>
              <pre className="mono-13 max-h-[40vh] overflow-auto rounded-lg border border-border bg-surface p-3 text-xs">
                {details}
              </pre>
              <p className="copy-13 mt-2 text-muted-foreground">
                Secrets are never recorded in the audit log.
              </p>
            </div>
          </DialogBody>
        )}
      </DialogContent>
    </Dialog>
  );
}
