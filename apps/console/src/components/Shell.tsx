import {
  Activity,
  ArrowLeft,
  BarChart3,
  Building2,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Moon,
  ScrollText,
  ShieldCheck,
  Sun,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@go-short/ui/components/avatar';
import { Badge } from '@go-short/ui/components/badge';
import { Button } from '@go-short/ui/components/button';
import { cn } from '@go-short/ui/lib/cn';
import { api, setCsrfToken } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/format';
import { getTheme, setTheme, type Theme } from '@/lib/theme';
import { SESSION_KEY, useConsole } from '@/hooks/useConsole';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/monitoring', label: 'Monitoring', icon: Activity },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/workspaces', label: 'Workspaces', icon: Building2 },
  { to: '/teams', label: 'Teams', icon: UsersRound },
  { to: '/staff', label: 'Platform staff', icon: ShieldCheck },
  { to: '/audit', label: 'Audit log', icon: ScrollText },
  { to: '/queues', label: 'Queues and jobs', icon: ListChecks },
] as const;

function Brand() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--blue)" />
        <path
          d="M9 10l6 6-6 6M16 10l6 6-6 6"
          fill="none"
          stroke="#fff"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[15px] font-semibold tracking-[-0.02em]">goShort</span>
      <Badge tone="blue">Console</Badge>
    </span>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { me } = useConsole();
  return (
    <nav aria-label="Console" className="flex h-full flex-col">
      <div className="px-3 pb-6 pt-1">
        <Brand />
      </div>
      <ul className="flex flex-col gap-0.5">
        {NAV.map((n) => (
          <li key={n.to}>
            <NavLink
              to={n.to}
              end={'end' in n ? n.end : false}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-[14px] transition-colors',
                  isActive
                    ? 'bg-hover font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-hover hover:text-foreground',
                )
              }
            >
              <n.icon className="size-4" aria-hidden /> {n.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-col gap-1 pt-6">
        {me.links.grafana && (
          <a
            href={me.links.grafana}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <BarChart3 className="size-4" aria-hidden /> Open Grafana
          </a>
        )}
        <a
          href="/dashboard"
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to the app
        </a>
      </div>
    </nav>
  );
}

export function Shell() {
  const { me, session } = useConsole();
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [theme, setT] = useState<Theme>(getTheme());
  const dark =
    theme === 'dark' || (theme === 'system' && document.documentElement.classList.contains('dark'));

  async function signOut() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setCsrfToken(null);
      await qc.resetQueries({ queryKey: SESSION_KEY });
      qc.removeQueries({ predicate: (q) => q.queryKey[0] === 'console' });
    }
  }

  return (
    <div className="flex min-h-full bg-surface text-foreground">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-border bg-background p-4 lg:block">
        <Sidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Menu />
          </Button>
          <span className="lg:hidden">
            <Brand />
          </span>
          <div className="ml-auto flex items-center gap-3">
            <Badge
              tone={me.role === 'SUPER_ADMIN' ? 'inverted' : me.role === 'ADMIN' ? 'blue' : 'gray'}
            >
              {ROLE_LABEL[me.role]}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => {
                const next: Theme = dark ? 'light' : 'dark';
                setTheme(next);
                setT(next);
              }}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
            <div className="hidden items-center gap-2 sm:flex">
              <Avatar name={session.user.email} size={24} />
              <span className="max-w-[180px] truncate text-[13px] text-muted-foreground">
                {session.user.email}
              </span>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void signOut()}>
              <LogOut /> Sign out
            </Button>
          </div>
        </header>
        <main
          id="main"
          key={pathname}
          className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-8 sm:px-6 lg:px-8"
        >
          <Outlet />
        </main>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal
          aria-label="Navigation"
        >
          <div className="absolute inset-0 bg-[var(--overlay)]" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 max-w-[85vw] animate-fade-in bg-background p-4">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2"
              aria-label="Close navigation"
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
