import { useMutation } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { CodeValue } from '@/components/ui/copy-button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useWorkspace, wsPath } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Domain, DomainVerification } from '@/types/api';

const STEPS = ['Domain', 'DNS', 'Verify', 'HTTPS', 'Ready'] as const;

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2 px-6 pt-5" aria-label="Setup progress">
      {STEPS.map((label, i) => (
        <li
          key={label}
          className="flex flex-1 items-center gap-2"
          aria-current={i === step ? 'step' : undefined}
        >
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
              i < step
                ? 'border-foreground bg-foreground text-background'
                : i === step
                  ? 'border-foreground'
                  : 'border-border-strong text-subtle-foreground',
            )}
          >
            {i < step ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span
            className={cn(
              'hidden text-xs sm:block',
              i === step ? 'font-medium' : 'text-subtle-foreground',
            )}
          >
            {label}
          </span>
          {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
        </li>
      ))}
    </ol>
  );
}

function Record({
  title,
  rec,
}: {
  title: string;
  rec: { type: string; name: string; value: string };
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="label-14 mb-3">{title}</div>
      <div className="grid gap-3 sm:grid-cols-[80px_1fr]">
        <div>
          <div className="mb-1 text-xs text-subtle-foreground">Type</div>
          <div className="mono-13">{rec.type}</div>
        </div>
        <div className="min-w-0">
          <div className="mb-1 text-xs text-subtle-foreground">Name / Host</div>
          <CodeValue value={rec.name} />
        </div>
      </div>
      <div className="mt-3">
        <div className="mb-1 text-xs text-subtle-foreground">Value / Points to</div>
        <CodeValue value={rec.value} />
      </div>
    </div>
  );
}

export function DomainWizard({
  open,
  onOpenChange,
  domain: initial,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  domain?: Domain;
  onChanged: () => void;
}) {
  const { workspace } = useWorkspace();
  const [step, setStep] = useState(0);
  const [hostname, setHostname] = useState('');
  const [domain, setDomain] = useState<Domain | undefined>(undefined);
  const [notYet, setNotYet] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNotYet(false);
    setHostname(initial?.hostname ?? '');
    setDomain(initial);
    setStep(initial ? (initial.isVerified ? 3 : 1) : 0);
  }, [open, initial]);

  const create = useMutation({
    mutationFn: () =>
      api<Domain>(wsPath(workspace, '/domains'), { method: 'POST', body: { hostname } }),
    onSuccess: (d) => {
      setDomain(d);
      setStep(1);
      onChanged();
    },
  });
  const verify = useMutation({
    mutationFn: () =>
      api<DomainVerification>(wsPath(workspace, `/domains/${domain!.id}/verify`), {
        method: 'POST',
      }),
    onSuccess: (r) => {
      setDomain(r.domain);
      onChanged();
      if (r.verified) {
        setNotYet(false);
        setStep(3);
      } else setNotYet(true);
    },
  });
  const createErr = create.error instanceof ApiError ? create.error : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Connect a custom domain</DialogTitle>
          <DialogDescription>
            Five quick steps. DNS changes can take a few minutes to propagate.
          </DialogDescription>
        </DialogHeader>
        <Stepper step={step} />

        {step === 0 && (
          <form onSubmit={submit} className="flex min-h-0 flex-col">
            <DialogBody>
              <Field
                id="hostname"
                label="Domain"
                hint="Use a subdomain such as links.example.com (apex domains work through the TXT method)."
                error={createErr?.message}
              >
                <Input
                  id="hostname"
                  autoFocus
                  required
                  placeholder="links.example.com"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  aria-invalid={!!createErr}
                  spellCheck={false}
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending} disabled={!hostname.trim()}>
                Continue
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === 1 && domain?.dns && (
          <>
            <DialogBody className="flex flex-col gap-4">
              <p className="copy-14 text-muted-foreground">
                Add this record at your DNS provider for{' '}
                <span className="mono-13 text-foreground">{domain.hostname}</span>:
              </p>
              <Record
                title="Option 1 · CNAME (recommended for subdomains)"
                rec={domain.dns.cname}
              />
              <Record
                title="Option 2 · TXT (apex domains, or when CNAME is proxied)"
                rec={domain.dns.txt}
              />
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Finish later
              </Button>
              <Button onClick={() => setStep(2)}>I’ve added the record</Button>
            </DialogFooter>
          </>
        )}

        {step === 2 && domain && (
          <>
            <DialogBody className="flex flex-col gap-4">
              <p className="copy-14 text-muted-foreground">
                We’ll look up the DNS records for{' '}
                <span className="mono-13 text-foreground">{domain.hostname}</span>.
              </p>
              {verify.error instanceof ApiError && (
                <Callout tone="danger">{verify.error.message}</Callout>
              )}
              {notYet && (
                <Callout tone="warning" title="DNS is not ready yet">
                  We couldn’t find the record. Propagation can take a few minutes (sometimes
                  longer). Check the record, then try again.
                </Callout>
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setStep(1)}>
                Back to records
              </Button>
              <Button loading={verify.isPending} onClick={() => verify.mutate()}>
                {verify.isPending ? <Loader2 className="animate-spin" /> : null} Verify DNS
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 3 && domain && (
          <>
            <DialogBody className="flex flex-col gap-4">
              <Callout tone="info" title="DNS verified">
                Ownership of <span className="mono-13">{domain.hostname}</span> is confirmed.
              </Callout>
              <p className="copy-14 text-muted-foreground">
                HTTPS is configured automatically: the reverse proxy requests a certificate the
                first time someone opens a short link on this domain, after checking that the domain
                is verified. No action needed.
              </p>
            </DialogBody>
            <DialogFooter>
              <Button onClick={() => setStep(4)}>Continue</Button>
            </DialogFooter>
          </>
        )}

        {step === 4 && domain && (
          <>
            <DialogBody className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-green-soft text-green">
                <Check className="size-6" />
              </span>
              <h3 className="heading-20">{domain.hostname} is ready</h3>
              <p className="copy-14 max-w-sm text-muted-foreground">
                Create a link and choose this domain, or make it your workspace default from the
                domains list.
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button asChild>
                <Link to="/links" onClick={() => onOpenChange(false)}>
                  Create a link
                </Link>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
