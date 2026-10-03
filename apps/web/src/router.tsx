import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo } from 'react';
import {
  Navigate,
  Outlet,
  RouterProvider,
  createBrowserRouter,
  useLocation,
} from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Spinner } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AcceptInvitePage } from '@/features/auth/AcceptInvitePage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { VerifyEmailPage } from '@/features/auth/VerifyEmailPage';
import { NotFoundPage } from '@/features/NotFoundPage';
import { OnboardingPage } from '@/features/workspaces/OnboardingPage';
import { WorkspaceProvider, useMeQuery, useSessionWatcher } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';
import { useUi, watchSystemTheme } from '@/stores/ui';

function Splash() {
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-label="Loading">
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  );
}

/** Everything inside requires a signed-in user with at least one workspace. */
function RequireAuth() {
  const me = useMeQuery();
  const location = useLocation();
  useSessionWatcher();
  if (me.isPending) return <Splash />;
  const unauthorized = me.error instanceof ApiError && me.error.status === 401;
  if (me.isError && !unauthorized) {
    return (
      <div className="p-10 text-center text-sm text-red">
        Could not reach the server. Please reload.
      </div>
    );
  }
  // A 401 on refetch means the session is gone even if a previous user is still cached.
  if (!me.data || unauthorized)
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  if (me.data.workspaces.length === 0) return <OnboardingPage />;
  return (
    <WorkspaceProvider me={me.data}>
      <AppShell />
    </WorkspaceProvider>
  );
}

/** Login/register: bounce signed-in users to the dashboard. */
function GuestOnly() {
  const me = useMeQuery();
  if (me.isPending) return <Splash />;
  return me.data ? <Navigate to="/dashboard" replace /> : <Outlet />;
}

/** Lazy route helper: each screen becomes its own chunk. */
const lazy =
  <T extends Record<string, unknown>>(load: () => Promise<T>, name: keyof T) =>
  async () => ({ Component: (await load())[name] as React.ComponentType });

export const routes = [
  {
    element: <GuestOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  { path: '/', lazy: lazy(() => import('@/features/landing/LandingPage'), 'LandingPage') },
  // Public documentation: guides plus the API reference (no sign-in).
  {
    path: '/docs',
    lazy: lazy(() => import('@/features/docs/DocsLayout'), 'DocsLayout'),
    children: [
      { index: true, element: <Navigate to="/docs/introduction" replace /> },
      { path: 'api', lazy: lazy(() => import('@/features/docs/ApiPages'), 'ApiIntroPage') },
      {
        path: 'api/:segment',
        lazy: lazy(() => import('@/features/docs/ApiPages'), 'ApiSegmentPage'),
      },
      {
        path: 'api/:tag/:op',
        lazy: lazy(() => import('@/features/docs/ApiPages'), 'ApiOperationPage'),
      },
      { path: ':slug', lazy: lazy(() => import('@/features/docs/GuidePage'), 'GuidePage') },
    ],
  },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/accept-invite', element: <AcceptInvitePage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/dashboard',
        lazy: lazy(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage'),
      },
      { path: '/links', lazy: lazy(() => import('@/features/links/LinksPage'), 'LinksPage') },
      {
        path: '/links/:id',
        lazy: lazy(() => import('@/features/links/LinkDetailPage'), 'LinkDetailPage'),
      },
      {
        path: '/campaigns',
        lazy: lazy(() => import('@/features/campaigns/CampaignsPage'), 'CampaignsPage'),
      },
      {
        path: '/campaigns/:id',
        lazy: lazy(() => import('@/features/campaigns/CampaignDetailPage'), 'CampaignDetailPage'),
      },
      { path: '/qr', lazy: lazy(() => import('@/features/qr/QrListPage'), 'QrListPage') },
      {
        path: '/qr/:id',
        lazy: lazy(() => import('@/features/qr/QrDesignerPage'), 'QrDesignerPage'),
      },
      {
        path: '/analytics',
        lazy: lazy(() => import('@/features/analytics/AnalyticsPage'), 'AnalyticsPage'),
      },
      {
        path: '/domains',
        lazy: lazy(() => import('@/features/domains/DomainsPage'), 'DomainsPage'),
      },
      { path: '/team', lazy: lazy(() => import('@/features/team/TeamPage'), 'TeamPage') },
      {
        path: '/api-keys',
        lazy: lazy(() => import('@/features/apikeys/ApiKeysPage'), 'ApiKeysPage'),
      },
      {
        path: '/settings',
        lazy: lazy(() => import('@/features/settings/SettingsPage'), 'SettingsPage'),
      },
      { path: '/admin', lazy: lazy(() => import('@/features/admin/AdminPage'), 'AdminPage') },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        // Never retry client errors (auth, validation, not found); retry transient failures once.
        retry: (count, err) =>
          !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 1,
      },
    },
  });
}

export function AppProviders({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const qc = useMemo(() => client ?? makeQueryClient(), [client]);
  useEffect(() => watchSystemTheme(), []);
  const theme = useUi((s) => s.resolvedTheme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  return (
    <QueryClientProvider client={qc}>
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster />
    </QueryClientProvider>
  );
}

export function App() {
  const router = useMemo(() => createBrowserRouter(routes), []);
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
