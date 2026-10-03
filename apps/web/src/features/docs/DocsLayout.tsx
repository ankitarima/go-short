import { BookOpen, Menu, Search, Terminal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Button } from '@go-short/ui/components/button';
import { useMeQuery } from '@/hooks/useAuth';
import { cn } from '@go-short/ui/lib/cn';
import { DocsSidebar } from './DocsSidebar';
import { SearchDialog } from './SearchDialog';

const isApi = (pathname: string) => pathname === '/docs/api' || pathname.startsWith('/docs/api/');

export function DocsLayout() {
  const { pathname } = useLocation();
  const area = isApi(pathname) ? 'api' : 'guides';
  const me = useMeQuery();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Each page starts at the top (hash links scroll themselves).
  useEffect(() => {
    if (!window.location.hash) window.scrollTo(0, 0);
  }, [pathname]);

  const tab = (active: boolean) =>
    cn(
      'relative flex h-14 items-center gap-2 px-1 text-[14px] font-medium transition-colors',
      active
        ? 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground'
        : 'text-muted-foreground hover:text-foreground',
    );

  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMenuOpen(true)}
          >
            <Menu />
          </Button>
          <Link to="/" aria-label="goShort home" className="flex items-center gap-3">
            <Logo />
            <span className="hidden h-4 w-px bg-border-strong sm:block" aria-hidden />
            <span className="hidden text-[14px] text-muted-foreground sm:block">Docs</span>
          </Link>
          <nav
            aria-label="Documentation sections"
            className="ml-4 hidden items-center gap-6 md:flex"
          >
            <NavLink to="/docs/introduction" className={() => tab(area === 'guides')}>
              <BookOpen className="size-4" aria-hidden /> Guides
            </NavLink>
            <NavLink to="/docs/api" className={() => tab(area === 'api')}>
              <Terminal className="size-4" aria-hidden /> API reference
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setSearchOpen(true)}
              className="hidden h-9 w-64 items-center gap-2 rounded-md border border-border bg-surface px-3 text-[13px] text-muted-foreground hover:border-border-strong sm:flex"
              aria-label="Search the documentation"
            >
              <Search className="size-4" aria-hidden />
              <span className="flex-1 text-left">Search</span>
              <kbd className="rounded border border-border px-1.5 font-mono text-[11px]">⌘K</kbd>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="sm:hidden"
              aria-label="Search"
              onClick={() => setSearchOpen(true)}
            >
              <Search />
            </Button>
            <ThemeToggle />
            {me.data ? (
              <Button asChild size="sm">
                <Link to="/dashboard">Dashboard</Link>
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link to="/register">Sign up</Link>
              </Button>
            )}
          </div>
        </div>
        {/* Section tabs on small screens, where the header has no room for them. */}
        <nav
          aria-label="Documentation sections"
          className="flex gap-6 overflow-x-auto border-t border-border px-4 md:hidden"
        >
          <NavLink to="/docs/introduction" className={() => tab(area === 'guides')}>
            Guides
          </NavLink>
          <NavLink to="/docs/api" className={() => tab(area === 'api')}>
            API reference
          </NavLink>
        </nav>
      </header>

      <div className="mx-auto grid max-w-[1400px] lg:grid-cols-[272px_minmax(0,1fr)]">
        <aside className="sticky top-[57px] hidden h-[calc(100vh-57px)] overflow-y-auto border-r border-border py-8 pl-6 pr-4 lg:block md:top-14 md:h-[calc(100vh-56px)]">
          <DocsSidebar area={area} />
        </aside>
        <main id="docs-main" className="min-w-0 px-4 py-10 sm:px-8 lg:px-12">
          <Outlet />
        </main>
      </div>

      {menuOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal
          aria-label="Documentation navigation"
        >
          <div
            className="absolute inset-0 bg-[var(--overlay)]"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[300px] max-w-[85vw] animate-fade-in overflow-y-auto border-r border-border bg-background p-5">
            <div className="mb-4 flex items-center justify-between">
              <Logo />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close navigation"
                onClick={() => setMenuOpen(false)}
              >
                <X />
              </Button>
            </div>
            <DocsSidebar area={area} />
          </div>
        </div>
      )}
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
