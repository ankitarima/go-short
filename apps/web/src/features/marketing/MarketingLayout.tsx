import { Menu, X, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Logo, LogoMark } from '@/components/layout/Logo';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Button } from '@go-short/ui/components/button';
import { useMeQuery } from '@/hooks/useAuth';
import { cn } from '@go-short/ui/lib/cn';
import { MegaNav } from './MegaNav';
import { PRODUCTS, RESOURCES, SOLUTIONS, productHref, solutionHref } from './data';

function MobileGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border">
      <button
        className="flex w-full items-center justify-between py-4 text-[16px] font-medium"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {title}
        <ChevronDown
          className={cn('size-4 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {open && <div className="flex flex-col gap-1 pb-4">{children}</div>}
    </div>
  );
}

const mobileLink =
  'rounded-md px-2 py-2 text-[15px] text-muted-foreground hover:bg-hover hover:text-foreground';

export function MarketingLayout() {
  const me = useMeQuery();
  const signedIn = !!me.data;
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!window.location.hash) window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-full bg-background text-foreground">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-background"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-4 sm:px-6">
          <Link to="/" aria-label="goShort home">
            <Logo />
          </Link>
          <MegaNav />
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {signedIn ? (
              <Button asChild size="sm">
                <Link to="/dashboard">Dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                  <Link to="/login">Log in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/register">Get started</Link>
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Open menu"
              onClick={() => setOpen(true)}
            >
              <Menu />
            </Button>
          </div>
        </div>
      </header>

      {open && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-background lg:hidden"
          role="dialog"
          aria-modal
          aria-label="Menu"
        >
          <div className="flex h-16 items-center justify-between border-b border-border px-4">
            <Logo />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </div>
          <div className="px-4">
            <MobileGroup title="Products">
              {PRODUCTS.map((p) => (
                <Link key={p.slug} to={productHref(p)} className={mobileLink}>
                  {p.name}
                </Link>
              ))}
            </MobileGroup>
            <MobileGroup title="Solutions">
              {SOLUTIONS.map((s) => (
                <Link key={s.slug} to={solutionHref(s)} className={mobileLink}>
                  {s.name}
                </Link>
              ))}
            </MobileGroup>
            <MobileGroup title="Resources">
              {RESOURCES.map((r) => (
                <Link key={r.name} to={r.href} className={mobileLink}>
                  {r.name}
                </Link>
              ))}
            </MobileGroup>
            <Link
              to="/security"
              className="block border-b border-border py-4 text-[16px] font-medium"
            >
              Security
            </Link>
            <Link
              to="/docs/introduction"
              className="block border-b border-border py-4 text-[16px] font-medium"
            >
              Docs
            </Link>
            <div className="flex flex-col gap-2 py-6">
              {signedIn ? (
                <Button asChild>
                  <Link to="/dashboard">Dashboard</Link>
                </Button>
              ) : (
                <>
                  <Button asChild>
                    <Link to="/register">Get started</Link>
                  </Button>
                  <Button asChild variant="secondary">
                    <Link to="/login">Log in</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <main id="content">
        <Outlet />
      </main>
      <Footer signedIn={signedIn} />
    </div>
  );
}

function Footer({ signedIn }: { signedIn: boolean }) {
  const col = (title: string, items: Array<{ name: string; href: string }>) => (
    <div>
      <h3 className="label-12 uppercase tracking-wider text-subtle-foreground">{title}</h3>
      <ul className="mt-4 flex flex-col gap-2.5">
        {items.map((i) => (
          <li key={i.name}>
            <Link to={i.href} className="text-[14px] text-muted-foreground hover:text-foreground">
              {i.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-16 sm:px-6 md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-[14px] leading-6 text-muted-foreground">
            Short links, QR codes and campaign analytics. Open source, self-hosted, and yours.
          </p>
          <div className="mt-5 flex gap-2">
            <Button asChild size="sm">
              <Link to={signedIn ? '/dashboard' : '/register'}>
                {signedIn ? 'Dashboard' : 'Get started'}
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link to="/docs/introduction">Read the docs</Link>
            </Button>
          </div>
        </div>
        {col(
          'Products',
          PRODUCTS.map((p) => ({ name: p.name, href: productHref(p) })),
        )}
        {col(
          'Solutions',
          SOLUTIONS.map((s) => ({ name: s.name, href: solutionHref(s) })),
        )}
        {col(
          'Resources',
          RESOURCES.slice(0, 6).map((r) => ({ name: r.name, href: r.href })),
        )}
        {col('Company', [
          { name: 'Security', href: '/security' },
          { name: 'Privacy and data', href: '/docs/privacy' },
          { name: 'Log in', href: '/login' },
          { name: 'Sign up', href: '/register' },
        ])}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-3 px-4 py-6 text-[13px] text-muted-foreground sm:flex-row sm:px-6">
          <span className="flex items-center gap-2">
            <LogoMark size={16} /> goShort · MIT licensed · open source
          </span>
          <span>IP geolocation by DB-IP, where enabled.</span>
        </div>
      </div>
    </footer>
  );
}
