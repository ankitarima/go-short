import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';
import { Gate } from '@/components/Gate';
import { AuditPage } from '@/pages/AuditPage';
import { MonitoringPage } from '@/pages/MonitoringPage';
import { OverviewPage } from '@/pages/OverviewPage';
import { QueuesPage } from '@/pages/QueuesPage';
import { StaffPage } from '@/pages/StaffPage';
import { TeamsPage } from '@/pages/TeamsPage';
import { UsersPage } from '@/pages/UsersPage';
import { WorkspaceDetailPage, WorkspacesPage } from '@/pages/WorkspacesPage';

export const routes = [
  {
    element: <Gate />,
    children: [
      { path: '/', element: <OverviewPage /> },
      { path: '/monitoring', element: <MonitoringPage /> },
      { path: '/users', element: <UsersPage /> },
      { path: '/workspaces', element: <WorkspacesPage /> },
      { path: '/workspaces/:id', element: <WorkspaceDetailPage /> },
      { path: '/teams', element: <TeamsPage /> },
      { path: '/staff', element: <StaffPage /> },
      { path: '/audit', element: <AuditPage /> },
      { path: '/queues', element: <QueuesPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];

export const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        // Do not retry what will not change (auth, validation, missing); retry flaky reads twice.
        retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      },
    },
  });

export function AppProviders({
  client,
  children,
}: {
  client: QueryClient;
  children: React.ReactNode;
}) {
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  );
}

export function App() {
  const client = makeQueryClient();
  // The console is served under /console (vite `base`), so the router lives under it too.
  const router = createBrowserRouter(routes, { basename: '/console' });
  return (
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
