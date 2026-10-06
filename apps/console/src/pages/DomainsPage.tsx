import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Badge } from '@go-short/ui/components/badge';
import { Button } from '@go-short/ui/components/button';
import { Callout } from '@go-short/ui/components/callout';
import { Card } from '@go-short/ui/components/card';
import { Checkbox } from '@go-short/ui/components/checkbox';
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
import { Input } from '@go-short/ui/components/input';
import { EmptyState, ErrorState, TableSkeleton } from '@go-short/ui/components/states';
import { PageHeader } from '@go-short/ui/components/page-header';
import { TBody, TD, TH, THead, TR, Table } from '@go-short/ui/components/table';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { SharedDomain, SharedDomainDns, SharedDomains } from '@/types';
import { useConsole } from '@/hooks/useConsole';

type Pending =
  | { kind: 'default'; domain: SharedDomain }
  | { kind: 'disable'; domain: SharedDomain }
  | { kind: 'remove'; domain: SharedDomain };

const DNS_TEXT: Record<SharedDomainDns['result'], (d: SharedDomainDns) => string> = {
  matches: () => 'DNS points at this server. Short links on it will work.',
  differs: (d) =>
    `It resolves to ${d.addresses.join(', ')}, but the app is at ${d.appAddresses.join(', ')}. If the domain sits behind a proxy or CDN this is fine; otherwise point it at the server.`,
  not_resolving: () =>
    'No DNS records found yet. Add an A record pointing at your server (records can take a while to appear).',
  unknown: (d) =>
    `It resolves to ${d.addresses.join(', ')}, but the app’s own address could not be looked up to compare.`,
};

/** Reports a DNS check as a toast: success only when the addresses match, a warning otherwise. */
function reportDns(r: SharedDomainDns) {
  const message = DNS_TEXT[r.result](r);
  if (r.result === 'matches') toast.success(r.hostname, { description: message });
  else toast.warning(r.hostname, { description: message, duration: 12_000 });
}

export function DomainsPage() {
  const { can } = useConsole();
  const canManage = can('domains:manage');
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['console', 'shared-domains'],
    queryFn: () => api<SharedDomains>('/admin/shared-domains'),
  });
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['console', 'shared-domains'] });
  const fail = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : 'Something went wrong');

  const patch = useMutation({
    mutationFn: (v: { id: string; body: { isDefault?: true; disabled?: boolean } }) =>
      api(`/admin/shared-domains/${v.id}`, { method: 'PATCH', body: v.body }),
    onSuccess: () => {
      toast.success('Saved');
      setPending(null);
      refresh();
    },
    onError: (e) => {
      setPending(null);
      fail(e);
    },
  });
  const remove = useMutation({
    mutationFn: (d: SharedDomain) => api(`/admin/shared-domains/${d.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Domain removed');
      setPending(null);
      refresh();
    },
    onError: (e) => {
      setPending(null);
      fail(e);
    },
  });
  const checkDns = useMutation({
    mutationFn: (d: SharedDomain) => api<SharedDomainDns>(`/admin/shared-domains/${d.id}/dns`),
    onSuccess: reportDns,
    onError: fail,
  });

  const domains = q.data?.domains ?? [];
  const activeCount = domains.filter((d) => d.status === 'VERIFIED').length;

  return (
    <>
      <PageHeader
        title="Short domains"
        description="The hostnames every workspace can put short links on. Add and switch them here; no environment variables or redeploys."
        actions={
          canManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add domain
            </Button>
          )
        }
      />
      {!canManage && (
        <Callout tone="info" className="mb-6">
          Only a super admin can change short domains. You can see what is configured.
        </Callout>
      )}
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <Card>
          <TableSkeleton rows={3} cols={4} />
        </Card>
      ) : domains.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No short domains"
          description="Without one, nobody can create links."
        />
      ) : (
        <>
          <Card>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Domain</TH>
                  <TH>Status</TH>
                  <TH className="hidden md:table-cell">Links</TH>
                  <TH className="hidden md:table-cell">Added</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {domains.map((d) => (
                  <TR key={d.id}>
                    <TD>
                      <span className="font-medium">{d.hostname}</span>
                      {d.isDefault && (
                        <Badge tone="blue" className="ml-2">
                          Default
                        </Badge>
                      )}
                    </TD>
                    <TD>
                      {d.status === 'VERIFIED' ? (
                        <Badge tone="green" dot>
                          Active
                        </Badge>
                      ) : (
                        <Badge tone="red" dot>
                          Disabled
                        </Badge>
                      )}
                    </TD>
                    <TD className="hidden text-muted-foreground md:table-cell">
                      {d.linkCount.toLocaleString()}
                    </TD>
                    <TD className="hidden text-muted-foreground md:table-cell">
                      {formatDate(d.createdAt)}
                    </TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Check DNS for ${d.hostname}`}
                          loading={checkDns.isPending && checkDns.variables?.id === d.id}
                          onClick={() => checkDns.mutate(d)}
                        >
                          Check DNS
                        </Button>
                        {canManage && (
                          <>
                            {!d.isDefault && d.status === 'VERIFIED' && (
                              <Button
                                variant="secondary"
                                size="sm"
                                aria-label={`Make ${d.hostname} the default`}
                                onClick={() => setPending({ kind: 'default', domain: d })}
                              >
                                Make default
                              </Button>
                            )}
                            {!d.isDefault &&
                              (d.status === 'VERIFIED' ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label={`Disable ${d.hostname}`}
                                  onClick={() => setPending({ kind: 'disable', domain: d })}
                                >
                                  Disable
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label={`Enable ${d.hostname}`}
                                  onClick={() =>
                                    patch.mutate({ id: d.id, body: { disabled: false } })
                                  }
                                >
                                  Enable
                                </Button>
                              ))}
                            {!d.isDefault && (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove ${d.hostname}`}
                                onClick={() => setPending({ kind: 'remove', domain: d })}
                              >
                                <Trash2 />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-background p-4">
              <h2 className="text-[14px] font-medium">What the default does</h2>
              <p className="copy-13 mt-1.5 text-muted-foreground">
                New links use the default domain unless the person picks another. Existing links
                keep the domain they were created on. Workspaces see every active domain in the link
                form.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background p-4">
              <h2 className="text-[14px] font-medium">Customers’ own domains</h2>
              <p className="copy-13 mt-1.5 text-muted-foreground">
                Workspaces that connect a custom domain are told to point a CNAME at the default
                domain:
              </p>
              <CodeValue value={q.data.cnameTarget} className="mt-2" />
              <p className="copy-13 mt-2 text-muted-foreground">
                Changing the default changes this for new custom domains. Ones already pointed at
                another active domain here still verify.
              </p>
            </div>
          </div>
        </>
      )}
      <AddDomainDialog
        open={adding}
        onOpenChange={setAdding}
        appHostname={q.data?.appHostname}
        onAdded={refresh}
      />
      <ConfirmDialog
        open={pending?.kind === 'default'}
        onOpenChange={(o) => !o && setPending(null)}
        title="Make this the default domain?"
        description={
          <>
            New links will use <strong>{pending?.domain.hostname}</strong> and new custom domains
            will be told to CNAME to it. Existing links are not changed.
          </>
        }
        confirmLabel="Make default"
        loading={patch.isPending}
        onConfirm={() =>
          pending && patch.mutate({ id: pending.domain.id, body: { isDefault: true } })
        }
      />
      <ConfirmDialog
        open={pending?.kind === 'disable'}
        onOpenChange={(o) => !o && setPending(null)}
        title="Disable this domain?"
        description={
          <>
            {pending && pending.domain.linkCount > 0 ? (
              <>
                The {pending.domain.linkCount.toLocaleString()} link
                {pending.domain.linkCount === 1 ? '' : 's'} on{' '}
                <strong>{pending.domain.hostname}</strong> will stop redirecting, and nobody can
                create new ones on it. You can enable it again later.
              </>
            ) : (
              <>
                <strong>{pending?.domain.hostname}</strong> will no longer be offered for new links.
                You can enable it again later.
              </>
            )}
            {activeCount <= 2 && ' At least one active domain must remain.'}
          </>
        }
        confirmLabel="Disable"
        destructive
        loading={patch.isPending}
        onConfirm={() =>
          pending && patch.mutate({ id: pending.domain.id, body: { disabled: true } })
        }
      />
      <ConfirmDialog
        open={pending?.kind === 'remove'}
        onOpenChange={(o) => !o && setPending(null)}
        title="Remove this domain?"
        description={
          <>
            <strong>{pending?.domain.hostname}</strong> is removed from the platform. This only
            works while no links use it; otherwise disable it instead.
          </>
        }
        confirmLabel="Remove domain"
        destructive
        loading={remove.isPending}
        onConfirm={() => pending && remove.mutate(pending.domain)}
      />
    </>
  );
}

function AddDomainDialog({
  open,
  onOpenChange,
  onAdded,
  appHostname,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdded: () => void;
  appHostname: string | undefined;
}) {
  const [hostname, setHostname] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const add = useMutation({
    mutationFn: () =>
      api<SharedDomain>('/admin/shared-domains', {
        method: 'POST',
        body: { hostname, makeDefault },
      }),
    onSuccess: async (d) => {
      toast.success(`${d.hostname} added`);
      setHostname('');
      setMakeDefault(false);
      onOpenChange(false);
      onAdded();
      // Say right away if it will not work yet, instead of letting the first short link fail.
      try {
        reportDns(await api<SharedDomainDns>(`/admin/shared-domains/${d.id}/dns`));
      } catch {
        /* the hint is optional */
      }
    },
  });
  const err = add.error instanceof ApiError ? add.error : null;
  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) add.reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Add a short domain</DialogTitle>
            <DialogDescription>
              Every workspace can then create links on it. Point its DNS at your server first
              {appHostname ? ` (the same address as ${appHostname})` : ''}.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            {err && !err.field('hostname') && <Callout tone="danger">{err.message}</Callout>}
            <Field
              id="shared-hostname"
              label="Domain"
              error={err?.field('hostname')}
              hint="A hostname only, e.g. go.example.com."
            >
              <Input
                id="shared-hostname"
                required
                autoFocus
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="go.example.com"
                autoCapitalize="none"
                spellCheck={false}
              />
            </Field>
            <label className="flex items-start gap-2.5 text-[14px]">
              <Checkbox
                checked={makeDefault}
                onCheckedChange={(v) => setMakeDefault(v === true)}
                className="mt-0.5"
              />
              <span>
                Make it the default
                <span className="copy-13 block text-muted-foreground">
                  New links and new custom-domain instructions will use it. The first domain is
                  always the default.
                </span>
              </span>
            </label>
            <Callout tone="info">
              On Coolify, also add the hostname to the <strong>web</strong> service’s domains so the
              proxy issues its certificate. With the standalone Caddy stack it is automatic.
            </Callout>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={add.isPending} disabled={!hostname.trim()}>
              Add domain
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
