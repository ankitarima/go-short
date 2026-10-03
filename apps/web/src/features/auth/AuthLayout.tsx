import { BarChart3, Link2, Megaphone, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { AnalyticsMock } from '@/features/marketing/mocks';

const POINTS = [
  { icon: Link2, text: 'Branded short links and QR codes on your domain' },
  { icon: Megaphone, text: 'Campaigns that bring every channel together' },
  { icon: BarChart3, text: 'Real-time analytics, exact in any timezone' },
  { icon: ShieldCheck, text: 'Open source, self-hosted, no raw IPs stored' },
];

/** Page-specific wording for the product panel; everything else on it stays constant. */
function copyFor(pathname: string) {
  if (pathname.startsWith('/register'))
    return {
      eyebrow: 'Get started free',
      title: 'Run links, campaigns and analytics from one place.',
      body: 'Create your workspace in a minute and see your first clicks arrive.',
    };
  if (pathname.startsWith('/login'))
    return {
      eyebrow: 'Welcome back',
      title: 'Pick up right where you left off.',
      body: 'Your links, campaigns and analytics are waiting for you.',
    };
  return {
    eyebrow: 'goShort',
    title: 'Short links, QR codes and campaign analytics.',
    body: 'The platform you run yourself, with analytics that respect your visitors.',
  };
}

/**
 * Split auth screen, locked to the viewport (no page scroll). Left: what goShort is (always dark, so the
 * brand panel looks the same in either theme); the illustration only appears when the window is tall
 * enough for it. Right: the form. On phones only the form is shown.
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
    <div className="grid h-dvh overflow-hidden lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* `dark` here makes every design token inside the panel dark, regardless of the user's theme. */}
      <aside className="dark relative hidden overflow-hidden bg-background text-foreground lg:flex lg:min-h-0 lg:flex-col lg:justify-between lg:p-10 xl:p-14">
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
          <div className="mt-10 max-w-xl [@media(min-height:800px)]:mt-14">
            <p className="label-14 text-blue">{copy.eyebrow}</p>
            <h2 className="mt-3 text-balance text-[34px] font-semibold leading-[1.1] tracking-[-0.04em] xl:text-[42px]">
              {copy.title}
            </h2>
            <p className="mt-4 max-w-md text-[15px] leading-6 text-muted-foreground">{copy.body}</p>
            <ul className="mt-7 flex flex-col gap-3">
              {POINTS.map((p) => (
                <li key={p.text} className="flex items-center gap-3 text-[14.5px]">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-surface">
                    <p.icon className="size-4" aria-hidden />
                  </span>
                  {p.text}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="relative mt-6">
          <div
            aria-hidden
            className="relative -mr-24 mb-5 hidden max-h-[190px] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_55%,transparent)] [@media(min-height:880px)]:block"
          >
            <div className="w-[560px] origin-top-left scale-[0.92]">
              <AnalyticsMock />
            </div>
          </div>
          <div className="flex items-center justify-between text-[13px] text-subtle-foreground">
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

      {/* Scrolls inside itself only on a window too short for the form, never the whole page. */}
      <section className="flex min-h-0 flex-col overflow-y-auto bg-background">
        <header className="flex h-14 shrink-0 items-center justify-between px-6 sm:px-10">
          <Link to="/" aria-label="goShort home" className="lg:invisible">
            <Logo />
          </Link>
          <ThemeToggle />
        </header>
        <main className="flex flex-1 items-center justify-center px-6 pb-10 sm:px-10">
          <div className="w-full max-w-[380px]">
            <h1 className="heading-32">{title}</h1>
            {description && <p className="copy-14 mt-2 text-muted-foreground">{description}</p>}
            <div className="mt-6">{children}</div>
            {footer && (
              <div className="copy-14 mt-6 border-t border-border pt-5 text-muted-foreground">
                {footer}
              </div>
            )}
          </div>
        </main>
      </section>
    </div>
  );
}
