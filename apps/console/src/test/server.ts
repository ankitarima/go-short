import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import type { ConsoleMe, StaffRole } from '@/types';

export { HttpResponse, http };
export const ok = <T>(data: T, extra: object = {}) =>
  HttpResponse.json({ success: true, data, ...extra });
export const apiError = (status: number, code: string, message: string) =>
  HttpResponse.json(
    { success: false, error: { code, message }, requestId: 'req_test' },
    { status },
  );

export const consoleMe = (role: StaffRole = 'ADMIN', over: Partial<ConsoleMe> = {}): ConsoleMe => ({
  user: { id: 'u_me', email: 'root@example.com', name: 'Root User' },
  role,
  capabilities:
    role === 'MANAGER'
      ? ['console:read']
      : role === 'ADMIN'
        ? ['console:read', 'users:manage', 'queues:manage', 'cleanup:run']
        : ['console:read', 'users:manage', 'queues:manage', 'cleanup:run', 'staff:manage'],
  links: { grafana: null, prometheus: null },
  metricsConfigured: false,
  csrfToken: 'csrf-123',
  ...over,
});

const day = (i: number) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
export const usage = {
  days: 30,
  totals: {
    signups: 12,
    workspacesCreated: 5,
    linksCreated: 340,
    clicks: 52_000,
    activeWorkspaces: 4,
  },
  signups: Array.from({ length: 7 }, (_, i) => ({ date: day(i), count: i })),
  workspacesCreated: Array.from({ length: 7 }, (_, i) => ({ date: day(i), count: 0 })),
  linksCreated: Array.from({ length: 7 }, (_, i) => ({ date: day(i), count: i * 2 })),
  clicks: Array.from({ length: 7 }, (_, i) => ({ date: day(i), count: 1000 * (i + 1) })),
  topWorkspaces: [
    { workspaceId: 'w_1', name: 'Acme', slug: 'acme', clicks: 30_000 },
    { workspaceId: 'w_2', name: 'Globex', slug: 'globex', clicks: 9_500 },
  ],
};

export const stats = {
  users: 128,
  workspaces: 31,
  domains: 9,
  links: 4_200,
  qrCodes: 310,
  campaigns: 44,
  clickEventsEstimate: 1_250_000,
  queues: {
    analytics: { waiting: 3, active: 1, delayed: 0, failed: 0, completed: 0 },
    webhooks: { waiting: 0, active: 0, delayed: 0, failed: 2, completed: 5 },
    cleanup: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 1 },
  },
};

export const mkUser = (over: object = {}) => ({
  id: 'u_1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  emailVerified: true,
  systemRole: 'USER',
  disabledAt: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  workspaceCount: 2,
  ...over,
});

export const mkStaff = (over: object = {}) => ({
  id: 'u_2',
  email: 'grace@example.com',
  name: 'Grace Hopper',
  role: 'MANAGER',
  disabled: false,
  createdAt: '2026-09-02T10:00:00.000Z',
  ...over,
});

/** A signed-in ADMIN by default; tests override with server.use(...). */
export const server = setupServer(
  http.get('/api/v1/admin/me', () => ok(consoleMe())),
  http.get('/api/v1/admin/stats', () => ok(stats)),
  http.get('/api/v1/admin/usage', () => ok(usage)),
  http.get('/api/v1/admin/users', () => ok([mkUser()], { nextCursor: null })),
  http.get('/api/v1/admin/workspaces', () => ok([], { nextCursor: null })),
  http.get('/api/v1/admin/teams', () => ok([], { nextCursor: null })),
  http.get('/api/v1/admin/staff', () => ok([mkStaff()])),
  http.get('/api/v1/admin/audit-logs', () => ok([], { nextCursor: null })),
  http.get('/api/v1/admin/queues', () => ok(stats.queues)),
  http.get('/api/v1/admin/queues/:q/failed', () => ok([])),
  http.get('/api/v1/admin/monitoring', () =>
    ok({ configured: false, links: { grafana: null, prometheus: null }, metrics: [] }),
  ),
);
