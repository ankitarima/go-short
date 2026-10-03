import { ArrowRight, Check, Plus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@go-short/ui/components/button';
import { useMeQuery } from '@/hooks/useAuth';
import { cn } from '@go-short/ui/lib/cn';
import { ACCENT, type Accent } from './data';

export const Container = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('mx-auto max-w-[1200px] px-4 sm:px-6', className)}>{children}</div>
);

/** Centered hero with a soft accent glow and a dotted grid that fades out. */
export function PageHero({
  eyebrow,
  title,
  subtitle,
  accent = 'blue',
  children,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  accent?: Accent;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,#000_30%,transparent_100%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-220px] h-[460px] w-[900px] -translate-x-1/2 rounded-full opacity-[0.18] blur-[110px]"
        style={{ background: ACCENT[accent].glow }}
      />
      <Container className="relative pb-16 pt-16 text-center sm:pt-24">
        {eyebrow && <div className="mb-6 flex justify-center">{eyebrow}</div>}
        <h1 className="mx-auto max-w-4xl text-balance text-[40px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[64px]">
          {title}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-[17px] leading-7 text-muted-foreground sm:text-[19px]">
          {subtitle}
        </p>
        {actions && (
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {actions}
          </div>
        )}
        {children && <div className="mx-auto mt-16 max-w-5xl text-left">{children}</div>}
      </Container>
    </section>
  );
}

export function Pill({ children, accent }: { children: ReactNode; accent?: Accent }) {
  return (
    <span className="label-12 inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-muted-foreground">
      <span
        className="size-1.5 rounded-full"
        style={{ background: ACCENT[accent ?? 'blue'].glow }}
      />
      {children}
    </span>
  );
}

export function CtaButtons({
  primary = 'Get started free',
  secondary,
}: {
  primary?: string;
  secondary?: { label: string; to: string };
}) {
  const me = useMeQuery();
  return (
    <>
      <Button asChild className="h-11 px-6">
        <Link to={me.data ? '/dashboard' : '/register'}>
          {me.data ? 'Open dashboard' : primary} <ArrowRight />
        </Link>
      </Button>
      <Button asChild variant="secondary" className="h-11 px-6">
        <Link to={secondary?.to ?? '/docs/introduction'}>
          {secondary?.label ?? 'Read the docs'}
        </Link>
      </Button>
    </>
  );
}

export function Section({
  eyebrow,
  title,
  body,
  children,
  tone,
  id,
  align = 'center',
}: {
  eyebrow?: string;
  title: ReactNode;
  body?: ReactNode;
  children?: ReactNode;
  tone?: 'surface';
  id?: string;
  align?: 'center' | 'left';
}) {
  return (
    <section
      id={id}
      className={cn('scroll-mt-20 border-b border-border', tone === 'surface' && 'bg-surface')}
    >
      <Container className="py-20 sm:py-24">
        <div className={cn(align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl')}>
          {eyebrow && <p className="label-14 text-blue">{eyebrow}</p>}
          <h2 className="mt-2 text-balance text-[30px] font-semibold leading-tight tracking-[-0.035em] sm:text-[40px]">
            {title}
          </h2>
          {body && <p className="mt-4 text-[16px] leading-7 text-muted-foreground">{body}</p>}
        </div>
        {children && <div className="mt-14">{children}</div>}
      </Container>
    </section>
  );
}

export interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
}

export function FeatureGrid({ items, cols = 3 }: { items: Feature[]; cols?: 2 | 3 }) {
  return (
    <div
      className={cn(
        'grid gap-px overflow-hidden rounded-2xl border border-border bg-border',
        cols === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2',
      )}
    >
      {items.map((f) => (
        <div key={f.title} className="bg-background p-7">
          <span className="grid size-10 place-items-center rounded-lg border border-border bg-surface">
            <f.icon className="size-5" aria-hidden />
          </span>
          <h3 className="heading-16 mt-5">{f.title}</h3>
          <p className="copy-14 mt-2 text-muted-foreground">{f.body}</p>
        </div>
      ))}
    </div>
  );
}

/** Text on one side, a product illustration on the other; alternates with `reverse`. */
export function Split({
  eyebrow,
  title,
  body,
  bullets,
  visual,
  reverse,
  accent = 'blue',
  link,
}: {
  eyebrow: string;
  title: string;
  body: string;
  bullets?: string[];
  visual: ReactNode;
  reverse?: boolean;
  accent?: Accent;
  link?: { label: string; to: string };
}) {
  return (
    <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
      <div className={cn(reverse && 'lg:order-2')}>
        <p className={cn('label-14', ACCENT[accent].text)}>{eyebrow}</p>
        <h3 className="mt-2 text-balance text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[34px]">
          {title}
        </h3>
        <p className="mt-4 text-[16px] leading-7 text-muted-foreground">{body}</p>
        {bullets && (
          <ul className="mt-6 flex flex-col gap-3">
            {bullets.map((b) => (
              <li key={b} className="flex gap-3 text-[15px] leading-6">
                <span
                  className={cn(
                    'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full',
                    ACCENT[accent].bg,
                  )}
                >
                  <Check className={cn('size-3', ACCENT[accent].text)} aria-hidden />
                </span>
                {b}
              </li>
            ))}
          </ul>
        )}
        {link && (
          <Link
            to={link.to}
            className="mt-7 inline-flex items-center gap-1 text-[14px] font-medium text-foreground hover:underline"
          >
            {link.label} <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
      </div>
      <div className={cn('min-w-0', reverse && 'lg:order-1')}>{visual}</div>
    </div>
  );
}

export function Faq({ items }: { items: Array<{ q: string; a: string }> }) {
  return (
    <div className="mx-auto max-w-3xl divide-y divide-border rounded-2xl border border-border">
      {items.map((i) => (
        <details key={i.q} className="group px-6 py-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-medium">
            {i.q}
            <Plus
              className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-45"
              aria-hidden
            />
          </summary>
          <p className="mt-3 text-[15px] leading-7 text-muted-foreground">{i.a}</p>
        </details>
      ))}
    </div>
  );
}

export function CtaBand({
  title = 'Own your links, campaigns and data.',
  body = 'Create a workspace in a minute, or self-host the whole platform.',
}: {
  title?: string;
  body?: string;
}) {
  return (
    <section className="relative overflow-hidden bg-foreground text-background">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[800px] -translate-x-1/2 rounded-full opacity-30 blur-[100px]"
        style={{ background: 'var(--chart-1)' }}
      />
      <Container className="relative py-20 text-center sm:py-24">
        <h2 className="mx-auto max-w-2xl text-balance text-[32px] font-semibold leading-tight tracking-[-0.035em] sm:text-[44px]">
          {title}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-[16px] leading-7 opacity-70">{body}</p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <GetStarted />
          <Link
            to="/docs/self-hosting"
            className="inline-flex h-11 items-center rounded-md border border-background/30 px-6 text-[14px] font-medium hover:bg-background/10"
          >
            Self-host it
          </Link>
        </div>
      </Container>
    </section>
  );
}

function GetStarted() {
  const me = useMeQuery();
  return (
    <Link
      to={me.data ? '/dashboard' : '/register'}
      className="inline-flex h-11 items-center gap-2 rounded-md bg-background px-6 text-[14px] font-medium text-foreground hover:opacity-90"
    >
      {me.data ? 'Open dashboard' : 'Get started free'}{' '}
      <ArrowRight className="size-4" aria-hidden />
    </Link>
  );
}

export function CapabilityStrip() {
  const items = [
    'Open source (MIT)',
    'Self-hosted',
    'Custom domains',
    'REST API and webhooks',
    'No raw IP storage',
    'Role-based access',
  ];
  return (
    <div className="border-b border-border bg-surface">
      <Container className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 py-5">
        {items.map((i) => (
          <span key={i} className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
            <Check className="size-3.5 text-green" aria-hidden />
            {i}
          </span>
        ))}
      </Container>
    </div>
  );
}
