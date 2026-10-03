import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@go-short/ui/components/badge';
import { Button } from '@go-short/ui/components/button';
import { Callout } from '@go-short/ui/components/callout';
import { Card } from '@go-short/ui/components/card';
import { CodeValue } from '@go-short/ui/components/copy-button';
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
import { PageHeader } from '@go-short/ui/components/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@go-short/ui/components/states';
import { Table, TBody, TD, TH, THead, TR } from '@go-short/ui/components/table';
import { useWorkspace, wsKey, wsPath } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';
import { formatDate, formatRelative } from '@go-short/ui/lib/format';
import type { ApiKey, ApiKeyCreated } from '@/types/api';

function keyStatus(k: ApiKey): { label: string; tone: 'green' | 'gray' | 'amber' } {
  if (k.revokedAt) return { label: 'Revoked', tone: 'gray' };
  if (k.expiresAt && new Date(k.expiresAt) <= new Date())
    return { label: 'Expired', tone: 'amber' };
  return { label: 'Active', tone: 'green' };
}

export function ApiKeysPage() {
  const { workspace, canManage } = useWorkspace();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const keys = useQuery({
    queryKey: wsKey(workspace.id, 'api-keys'),
    enabled: canManage,
    queryFn: () => api<ApiKey[]>(wsPath(workspace, '/api-keys')),
  });
  const revoke = useMutation({
    mutationFn: (k: ApiKey) => api(wsPath(workspace, `/api-keys/${k.id}`), { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('API key revoked');
      setRevoking(null);
      void qc.invalidateQueries({ queryKey: wsKey(workspace.id, 'api-keys') });
    },
    onError: (e) => {
      setRevoking(null);
      toast.error(e instanceof ApiError ? e.message : 'Could not revoke the key');
    },
  });

  if (!canManage) return <Navigate to="/dashboard" replace />;
  return (
    <>
      <PageHeader
        title="API Keys"
        description="Use keys to call the API from scripts and integrations. Each key belongs to this workspace."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Create API key
          </Button>
        }
      />
      {keys.isError ? (
        <ErrorState error={keys.error} onRetry={() => void keys.refetch()} />
      ) : keys.isPending ? (
        <Card>
          <TableSkeleton rows={3} cols={5} />
        </Card>
      ) : keys.data.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No API keys"
          description="Create a key to use the REST API. Keys are shown once, so store them somewhere safe."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create API key
            </Button>
          }
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Name</TH>
                <TH>Key</TH>
                <TH>Access</TH>
                <TH className="hidden md:table-cell">Last used</TH>
                <TH className="hidden lg:table-cell">Expires</TH>
                <TH>Status</TH>
                <TH className="w-12">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {keys.data.map((k) => {
                const st = keyStatus(k);
                return (
                  <TR key={k.id}>
                    <TD>
                      <div className="font-medium">{k.name}</div>
                      {k.createdBy && (
                        <div className="text-xs text-muted-foreground">by {k.createdBy.name}</div>
                      )}
                    </TD>
                    <TD>
                      <code className="mono-13 text-muted-foreground">{k.keyPrefix}</code>
                    </TD>
                    <TD>
                      <Badge tone="outline">
                        {k.role === 'VIEWER' ? 'Read-only' : 'Read & write'}
                      </Badge>
                    </TD>
                    <TD className="hidden text-muted-foreground md:table-cell">
                      {formatRelative(k.lastUsedAt)}
                    </TD>
                    <TD className="hidden text-muted-foreground lg:table-cell">
                      {k.expiresAt ? formatDate(k.expiresAt) : 'Never'}
                    </TD>
                    <TD>
                      <Badge tone={st.tone} dot>
                        {st.label}
                      </Badge>
                    </TD>
                    <TD>
                      {!k.revokedAt && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Revoke ${k.name}`}
                          onClick={() => setRevoking(k)}
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
        </Card>
      )}
      <div className="mt-6 flex flex-col gap-3">
        <Callout tone="info" title="Using a key">
          Send it as <code className="mono-13">Authorization: Bearer &lt;key&gt;</code> to the flat
          routes such as <code className="mono-13">/api/v1/links</code>. See the{' '}
          <a
            href="/docs/api/authentication"
            target="_blank"
            rel="noreferrer"
            className="text-blue hover:underline"
          >
            API reference
          </a>
          . Keys cannot manage members, domains, webhooks or other keys.
        </Callout>
      </div>

      <CreateKeyDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(k) => {
          setCreated(k);
          void qc.invalidateQueries({ queryKey: wsKey(workspace.id, 'api-keys') });
        }}
      />
      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your new API key</DialogTitle>
            <DialogDescription>
              Copy it now. For your security it will never be shown again.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <CodeValue value={created?.key ?? ''} />
            <Callout tone="warning" title="Store this key securely">
              Anyone with it can act with{' '}
              {created?.role === 'VIEWER' ? 'read-only' : 'read & write'} access to this workspace.
              If it leaks, revoke it here.
            </Callout>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>I’ve saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke this API key?"
        description={
          <>
            Anything using <span className="mono-13 text-foreground">{revoking?.name}</span> will
            immediately stop working. This cannot be undone.
          </>
        }
        confirmLabel="Revoke key"
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      />
    </>
  );
}

function CreateKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (k: ApiKeyCreated) => void;
}) {
  const { workspace } = useWorkspace();
  const [name, setName] = useState('');
  const [role, setRole] = useState<'VIEWER' | 'MEMBER'>('MEMBER');
  const [expires, setExpires] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api<ApiKeyCreated>(wsPath(workspace, '/api-keys'), {
        method: 'POST',
        body: {
          name: name.trim(),
          role,
          ...(expires ? { expiresAt: new Date(`${expires}T23:59:59`).toISOString() } : {}),
        },
      }),
    onSuccess: (k) => {
      setName('');
      setExpires('');
      onOpenChange(false);
      onCreated(k);
    },
  });
  const err = create.error instanceof ApiError ? create.error : null;
  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>Give it a name that tells you where it is used.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            {err && !err.details.length && <Callout tone="danger">{err.message}</Callout>}
            <Field id="k-name" label="Name" error={err?.field('name')}>
              <Input
                id="k-name"
                autoFocus
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Zapier integration"
              />
            </Field>
            <Field
              id="k-role"
              label="Access"
              hint={
                role === 'VIEWER'
                  ? 'Can read links, campaigns, QR codes and analytics.'
                  : 'Can also create, edit and delete links, campaigns and QR codes.'
              }
            >
              <NativeSelect
                id="k-role"
                value={role}
                onChange={(e) => setRole(e.target.value as 'VIEWER' | 'MEMBER')}
              >
                <option value="MEMBER">Read & write</option>
                <option value="VIEWER">Read-only</option>
              </NativeSelect>
            </Field>
            <Field id="k-exp" label="Expiration" optional error={err?.field('expiresAt')}>
              <Input
                id="k-exp"
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
              Create key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
