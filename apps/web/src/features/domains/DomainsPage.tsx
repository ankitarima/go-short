import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, MoreHorizontal, Plus, Power, Star, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useWorkspace, wsKey, wsPath } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import type { Domain } from '@/types/api';
import { DomainWizard } from './DomainWizard';

const TONE = { VERIFIED: 'green', PENDING: 'amber', DISABLED: 'gray' } as const;

export function DomainsPage() {
  const { workspace, canManage } = useWorkspace();
  const qc = useQueryClient();
  const [wizard, setWizard] = useState<{ open: boolean; domain?: Domain }>({ open: false });
  const [deleting, setDeleting] = useState<Domain | null>(null);
  const domains = useQuery({
    queryKey: wsKey(workspace.id, 'domains'),
    queryFn: () => api<Domain[]>(wsPath(workspace, '/domains')),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: wsKey(workspace.id, 'domains') });
    void qc.invalidateQueries({ queryKey: wsKey(workspace.id, 'overview') });
  };
  const fail = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : 'Something went wrong');
  const patch = useMutation({
    mutationFn: ({ d, body }: { d: Domain; body: Record<string, boolean> }) =>
      api<Domain>(wsPath(workspace, `/domains/${d.id}`), { method: 'PATCH', body }),
    onSuccess: () => {
      toast.success('Domain updated');
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (d: Domain) => api(wsPath(workspace, `/domains/${d.id}`), { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Domain removed');
      setDeleting(null);
      refresh();
    },
    onError: (e) => {
      setDeleting(null);
      fail(e);
    },
  });

  return (
    <>
      <PageHeader
        title="Domains"
        description="Serve short links from your own domain. The platform’s shared domain is always available."
        actions={
          canManage && (
            <Button onClick={() => setWizard({ open: true })}>
              <Plus /> Add domain
            </Button>
          )
        }
      />
      {domains.isError ? (
        <ErrorState error={domains.error} onRetry={() => void domains.refetch()} />
      ) : domains.isPending ? (
        <Card>
          <TableSkeleton rows={3} cols={4} />
        </Card>
      ) : domains.data.filter((d) => !d.shared).length === 0 && !canManage ? (
        <EmptyState
          icon={Globe}
          title="No custom domains"
          description="Ask a workspace admin to connect a domain."
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Domain</TH>
                <TH>Status</TH>
                <TH className="hidden md:table-cell">Added</TH>
                <TH className="w-12">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {domains.data.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <div className="flex items-center gap-2">
                      <span className="mono-13 font-medium">{d.hostname}</span>
                      {d.shared && <Badge tone="outline">Shared</Badge>}
                      {d.isDefault && !d.shared && <Badge tone="blue">Default</Badge>}
                    </div>
                  </TD>
                  <TD>
                    <Badge tone={TONE[d.status]} dot>
                      {d.status === 'VERIFIED'
                        ? 'Verified'
                        : d.status === 'PENDING'
                          ? 'Pending DNS'
                          : 'Disabled'}
                    </Badge>
                  </TD>
                  <TD className="hidden text-muted-foreground md:table-cell">
                    {d.shared ? '—' : formatRelative(d.createdAt)}
                  </TD>
                  <TD>
                    {!d.shared && canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${d.hostname}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {!d.isVerified && (
                            <DropdownMenuItem onSelect={() => setWizard({ open: true, domain: d })}>
                              <Wand2 /> Continue setup
                            </DropdownMenuItem>
                          )}
                          {d.isVerified && !d.isDefault && d.status === 'VERIFIED' && (
                            <DropdownMenuItem
                              onSelect={() => patch.mutate({ d, body: { isDefault: true } })}
                            >
                              <Star /> Make default
                            </DropdownMenuItem>
                          )}
                          {d.isVerified && (
                            <DropdownMenuItem
                              onSelect={() =>
                                patch.mutate({ d, body: { disabled: d.status !== 'DISABLED' } })
                              }
                            >
                              <Power /> {d.status === 'DISABLED' ? 'Enable' : 'Disable'}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem destructive onSelect={() => setDeleting(d)}>
                            <Trash2 /> Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      <div className="mt-6">
        <Callout tone="info" title="How custom domains work">
          Point a CNAME (or TXT) record at the platform, verify it here, and HTTPS certificates are
          issued automatically. Disabling a domain stops its links immediately.
        </Callout>
      </div>

      <DomainWizard
        open={wizard.open}
        onOpenChange={(o) => setWizard((w) => ({ ...w, open: o }))}
        domain={wizard.domain}
        onChanged={refresh}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove this domain?"
        description={
          <>
            <span className="mono-13 text-foreground">{deleting?.hostname}</span> will be
            disconnected. A domain that still has links cannot be removed: delete or move them
            first.
          </>
        }
        confirmLabel="Remove domain"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </>
  );
}
