import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Avatar } from '@go-short/ui/components/avatar';
import { Button } from '@go-short/ui/components/button';
import { Callout } from '@go-short/ui/components/callout';
import { Card } from '@go-short/ui/components/card';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@go-short/ui/components/dialog';
import { Field } from '@go-short/ui/components/field';
import { Input, NativeSelect } from '@go-short/ui/components/input';
import { EmptyState, ErrorState, TableSkeleton } from '@go-short/ui/components/states';
import { PageHeader } from '@go-short/ui/components/page-header';
import { TBody, TD, TH, THead, TR, Table } from '@go-short/ui/components/table';
import { ApiError, api } from '@/lib/api';
import { ROLE_HINT, ROLE_LABEL, formatDate } from '@/lib/format';
import type { StaffMember, StaffRole } from '@/types';
import { PagerFooter, RoleBadge, StatusBadge } from '@/components/bits';
import { useClientPaging } from '@/hooks/usePaging';
import { useConsole } from '@/hooks/useConsole';

const ROLES: StaffRole[] = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'];

export function StaffPage() {
  const { can, session } = useConsole();
  const canManage = can('staff:manage');
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['console', 'staff'],
    queryFn: () => api<StaffMember[]>('/admin/staff'),
  });
  const staffPage = useClientPaging(q.data ?? [], 10);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['console'] });
  const fail = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : 'Something went wrong');

  const change = useMutation({
    mutationFn: (v: { id: string; role: StaffRole }) =>
      api(`/admin/staff/${v.id}`, { method: 'PATCH', body: { role: v.role } }),
    onSuccess: () => {
      toast.success('Role updated');
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (m: StaffMember) => api(`/admin/staff/${m.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Platform access removed');
      setRemoving(null);
      refresh();
    },
    onError: (e) => {
      setRemoving(null);
      fail(e);
    },
  });

  return (
    <>
      <PageHeader
        title="Platform staff"
        description="The people who can use this console. Everyone else only sees their own workspaces."
        actions={
          canManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add staff
            </Button>
          )
        }
      />
      {!canManage && (
        <Callout tone="info" className="mb-6">
          Only a super admin can add, change or remove staff. You can see who has access.
        </Callout>
      )}
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r} className="rounded-xl border border-border bg-background p-4">
            <RoleBadge role={r} />
            <p className="copy-13 mt-2 text-muted-foreground">{ROLE_HINT[r]}</p>
          </div>
        ))}
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <Card>
          <TableSkeleton rows={4} cols={4} />
        </Card>
      ) : q.data.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No staff yet" />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Person</TH>
                <TH>Role</TH>
                <TH>Status</TH>
                <TH className="hidden md:table-cell">Account created</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {staffPage.rows.map((m) => {
                const self = m.id === session.user.id;
                return (
                  <TR key={m.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <Avatar name={m.email} size={32} />
                        <div className="min-w-0">
                          <div className="font-medium">
                            {m.name}
                            {self && (
                              <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                        </div>
                      </div>
                    </TD>
                    <TD>
                      {canManage && !self ? (
                        <NativeSelect
                          aria-label={`Role for ${m.email}`}
                          className="h-8 w-36 text-[13px]"
                          value={m.role}
                          onChange={(e) =>
                            change.mutate({ id: m.id, role: e.target.value as StaffRole })
                          }
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : (
                        <RoleBadge role={m.role} />
                      )}
                    </TD>
                    <TD>
                      <StatusBadge disabled={m.disabled} />
                    </TD>
                    <TD className="hidden text-muted-foreground md:table-cell">
                      {formatDate(m.createdAt)}
                    </TD>
                    <TD className="text-right">
                      {canManage && !self && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${m.email}`}
                          onClick={() => setRemoving(m)}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <PagerFooter pager={staffPage.pager} />
        </Card>
      )}
      <AddStaffDialog open={adding} onOpenChange={setAdding} onAdded={refresh} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove platform access?"
        description={
          <>
            {removing?.email} will no longer be able to use the console. Their account and
            workspaces are not affected.
          </>
        }
        confirmLabel="Remove access"
        destructive
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </>
  );
}

function AddStaffDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdded: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('MANAGER');
  const add = useMutation({
    mutationFn: () => api('/admin/staff', { method: 'POST', body: { email, role } }),
    onSuccess: () => {
      toast.success(`${email} added as ${ROLE_LABEL[role].toLowerCase()}`);
      setEmail('');
      onOpenChange(false);
      onAdded();
    },
  });
  const err = add.error instanceof ApiError ? add.error : null;
  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Add platform staff</DialogTitle>
            <DialogDescription>
              The person must already have a goShort account. Their access starts immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            {err && !err.field('email') && <Callout tone="danger">{err.message}</Callout>}
            <Field id="staff-email" label="Account email" error={err?.field('email')}>
              <Input
                id="staff-email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@example.com"
              />
            </Field>
            <Field id="staff-role" label="Role" hint={ROLE_HINT[role]}>
              <NativeSelect
                id="staff-role"
                value={role}
                onChange={(e) => setRole(e.target.value as StaffRole)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={add.isPending} disabled={!email}>
              Add staff
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
