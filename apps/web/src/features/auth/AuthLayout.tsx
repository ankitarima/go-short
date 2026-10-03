import { BarChart3, Link2, Megaphone, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { AnalyticsMock } from '@/features/marketing/mocks';

const POINTS = [
  { icon: Link2, text: 'Branded short links and QR codes on your own domain' },
  { icon: Megaphone, text: 'Campaigns that bring every channel into one view' },
  { icon: BarChart3, text: 'Clicks and scans in real time, exact in any timezone' },
  { icon: ShieldCheck, text: 'Open source and self-hosted. No raw IP addresses stored' },
];

/** Page-specific wording for the product panel; everything else on it stays constant. */
function copyFor(pathname: string) {
  if (pathname.startsWith('/register'))
    return {
      eyebrow: 'Get started free',
      title: 'Run links, campaigns and analytics from one place.',
      body: 'Create your workspace in a minute. Add a custom domain, design a QR code and see your first clicks arrive.',
    };
  if (pathname.startsWith('/login'))
    return {
      eyebrow: 'Welcome back',
      title: 'Pick up right where you left off.',
      body: 'Your links, campaigns and analytics are waiting. Sign in to see what happened while you were away.',
    };
  return {
    eyebrow: 'goShort',
    title: 'Short links, QR codes and campaign analytics.',
    body: 'The platform you run yourself: branded links, campaigns that tie channels together, and analytics that respect your visitors.',
  };
}

/**
 * Split auth screen. Left: what goShort is (always dark, so the brand panel looks the same in either
 * theme). Right: the form. On phones only the form is shown.
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { pathname } = useLocation();
  const copy = copyFor(pathname);
  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* `dark` here makes every design token inside the panel dark, regardless of the user's theme. */}
      <aside className="dark relative hidden overflow-hidden bg-background text-foreground lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_80%_60%_at_20%_0%,#000_30%,transparent_100%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-32 -top-40 h-[480px] w-[640px] rounded-full opacity-25 blur-[120px]"
          style={{ background: 'var(--chart-1)' }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 right-[-120px] h-[380px] w-[520px] rounded-full opacity-20 blur-[120px]"
          style={{ background: 'var(--chart-2)' }}
        />

        <div className="relative">
          <Link to="/" aria-label="goShort home" className="inline-block">
            <Logo />
          </Link>
          <div className="mt-16 max-w-xl">
            <p className="label-14 text-blue">{copy.eyebrow}</p>
            <h2 className="mt-3 text-balance text-[40px] font-semibold leading-[1.08] tracking-[-0.04em] xl:text-[48px]">
              {copy.title}
            </h2>
            <p className="mt-5 max-w-md text-[16px] leading-7 text-muted-foreground">{copy.body}</p>
            <ul className="mt-9 flex flex-col gap-4">
              {POINTS.map((p) => (
                <li key={p.text} className="flex items-center gap-3 text-[15px]">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-surface">
                    <p.icon className="size-4" aria-hidden />
                  </span>
                  {p.text}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="relative mt-12">
          <div
            className="relative -mr-24 max-h-[260px] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]"
            aria-hidden
          >
            <div className="w-[560px] origin-top-left scale-[0.92]">
              <AnalyticsMock />
            </div>
          </div>
          <div className="mt-6 flex items-center justify-between text-[13px] text-subtle-foreground">
            <span>Open source · MIT licensed</span>
            <span className="flex gap-4">
              <Link to="/docs/introduction" className="hover:text-foreground">
                Docs
              </Link>
              <Link to="/security" className="hover:text-foreground">
                Security
              </Link>
            </span>
          </div>
        </div>
      </aside>

      <section className="flex min-h-full flex-col bg-background">
        <header className="flex h-16 items-center justify-between px-6 sm:px-10">
          <Link to="/" aria-label="goShort home" className="lg:invisible">
            <Logo />
          </Link>
          <ThemeToggle />
        </header>
        <main className="flex flex-1 items-center justify-center px-6 pb-16 sm:px-10">
          <div className="w-full max-w-[380px]">
            <h1 className="heading-32">{title}</h1>
            {description && <p className="copy-14 mt-2 text-muted-foreground">{description}</p>}
            <div className="mt-8">{children}</div>
            {footer && (
              <div className="copy-14 mt-8 border-t border-border pt-6 text-muted-foreground">
                {footer}
              </div>
            )}
          </div>
        </main>
      </section>
    </div>
  );
}
