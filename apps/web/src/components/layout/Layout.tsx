import {
  BarChart3,
  Globe,
  KeyRound,
  LayoutDashboard,
  Link2,
  Megaphone,
  Menu,
  QrCode,
  Settings,
  Users,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@go-short/ui/lib/cn';
import { Dialog, DialogContent, DialogTitle } from '@go-short/ui/components/dialog';
import { atLeast, useWorkspace } from '@/hooks/useAuth';
import { useUi } from '@/stores/ui';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/links', label: 'Links', icon: Link2 },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/qr', label: 'QR Codes', icon: QrCode },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/domains', label: 'Domains', icon: Globe },
  { to: '/team', label: 'Team', icon: Users },
  { to: '/api-keys', label: 'API Keys', icon: KeyRound, min: 'ADMIN' as const },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { role } = useWorkspace();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.filter((n) => !n.min || atLeast(role, n.min)).map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground',
              isActive && 'bg-hover font-medium text-foreground',
            )
          }
        >
          <Icon className="size-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Logo />
      </div>
      <div className="px-2 pb-2">
        <WorkspaceSwitcher />
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <NavItems onNavigate={onNavigate} />
      </div>
      <div className="flex flex-col gap-2 border-t border-border p-2">
        <UserMenu />
        <div className="flex items-center justify-between px-2 pb-1">
          <a
            href="/docs"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-subtle-foreground hover:text-foreground"
          >
            Docs ↗
          </a>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

export function Layout() {
  const mobileOpen = useUi((s) => s.mobileNavOpen);
  const setMobile = useUi((s) => s.setMobileNav);
  return (
    <div className="flex min-h-full bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-border bg-surface lg:block">
        <SidebarBody />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
            className="rounded-md p-1.5 hover:bg-hover"
          >
            <Menu className="size-5" />
          </button>
          <Logo />
        </header>
        <Dialog open={mobileOpen} onOpenChange={setMobile}>
          <DialogContent className="left-0 top-0 h-full max-h-none w-72 max-w-[85vw] translate-x-0 translate-y-0 animate-slide-in rounded-none bg-surface p-0">
            <DialogTitle className="sr-only">Navigation</DialogTitle>
            <SidebarBody onNavigate={() => setMobile(false)} />
          </DialogContent>
        </Dialog>

        <main
          id="main"
          className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
