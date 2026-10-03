import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Avatar } from '@go-short/ui/components/avatar';
import { Badge } from '@go-short/ui/components/badge';
import { Button } from '@go-short/ui/components/button';
import { Card } from '@go-short/ui/components/card';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@go-short/ui/components/dialog';
import { EmptyState, ErrorState, TableSkeleton } from '@go-short/ui/components/states';
import { PageHeader } from '@go-short/ui/components/page-header';
import { TBody, TD, TH, THead, TR, Table } from '@go-short/ui/components/table';
import { ApiError, api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import type { AdminUser, AdminUserDetail } from '@/types';
import { LoadMore, RoleBadge, SearchBox, StatusBadge } from '@/components/bits';
import { useConsole } from '@/hooks/useConsole';
import { useCursorList } from '@/hooks/useCursorList';
import { useDebounced } from '@/hooks/useDebounced';
import { Link } from 'react-router-dom';

export function UsersPage() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const list = useCursorList<AdminUser>('/admin/users', { q: dq || undefined });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title="Users"
        description="Every account on the platform. Open one to see its workspaces and manage its access."
      />
      <div className="mb-4">
        <SearchBox value={q} onChange={setQ} placeholder="Search by name or email" />
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <Card>
          <TableSkeleton rows={6} cols={5} />
        </Card>
      ) : list.rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No users found"
          description={dq ? 'Try a different search.' : 'Nobody has registered yet.'}
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>User</TH>
                <TH>Platform role</TH>
                <TH>Status</TH>
                <TH className="hidden md:table-cell">Workspaces</TH>
                <TH className="hidden lg:table-cell">Joined</TH>
              </TR>
            </THead>
            <TBody>
              {list.rows.map((u) => (
                <TR key={u.id} className="cursor-pointer" onClick={() => setOpen(u.id)}>
                  <TD>
                    <button
                      className="flex items-center gap-3 text-left"
                      onClick={() => setOpen(u.id)}
                      aria-label={`Open ${u.email}`}
                    >
                      <Avatar name={u.email} size={32} />
                      <span className="min-w-0">
                        <span className="block font-medium">{u.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {u.email}
                        </span>
                      </span>
                    </button>
                  </TD>
                  <TD>
                    <RoleBadge role={u.systemRole} />
                  </TD>
                  <TD>
                    <StatusBadge disabled={u.disabledAt !== null} />
                  </TD>
                  <TD className="hidden md:table-cell">{u.workspaceCount}</TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">
                    {formatDate(u.createdAt)}
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
      <UserDialog id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function UserDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can, session } = useConsole();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({
    queryKey: ['console', 'user', id],
    queryFn: () => api<AdminUserDetail>(`/admin/users/${id}`),
    enabled: Boolean(id),
  });
  const toggle = useMutation({
    mutationFn: (disable: boolean) =>
      api(`/admin/users/${id}/${disable ? 'disable' : 'enable'}`, { method: 'POST' }),
    onSuccess: (_d, disable) => {
      toast.success(disable ? 'Account suspended' : 'Account re-enabled');
      setConfirm(false);
      void qc.invalidateQueries({ queryKey: ['console'] });
    },
    onError: (e) => {
      setConfirm(false);
      toast.error(e instanceof ApiError ? e.message : 'Could not change the account');
    },
  });
  const u = q.data;
  const self = u?.id === session.user.id;
  return (
    <>
      <Dialog open={Boolean(id)} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{u?.name ?? 'User'}</DialogTitle>
            <DialogDescription>{u?.email ?? 'Loading…'}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
            {u && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <RoleBadge role={u.systemRole} /> <StatusBadge disabled={u.disabledAt !== null} />
                  {u.emailVerified ? (
                    <Badge tone="green">Email verified</Badge>
                  ) : (
                    <Badge tone="gray">Email not verified</Badge>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[14px]">
                  <div>
                    <dt className="text-muted-foreground">Joined</dt>
                    <dd>{formatDateTime(u.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Signed-in sessions</dt>
                    <dd>{u.activeSessions}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">API keys created</dt>
                    <dd>{u.apiKeyCount}</dd>
                  </div>
                  {u.disabledAt && (
                    <div>
                      <dt className="text-muted-foreground">Suspended</dt>
                      <dd>{formatDateTime(u.disabledAt)}</dd>
                    </div>
                  )}
                </dl>
                <div>
                  <h4 className="label-14 mb-2">Workspaces</h4>
                  {u.workspaces.length === 0 ? (
                    <p className="copy-14 text-muted-foreground">Not a member of any workspace.</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {u.workspaces.map((w) => (
                        <li
                          key={w.id}
                          className="flex items-center justify-between gap-3 px-3 py-2.5"
                        >
                          <Link
                            to={`/workspaces/${w.id}`}
                            onClick={onClose}
                            className="min-w-0 truncate text-[14px] font-medium hover:underline"
                          >
                            {w.name}
                          </Link>
                          <RoleBadge role={w.role} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {can('users:manage') && !self && (
                  <div className="flex justify-end border-t border-border pt-4">
                    {u.disabledAt ? (
                      <Button
                        variant="secondary"
                        loading={toggle.isPending}
                        onClick={() => toggle.mutate(false)}
                      >
                        <CheckCircle2 /> Re-enable account
                      </Button>
                    ) : (
                      <Button variant="destructive-outline" onClick={() => setConfirm(true)}>
                        <Ban /> Suspend account
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Suspend this account?"
        description="They are signed out everywhere immediately, cannot sign in, and their API keys stop working. Their workspaces and data are untouched. You can re-enable the account at any time."
        confirmLabel="Suspend account"
        destructive
        loading={toggle.isPending}
        onConfirm={() => toggle.mutate(true)}
      />
    </>
  );
}
