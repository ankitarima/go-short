import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@go-short/ui/components/button';
import { Callout } from '@go-short/ui/components/callout';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@go-short/ui/components/dialog';
import { Disclosure } from '@go-short/ui/components/collapsible';
import { Field } from '@go-short/ui/components/field';
import { Input, NativeSelect, PasswordInput } from '@go-short/ui/components/input';
import { Switch } from '@go-short/ui/components/switch';
import { useWorkspace, wsPath } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';
import { isoToLocalInput, localToIso } from '@go-short/ui/lib/format';
import type { Link } from '@/types/api';
import { invalidateLinks, useCampaignOptions, useUsableDomains } from './hooks';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing. */
  link?: Link;
  /** Pre-selected campaign when creating from a campaign page. */
  campaignId?: string;
  onSaved?: (link: Link) => void;
}

const empty = {
  destinationUrl: '',
  domainId: '',
  slug: '',
  title: '',
  campaignId: '',
  utmSource: '',
  utmMedium: '',
  utmCampaign: '',
  utmTerm: '',
  utmContent: '',
  expiresAt: '',
  password: '',
  redirectStatus: '',
};

function fromLink(l: Link) {
  return {
    destinationUrl: l.destinationUrl,
    domainId: l.domainId,
    slug: l.slug,
    title: l.title ?? '',
    campaignId: l.campaignId ?? '',
    utmSource: l.utmSource ?? '',
    utmMedium: l.utmMedium ?? '',
    utmCampaign: l.utmCampaign ?? '',
    utmTerm: l.utmTerm ?? '',
    utmContent: l.utmContent ?? '',
    expiresAt: isoToLocalInput(l.expiresAt),
    password: '',
    redirectStatus: l.redirectStatus ? String(l.redirectStatus) : '',
  };
}

export function LinkFormDialog({ open, onOpenChange, link, campaignId, onSaved }: Props) {
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  const domains = useUsableDomains();
  const campaigns = useCampaignOptions();
  const [f, setF] = useState(empty);
  const [removePassword, setRemovePassword] = useState(false);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const editing = !!link;

  useEffect(() => {
    if (!open) return;
    setRemovePassword(false);
    setF(link ? fromLink(link) : { ...empty, campaignId: campaignId ?? '' });
  }, [open, link, campaignId]);

  // Default the domain once the list loads (workspace default first, then the first usable one).
  useEffect(() => {
    if (!open || editing || f.domainId || !domains.data?.length) return;
    const pick =
      domains.data.find((d) => d.isDefault && !d.shared) ??
      domains.data.find((d) => !d.shared) ??
      domains.data[0]!;
    setF((s) => ({ ...s, domainId: pick.id }));
  }, [open, editing, f.domainId, domains.data]);

  const host = domains.data?.find((d) => d.id === f.domainId)?.hostname ?? 'your-domain.com';
  const scheme = host.includes(':') || host === 'localhost' ? 'http' : 'https';

  const save = useMutation({
    mutationFn: () => {
      const n = (v: string) => (v.trim() === '' ? null : v.trim());
      const body: Record<string, unknown> = {
        destinationUrl: f.destinationUrl.trim(),
        title: n(f.title),
        campaignId: n(f.campaignId),
        utmSource: n(f.utmSource),
        utmMedium: n(f.utmMedium),
        utmCampaign: n(f.utmCampaign),
        utmTerm: n(f.utmTerm),
        utmContent: n(f.utmContent),
        expiresAt: f.expiresAt ? localToIso(f.expiresAt) : null,
        redirectStatus: f.redirectStatus ? Number(f.redirectStatus) : null,
      };
      if (editing) {
        body.domainId = f.domainId;
        body.slug = f.slug.trim();
        if (removePassword) body.password = null;
        else if (f.password) body.password = f.password;
        return api<Link>(wsPath(workspace, `/links/${link.id}`), { method: 'PATCH', body });
      }
      body.domainId = f.domainId || undefined;
      if (f.slug.trim()) body.slug = f.slug.trim();
      if (f.password) body.password = f.password;
      // On create, omit empty optional values instead of sending nulls.
      for (const k of Object.keys(body)) if (body[k] === null) delete body[k];
      return api<Link>(wsPath(workspace, '/links'), { method: 'POST', body });
    },
    onSuccess: (l) => {
      toast.success(editing ? 'Link updated' : 'Link created');
      invalidateLinks(qc, workspace.id);
      onOpenChange(false);
      onSaved?.(l);
    },
  });
  const err = save.error instanceof ApiError ? save.error : null;
  const slugErr =
    err && ['SLUG_TAKEN', 'SLUG_RESERVED', 'SLUG_INVALID'].includes(err.code)
      ? err.message
      : err?.field('slug');
  const fieldErrors = [
    'destinationUrl',
    'slug',
    'domainId',
    'campaignId',
    'expiresAt',
    'password',
    'title',
  ];
  const generalErr = err && !slugErr && !fieldErrors.some((k) => err.field(k)) ? err : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit link' : 'Create link'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Changes apply to new clicks immediately.'
                : 'Paste a long URL and optionally choose your own slug.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            {generalErr && <Callout tone="danger">{generalErr.message}</Callout>}
            <Field id="destinationUrl" label="Destination URL" error={err?.field('destinationUrl')}>
              <Input
                id="destinationUrl"
                type="url"
                required
                autoFocus
                placeholder="https://example.com/landing-page"
                value={f.destinationUrl}
                onChange={set('destinationUrl')}
                aria-invalid={!!err?.field('destinationUrl')}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="domainId" label="Domain" error={err?.field('domainId')}>
                <NativeSelect id="domainId" value={f.domainId} onChange={set('domainId')} required>
                  {!domains.data?.length && <option value="">Loading…</option>}
                  {domains.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.hostname}
                      {d.shared ? ' (shared)' : ''}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="slug" label="Custom slug" optional={!editing} error={slugErr}>
                <Input
                  id="slug"
                  placeholder={editing ? '' : 'random if empty'}
                  value={f.slug}
                  onChange={set('slug')}
                  maxLength={64}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!slugErr}
                  required={editing}
                />
              </Field>
            </div>

            <div className="rounded-md border border-border bg-surface px-3 py-2">
              <div className="text-xs text-subtle-foreground">Short link preview</div>
              <div className="mono-13 truncate" data-testid="link-preview">
                {scheme}://{host}/{f.slug || <span className="text-subtle-foreground">aK92xP</span>}
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="title" label="Title" optional>
                <Input
                  id="title"
                  maxLength={200}
                  value={f.title}
                  onChange={set('title')}
                  placeholder="Summer sale"
                />
              </Field>
              <Field id="campaignId" label="Campaign" optional error={err?.field('campaignId')}>
                <NativeSelect id="campaignId" value={f.campaignId} onChange={set('campaignId')}>
                  <option value="">No campaign</option>
                  {campaigns.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>

            <Disclosure title="UTM parameters" hint="Appended to the destination">
              <div className="grid gap-4 sm:grid-cols-2">
                {(['utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent'] as const).map(
                  (k) => (
                    <Field key={k} id={k} label={k.replace('utm', 'utm_').toLowerCase()}>
                      <Input id={k} maxLength={200} value={f[k]} onChange={set(k)} />
                    </Field>
                  ),
                )}
              </div>
              <p className="copy-13 mt-3 text-muted-foreground">
                Parameters already present on the destination URL are never overridden or
                duplicated.
              </p>
            </Disclosure>

            <Disclosure title="Expiration & protection">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="expiresAt" label="Expires at" optional error={err?.field('expiresAt')}>
                  <Input
                    id="expiresAt"
                    type="datetime-local"
                    value={f.expiresAt}
                    onChange={set('expiresAt')}
                  />
                </Field>
                <Field
                  id="redirectStatus"
                  label="Redirect type"
                  hint="302 is safest if you edit destinations."
                >
                  <NativeSelect
                    id="redirectStatus"
                    value={f.redirectStatus}
                    onChange={set('redirectStatus')}
                  >
                    <option value="">Default</option>
                    <option value="302">302 Temporary</option>
                    <option value="307">307 Temporary (keep method)</option>
                    <option value="301">301 Permanent</option>
                    <option value="308">308 Permanent (keep method)</option>
                  </NativeSelect>
                </Field>
                <Field
                  id="password"
                  label={editing && link?.hasPassword ? 'New password' : 'Password'}
                  optional
                  hint="Visitors must enter it before being redirected."
                  error={err?.field('password')}
                >
                  <PasswordInput
                    id="password"

                    autoComplete="new-password"
                    minLength={4}
                    maxLength={128}
                    value={f.password}
                    onChange={set('password')}
                    disabled={removePassword}
                  />
                </Field>
                {editing && link?.hasPassword && (
                  <label className="mt-7 flex items-center gap-2 text-sm">
                    <Switch
                      checked={removePassword}
                      onCheckedChange={setRemovePassword}
                      aria-label="Remove password"
                    />{' '}
                    Remove password protection
                  </label>
                )}
              </div>
            </Disclosure>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={save.isPending}
              disabled={!f.destinationUrl.trim() || !f.domainId}
            >
              {editing ? 'Save changes' : 'Create link'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
