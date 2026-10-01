import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MoreHorizontal,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Webhook as WebhookIcon,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { CodeValue } from '@/components/ui/copy-button';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Switch } from '@/components/ui/switch';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useWorkspace, wsKey, wsPath } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';
import type { Webhook, WebhookCreated } from '@/types/api';

const EVENTS = [
  'link.created',
  'link.updated',
  'link.deleted',
  'campaign.created',
  'domain.verified',
] as const;

export function WebhooksPanel() {
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ secret: string; url: string } | null>(null);
  const [deleting, setDeleting] = useState<Webhook | null>(null);
  const key = wsKey(workspace.id, 'webhooks');
  const hooks = useQuery({
    queryKey: key,
    queryFn: () => api<Webhook[]>(wsPath(workspace, '/webhooks')),
  });
  const fail = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : 'Something went wrong');
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const toggle = useMutation({
    mutationFn: (w: Webhook) =>
      api(wsPath(workspace, `/webhooks/${w.id}`), {
        method: 'PATCH',
        body: { isActive: !w.isActive },
      }),
    onSuccess: refresh,
    onError: fail,
  });
  const test = useMutation({
    mutationFn: (w: Webhook) =>
      api(wsPath(workspace, `/webhooks/${w.id}/test`), { method: 'POST' }),
    onSuccess: () => toast.success('Test event queued'),
    onError: fail,
  });
  const rotate = useMutation({
    mutationFn: (w: Webhook) =>
      api<{ secret: string }>(wsPath(workspace, `/webhooks/${w.id}/rotate-secret`), {
        method: 'POST',
      }).then((r) => ({ ...r, url: w.url })),
    onSuccess: (r) => setSecret(r),
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (w: Webhook) => api(wsPath(workspace, `/webhooks/${w.id}`), { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(null);
      toast.success('Webhook deleted');
      refresh();
    },
    onError: (e) => {
      setDeleting(null);
      fail(e);
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <p className="copy-14 max-w-2xl text-muted-foreground">
          Get an HTTPS request when something happens in this workspace. Each delivery is signed so
          you can verify it came from here.
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> Add webhook
        </Button>
      </div>
      {hooks.isError ? (
        <ErrorState error={hooks.error} onRetry={() => void hooks.refetch()} />
      ) : hooks.isPending ? (
        <Card>
          <TableSkeleton rows={2} cols={4} />
        </Card>
      ) : hooks.data.length === 0 ? (
        <EmptyState
          icon={WebhookIcon}
          title="No webhooks"
          description="Add an endpoint to be notified when links, campaigns or domains change."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus /> Add webhook
            </Button>
          }
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Endpoint</TH>
                <TH>Events</TH>
                <TH>Active</TH>
                <TH className="w-12">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {hooks.data.map((w) => (
                <TR key={w.id}>
                  <TD>
                    <span className="mono-13 block max-w-xs truncate" title={w.url}>
                      {w.url}
                    </span>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {w.events.map((e) => (
                        <Badge key={e} tone="outline">
                          {e}
                        </Badge>
                      ))}
                    </div>
                  </TD>
                  <TD>
                    <Switch
                      checked={w.isActive}
                      onCheckedChange={() => toggle.mutate(w)}
                      aria-label={`${w.isActive ? 'Disable' : 'Enable'} webhook`}
                    />
                  </TD>
                  <TD>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Webhook actions">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => test.mutate(w)}>
                          <Send /> Send test event
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => rotate.mutate(w)}>
                          <RefreshCw /> Rotate secret
                        </DropdownMenuItem>
                        <DropdownMenuItem destructive onSelect={() => setDeleting(w)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      <Callout tone="info" title="Verifying deliveries">
        Each request has{' '}
        <code className="mono-13">X-GoShort-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code>, an
        HMAC-SHA256 of <code className="mono-13">&lt;t&gt;.&lt;raw body&gt;</code> with your secret.
        Compare in constant time and reject old timestamps. Failed deliveries are retried with
        backoff.
      </Callout>

      <CreateWebhookDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(w) => {
          refresh();
          setSecret({ secret: w.secret, url: w.url });
        }}
      />
      <Dialog open={!!secret} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Signing secret</DialogTitle>
            <DialogDescription>
              Copy it now. It is shown only once, but you can rotate it any time.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div className="mono-13 truncate text-xs text-muted-foreground">{secret?.url}</div>
            <CodeValue value={secret?.secret ?? ''} />
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setSecret(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this webhook?"
        description="It will stop receiving events immediately."
        confirmLabel="Delete webhook"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  );
}

function CreateWebhookDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (w: WebhookCreated) => void;
}) {
  const { workspace } = useWorkspace();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['link.created']);
  const create = useMutation({
    mutationFn: () =>
      api<WebhookCreated>(wsPath(workspace, '/webhooks'), {
        method: 'POST',
        body: { url: url.trim(), events },
      }),
    onSuccess: (w) => {
      setUrl('');
      setEvents(['link.created']);
      onOpenChange(false);
      onCreated(w);
    },
  });
  const err = create.error instanceof ApiError ? create.error : null;
  const toggle = (e: string) =>
    setEvents((s) => (s.includes(e) ? s.filter((x) => x !== e) : [...s, e]));
  function submit(f: FormEvent) {
    f.preventDefault();
    create.mutate();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Add webhook</DialogTitle>
            <DialogDescription>Must be a public HTTPS URL.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <Field
              id="wh-url"
              label="Endpoint URL"
              error={err?.field('url') ?? (err && !err.details.length ? err.message : undefined)}
            >
              <Input
                id="wh-url"
                type="url"
                required
                autoFocus
                placeholder="https://example.com/hooks/go-short"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Field>
            <fieldset className="flex flex-col gap-2.5">
              <legend className="label-14 mb-1">Events</legend>
              {EVENTS.map((e) => (
                <label key={e} className="flex items-center gap-2.5 text-sm">
                  <Checkbox
                    checked={events.includes(e)}
                    onCheckedChange={() => toggle(e)}
                    aria-label={e}
                  />
                  <span className="mono-13">{e}</span>
                </label>
              ))}
            </fieldset>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={create.isPending}
              disabled={!url.trim() || events.length === 0}
            >
              Create webhook
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
