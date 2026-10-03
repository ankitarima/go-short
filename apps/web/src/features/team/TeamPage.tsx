import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Trash2, UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Avatar } from '@go-short/ui/components/avatar';
import { Badge } from '@go-short/ui/components/badge';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@go-short/ui/components/dropdown-menu';
import { Field } from '@go-short/ui/components/field';
import { Input, NativeSelect } from '@go-short/ui/components/input';
import { PageHeader } from '@go-short/ui/components/page-header';
import { ErrorState, TableSkeleton } from '@go-short/ui/components/states';
import { Table, TBody, TD, TH, THead, TR } from '@go-short/ui/components/table';
import { useWorkspace, wsKey, wsPath } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';
import { ROLE_LABEL, formatDate } from '@go-short/ui/lib/format';
import type { Member, Role } from '@/types/api';

const ROLES: Role[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];
const RANK: Record<Role, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };
const ROLE_HINT: Record<Role, string> = {
  OWNER: 'Everything, including deleting the workspace',
  ADMIN: 'Manage links, domains, members and API keys',
  MEMBER: 'Create and edit links, campaigns and QR codes',
  VIEWER: 'Read-only access to links and analytics',
};

export function TeamPage() {
  const { workspace, me, role, canManage } = useWorkspace();
  const qc = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const members = useQuery({
    queryKey: wsKey(workspace.id, 'members'),
    queryFn: () => api<Member[]>(wsPath(workspace, '/members')),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: wsKey(workspace.id, 'members') });
  const fail = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : 'Something went wrong');

  const changeRole = useMutation({
    mutationFn: ({ m, role: r }: { m: Member; role: Role }) =>
      api(wsPath(workspace, `/members/${m.id}`), { method: 'PATCH', body: { role: r } }),
    onSuccess: () => {
      toast.success('Role updated');
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (m: Member) => api(wsPath(workspace, `/members/${m.id}`), { method: 'DELETE' }),
    onSuccess: (_d, m) => {
      setRemoving(null);
      if (m.user.id === me.user.id) {
        toast.success('You left the workspace');
        void qc.invalidateQueries({ queryKey: ['me'] });
      } else {
        toast.success('Member removed');
        refresh();
      }
    },
    onError: (e) => {
      setRemoving(null);
      fail(e);
    },
  });

  // Roles the current user may hand out (never above their own).
  const assignable = ROLES.filter(
    (r) => RANK[r] <= RANK[role] && (r !== 'OWNER' || role === 'OWNER'),
  );

  return (
    <>
      <PageHeader
        title="Team"
        description={`People with access to ${workspace.name}.`}
        actions={
          canManage && (
            <Button onClick={() => setInviting(true)}>
              <UserPlus /> Invite member
            </Button>
          )
        }
      />
      {members.isError ? (
        <ErrorState error={members.error} onRetry={() => void members.refetch()} />
      ) : members.isPending ? (
        <Card>
          <TableSkeleton rows={3} cols={3} />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Member</TH>
                <TH>Role</TH>
                <TH className="hidden md:table-cell">Joined</TH>
                <TH className="w-12">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {members.data.map((m) => {
                const self = m.user.id === me.user.id;
                const editable =
                  canManage &&
                  !self &&
                  RANK[m.role] <= RANK[role] &&
                  (m.role !== 'OWNER' || role === 'OWNER');
                return (
                  <TR key={m.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <Avatar name={m.user.email} size={32} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-medium">
                            {m.user.name}
                            {self && <Badge tone="outline">You</Badge>}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {m.user.email}
                          </div>
                        </div>
                      </div>
                    </TD>
                    <TD>
                      {editable ? (
                        <NativeSelect
                          aria-label={`Role for ${m.user.name}`}
                          value={m.role}
                          onChange={(e) => changeRole.mutate({ m, role: e.target.value as Role })}
                          className="h-8 w-32 text-[13px]"
                        >
                          {assignable.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : (
                        <Badge tone={m.role === 'OWNER' ? 'inverted' : 'gray'}>
                          {ROLE_LABEL[m.role]}
                        </Badge>
                      )}
                    </TD>
                    <TD className="hidden text-muted-foreground md:table-cell">
                      {formatDate(m.createdAt)}
                    </TD>
                    <TD>
                      {(editable || self) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Actions for ${m.user.name}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem destructive onSelect={() => setRemoving(m)}>
                              <Trash2 /> {self ? 'Leave workspace' : 'Remove from workspace'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((r) => (
          <div key={r} className="rounded-lg border border-border p-3">
            <div className="label-14">{ROLE_LABEL[r]}</div>
            <p className="copy-13 mt-0.5 text-muted-foreground">{ROLE_HINT[r]}</p>
          </div>
        ))}
      </div>

      <InviteDialog
        open={inviting}
        onOpenChange={setInviting}
        roles={assignable.filter((r) => r !== 'OWNER')}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={
          removing?.user.id === me.user.id
            ? 'Leave this workspace?'
            : `Remove ${removing?.user.name}?`
        }
        description={
          removing?.user.id === me.user.id
            ? 'You will lose access to its links and analytics. A workspace always keeps at least one owner.'
            : 'They will lose access immediately and any API keys they created stop working.'
        }
        confirmLabel={removing?.user.id === me.user.id ? 'Leave' : 'Remove'}
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  roles,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  roles: Role[];
}) {
  const { workspace } = useWorkspace();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('MEMBER');
  const invite = useMutation({
    mutationFn: () =>
      api(wsPath(workspace, '/members/invite'), { method: 'POST', body: { email, role } }),
    onSuccess: () => {
      toast.success(`Invitation sent to ${email}`);
      setEmail('');
      onOpenChange(false);
    },
  });
  const err = invite.error instanceof ApiError ? invite.error : null;
  function submit(e: FormEvent) {
    e.preventDefault();
    invite.mutate();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Invite a member</DialogTitle>
            <DialogDescription>
              They’ll get an email with a link that works for 7 days.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            {err && !err.field('email') && <Callout tone="danger">{err.message}</Callout>}
            <Field id="inv-email" label="Email" error={err?.field('email')}>
              <Input
                id="inv-email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
              />
            </Field>
            <Field id="inv-role" label="Role" hint={ROLE_HINT[role]}>
              <NativeSelect
                id="inv-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                {roles.map((r) => (
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
            <Button type="submit" loading={invite.isPending} disabled={!email}>
              Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
