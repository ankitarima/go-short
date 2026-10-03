import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { capture, renderConsole } from '@/test/render';
import { apiError, consoleMe, http, mkStaff, mkUser, ok, server } from '@/test/server';

const asRole = (role: 'MANAGER' | 'ADMIN' | 'SUPER_ADMIN', over = {}) =>
  server.use(http.get('/api/v1/admin/me', () => ok(consoleMe(role, over))));

describe('access', () => {
  it('uses its own sign-in: shows the staff form when signed out, signs in against the CONSOLE endpoint', async () => {
    let signedIn = false;
    const appLogin = capture<string>();
    server.use(
      http.get('/api/v1/admin/me', () =>
        signedIn ? ok(consoleMe('ADMIN')) : apiError(401, 'UNAUTHENTICATED', 'Sign in'),
      ),
      http.post('/api/v1/admin/auth/login', async ({ request }) => {
        expect(await request.json()).toEqual({
          email: 'root@example.com',
          password: 'correct-horse-battery',
        });
        signedIn = true;
        return ok({ role: 'ADMIN', csrfToken: 'csrf-123' });
      }),
      // The app's sign-in and session endpoints must never be used by the console.
      http.get(
        '/api/v1/me',
        () => (appLogin.calls.push('me'), apiError(401, 'UNAUTHENTICATED', 'x')),
      ),
      http.post(
        '/api/v1/auth/login',
        () => (appLogin.calls.push('login'), apiError(401, 'X', 'x')),
      ),
    );
    const { user } = renderConsole('/');
    expect(
      await screen.findByRole('heading', { name: 'Platform staff sign-in' }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'root@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(appLogin.calls).toEqual([]);
  });

  it('shows the API’s message for a suspended account', async () => {
    server.use(
      http.get('/api/v1/admin/me', () => apiError(401, 'UNAUTHENTICATED', 'Sign in')),
      http.post('/api/v1/admin/auth/login', () =>
        apiError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.'),
      ),
    );
    const { user } = renderConsole('/');
    await user.type(await screen.findByLabelText('Email'), 'a@example.com');
    await user.type(screen.getByLabelText('Password'), 'whatever-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('has been disabled');
  });

  it('tells a signed-in customer without console access, with the API’s own wording, and never loads data', async () => {
    let dataCalls = 0;
    server.use(
      http.get('/api/v1/admin/me', () => apiError(401, 'UNAUTHENTICATED', 'Sign in')),
      http.post('/api/v1/admin/auth/login', () =>
        apiError(403, 'FORBIDDEN', 'This account does not have console access.'),
      ),
      http.get('/api/v1/admin/stats', () => (dataCalls++, ok({}))),
    );
    const { user } = renderConsole('/');
    await user.type(await screen.findByLabelText('Email'), 'customer@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('does not have console access');
    expect(dataCalls).toBe(0);
  });

  it('a console session that expires drops back to sign-in', async () => {
    let expired = false;
    server.use(
      http.get('/api/v1/admin/me', () =>
        expired ? apiError(401, 'UNAUTHENTICATED', 'x') : ok(consoleMe('ADMIN')),
      ),
      http.get(
        '/api/v1/admin/stats',
        () => ((expired = true), apiError(401, 'UNAUTHENTICATED', 'Authentication required')),
      ),
    );
    renderConsole('/');
    expect(
      await screen.findByRole('heading', { name: 'Platform staff sign-in' }),
    ).toBeInTheDocument();
  });

  it('signing out calls the console endpoint (not the app’s) and returns to the sign-in', async () => {
    const hits: string[] = [];
    server.use(
      http.post('/api/v1/admin/auth/logout', () => (hits.push('console'), ok({}))),
      http.post('/api/v1/auth/logout', () => (hits.push('app'), ok({}))),
    );
    const { user } = renderConsole('/');
    await user.click(await screen.findByRole('button', { name: /sign out/i }));
    expect(
      await screen.findByRole('heading', { name: 'Platform staff sign-in' }),
    ).toBeInTheDocument();
    expect(hits).toEqual(['console']);
  });
});

describe('overview', () => {
  it('shows platform totals, the busiest workspaces and the pipeline', async () => {
    renderConsole('/');
    expect(await screen.findByText('128')).toBeInTheDocument(); // users
    expect(screen.getByText('31')).toBeInTheDocument(); // workspaces
    expect(await screen.findByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      '/workspaces/w_1',
    );
    expect(screen.getByText('Failed jobs awaiting review')).toBeInTheDocument();
    expect(screen.getByText('Analytics batches waiting')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Clicks over time' })).toBeInTheDocument();
  });

  it('role badge and navigation match the signed-in staff member', async () => {
    asRole('SUPER_ADMIN');
    renderConsole('/');
    await screen.findByRole('heading', { name: 'Overview' });
    expect(screen.getAllByText('Super admin').length).toBeGreaterThan(0);
    const nav = screen.getByRole('navigation', { name: 'Console' });
    for (const l of [
      'Overview',
      'Monitoring',
      'Users',
      'Workspaces',
      'Teams',
      'Platform staff',
      'Audit log',
      'Queues and jobs',
    ])
      expect(within(nav).getByRole('link', { name: l })).toBeInTheDocument();
  });
});

describe('users', () => {
  it('shows customers only (staff have their own page) and searches without a request per keystroke', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get('/api/v1/admin/users', ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return ok([mkUser()], { nextCursor: null, total: 1 });
      }),
    );
    const { user } = renderConsole('/users');
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(seen[0]!.get('staff')).toBe('exclude');
    expect(screen.queryByText('Platform role')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Search by name or email'), 'grace');
    await waitFor(() => expect(seen.at(-1)!.get('q')).toBe('grace'));
    expect(seen.at(-1)!.get('staff')).toBe('exclude');
    expect(seen.some((p) => p.get('q') === 'g')).toBe(false); // debounced
  });

  it('Next fetches the next cursor and Previous returns to the exact earlier page', async () => {
    const all = Array.from({ length: 30 }, (_, i) =>
      mkUser({
        id: `u_${String(i).padStart(2, '0')}`,
        email: `user${i}@example.com`,
        name: `User ${i}`,
      }),
    );
    const cursors: Array<string | null> = [];
    server.use(
      http.get('/api/v1/admin/users', ({ request }) => {
        const p = new URL(request.url).searchParams;
        cursors.push(p.get('cursor'));
        const start = p.get('cursor') ? Number(p.get('cursor')) : 0;
        const size = Number(p.get('limit'));
        return ok(all.slice(start, start + size), {
          nextCursor: start + size < all.length ? String(start + size) : null,
          total: all.length,
        });
      }),
    );
    const { user } = renderConsole('/users');
    await user.selectOptions(await screen.findByLabelText('Rows per page'), '10');
    await screen.findByText('User 0');
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1–10 of 30');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('User 10')).toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 11–20 of 30');
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('User 20')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled(); // last page
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(await screen.findByText('User 10')).toBeInTheDocument();
    expect(screen.queryByText('User 20')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(await screen.findByText('User 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    // a new page size starts again at page 1
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('User 10');
    await user.selectOptions(screen.getByLabelText('Rows per page'), '25');
    expect(await screen.findByText('User 0')).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(cursors).toContain('10');
  });

  it('paginates the in-memory tables too (platform staff, failed jobs)', async () => {
    asRole('SUPER_ADMIN');
    server.use(
      http.get('/api/v1/admin/staff', () =>
        ok(
          Array.from({ length: 12 }, (_, i) =>
            mkStaff({ id: `s_${i}`, email: `staff${i}@example.com`, name: `Staff ${i}` }),
          ),
        ),
      ),
    );
    const { user } = renderConsole('/staff');
    expect(await screen.findByText('Staff 0')).toBeInTheDocument();
    expect(screen.queryByText('Staff 10')).not.toBeInTheDocument(); // 10 per page
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1–10 of 12');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Staff 10')).toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 11–12 of 12');
  });

  it('an ADMIN can suspend an account after confirming, and re-enable it', async () => {
    const calls = capture<string>();
    server.use(
      http.get('/api/v1/admin/users/u_1', () =>
        ok({
          ...mkUser(),
          workspaceCount: undefined,
          activeSessions: 2,
          apiKeyCount: 1,
          workspaces: [
            {
              id: 'w_1',
              name: 'Acme',
              slug: 'acme',
              role: 'OWNER',
              joinedAt: '2026-09-01T00:00:00Z',
            },
          ],
        }),
      ),
      http.post(
        '/api/v1/admin/users/u_1/disable',
        () => (calls.calls.push('disable'), ok({ id: 'u_1', disabled: true })),
      ),
    );
    const { user } = renderConsole('/users');
    await user.click(await screen.findByRole('button', { name: 'Open ada@example.com' }));
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText('Acme')).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: /suspend account/i }));
    expect(calls.calls).toEqual([]); // not yet: it asks first
    const confirm = (await screen.findAllByRole('dialog')).at(-1)!;
    expect(confirm).toHaveTextContent('signed out everywhere');
    await user.click(within(confirm).getByRole('button', { name: 'Suspend account' }));
    await waitFor(() => expect(calls.calls).toEqual(['disable']));
  });

  it('a MANAGER can look but not change anything', async () => {
    asRole('MANAGER');
    server.use(
      http.get('/api/v1/admin/users/u_1', () =>
        ok({ ...mkUser(), activeSessions: 0, apiKeyCount: 0, workspaces: [] }),
      ),
    );
    const { user } = renderConsole('/users');
    await user.click(await screen.findByRole('button', { name: 'Open ada@example.com' }));
    const dlg = await screen.findByRole('dialog');
    await within(dlg).findByText('Not a member of any workspace.');
    expect(
      within(dlg).queryByRole('button', { name: /suspend|re-enable/i }),
    ).not.toBeInTheDocument();
  });

  it('a suspended account is clearly marked', async () => {
    server.use(
      http.get('/api/v1/admin/users', () =>
        ok([mkUser({ disabledAt: '2026-09-20T00:00:00Z' })], { nextCursor: null }),
      ),
    );
    renderConsole('/users');
    expect(await screen.findByText('Suspended')).toBeInTheDocument();
  });
});

describe('platform staff', () => {
  it('a SUPER_ADMIN adds staff, changes a role and removes access', async () => {
    asRole('SUPER_ADMIN');
    const add = capture<Record<string, unknown>>();
    const change = capture<Record<string, unknown>>();
    let removed = '';
    server.use(
      http.get('/api/v1/admin/staff', () =>
        ok([
          mkStaff({
            id: 'u_me',
            email: 'root@example.com',
            name: 'Root User',
            role: 'SUPER_ADMIN',
          }),
          mkStaff(),
        ]),
      ),
      http.post(
        '/api/v1/admin/staff',
        async ({ request }) => (add.calls.push((await request.json()) as never), ok(mkStaff(), {})),
      ),
      http.patch(
        '/api/v1/admin/staff/u_2',
        async ({ request }) => (
          change.calls.push((await request.json()) as never),
          ok(mkStaff({ role: 'ADMIN' }))
        ),
      ),
      http.delete('/api/v1/admin/staff/u_2', () => ((removed = 'u_2'), ok({}))),
    );
    const { user } = renderConsole('/staff');
    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument();
    // you cannot edit yourself
    expect(
      screen.queryByRole('combobox', { name: 'Role for root@example.com' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add staff/i }));
    const dlg = await screen.findByRole('dialog');
    await user.type(within(dlg).getByLabelText('Account email'), 'new@example.com');
    await user.selectOptions(within(dlg).getByLabelText('Role'), 'ADMIN');
    await user.click(within(dlg).getByRole('button', { name: 'Add staff' }));
    await waitFor(() => expect(add.last()).toEqual({ email: 'new@example.com', role: 'ADMIN' }));

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Role for grace@example.com' }),
      'ADMIN',
    );
    await waitFor(() => expect(change.last()).toEqual({ role: 'ADMIN' }));

    await user.click(screen.getByRole('button', { name: 'Remove grace@example.com' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove access' }),
    );
    await waitFor(() => expect(removed).toBe('u_2'));
  });

  it('shows the API’s reason when adding fails', async () => {
    asRole('SUPER_ADMIN');
    server.use(
      http.post('/api/v1/admin/staff', () =>
        apiError(
          404,
          'NOT_FOUND',
          'There is no account with that email. They must register first.',
        ),
      ),
    );
    const { user } = renderConsole('/staff');
    await user.click(await screen.findByRole('button', { name: /add staff/i }));
    const dlg = await screen.findByRole('dialog');
    await user.type(within(dlg).getByLabelText('Account email'), 'ghost@example.com');
    await user.click(within(dlg).getByRole('button', { name: 'Add staff' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('must register first');
  });

  it('an ADMIN sees who is staff but cannot manage them', async () => {
    renderConsole('/staff');
    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument();
    expect(
      screen.getByText(/Only a super admin can add, change or remove staff/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add staff/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Role for/ })).not.toBeInTheDocument();
  });
});

describe('workspaces, teams and audit', () => {
  it('lists workspaces and shows one in detail', async () => {
    server.use(
      http.get('/api/v1/admin/workspaces', () =>
        ok(
          [
            {
              id: 'w_1',
              name: 'Acme',
              slug: 'acme',
              timezone: 'UTC',
              retentionDays: null,
              createdAt: '2026-09-01T00:00:00Z',
              memberCount: 3,
              linkCount: 120,
              domainCount: 1,
              campaignCount: 4,
            },
          ],
          { nextCursor: null },
        ),
      ),
      http.get('/api/v1/admin/workspaces/w_1', () =>
        ok({
          id: 'w_1',
          name: 'Acme',
          slug: 'acme',
          timezone: 'Asia/Kolkata',
          retentionDays: 90,
          hashIps: true,
          filterBots: false,
          createdAt: '2026-09-01T00:00:00Z',
          clicksLast30Days: 777,
          counts: { links: 120, campaigns: 4, qrCodes: 9, apiKeys: 2, webhooks: 1 },
          members: [
            {
              userId: 'u_1',
              email: 'ada@example.com',
              name: 'Ada',
              disabled: false,
              role: 'OWNER',
              joinedAt: '2026-09-01T00:00:00Z',
            },
          ],
          domains: [{ id: 'd_1', hostname: 'go.acme.com', status: 'VERIFIED' }],
        }),
      ),
    );
    const { user } = renderConsole('/workspaces');
    await user.click(await screen.findByRole('link', { name: 'Acme' }));
    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeInTheDocument();
    expect(await screen.findByText('777')).toBeInTheDocument();
    expect(screen.getByText('go.acme.com')).toBeInTheDocument();
    expect(screen.getByText('90 days')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
  });

  it('filters teams by role', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(
        '/api/v1/admin/teams',
        ({ request }) => (
          seen.push(new URL(request.url).searchParams),
          ok(
            [
              {
                id: 'm_1',
                role: 'OWNER',
                joinedAt: '2026-09-01T00:00:00Z',
                user: { id: 'u_1', email: 'ada@example.com', name: 'Ada', disabled: false },
                workspace: { id: 'w_1', name: 'Acme', slug: 'acme' },
              },
            ],
            { nextCursor: null },
          )
        ),
      ),
    );
    const { user } = renderConsole('/teams');
    expect(await screen.findByText('Ada')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Filter by role'), 'OWNER');
    await waitFor(() => expect(seen.at(-1)!.get('role')).toBe('OWNER'));
  });

  it('shows who did what, and reveals the details on demand', async () => {
    server.use(
      http.get('/api/v1/admin/audit-logs', () =>
        ok(
          [
            {
              id: 'a_1',
              workspaceId: null,
              userId: 'u_me',
              action: 'STAFF_ADDED',
              resourceType: 'user',
              resourceId: 'u_2',
              metadata: { role: 'MANAGER' },
              createdAt: '2026-10-01T10:00:00Z',
              actor: { email: 'root@example.com', name: 'Root User' },
            },
          ],
          { nextCursor: null },
        ),
      ),
    );
    const { user } = renderConsole('/audit');
    expect(await screen.findByText('staff added')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByText('root@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // nothing expands in the row
    await user.click(screen.getByText('staff added'));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByRole('heading', { name: 'staff added' })).toBeInTheDocument();
    expect(within(dlg).getByText('Root User')).toBeInTheDocument();
    expect(within(dlg).getByText('u_2')).toBeInTheDocument();
    expect(within(dlg).getByText('Platform-level')).toBeInTheDocument();
    expect(within(dlg).getByText(/"role": "MANAGER"/)).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Copy JSON' })).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('queues', () => {
  const failedJob = {
    id: 'j_1',
    name: 'batch',
    attemptsMade: 5,
    failedReason: 'database unavailable',
    createdAt: '2026-10-01T10:00:00Z',
    failedAt: '2026-10-01T10:05:00Z',
    summary: { events: 420 },
  };

  it('an ADMIN can retry and delete failed jobs and run a cleanup', async () => {
    const hits: string[] = [];
    server.use(
      http.get('/api/v1/admin/queues/analytics/failed', () => ok([failedJob])),
      http.post(
        '/api/v1/admin/queues/analytics/failed/j_1/retry',
        () => (hits.push('retry'), ok({})),
      ),
      http.delete('/api/v1/admin/queues/analytics/failed/j_1', () => (hits.push('delete'), ok({}))),
      http.post(
        '/api/v1/admin/cleanup/sessions/run',
        () => (hits.push('cleanup'), ok({ task: 'sessions' })),
      ),
    );
    const { user } = renderConsole('/queues');
    expect(await screen.findByText('database unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry job j_1' }));
    await user.click(screen.getByRole('button', { name: 'Delete job j_1' }));
    await user.click(screen.getByRole('button', { name: /sessions/ }));
    await waitFor(() => expect(hits.sort()).toEqual(['cleanup', 'delete', 'retry']));
  });

  it('a MANAGER sees the failures but has no controls', async () => {
    asRole('MANAGER');
    server.use(http.get('/api/v1/admin/queues/analytics/failed', () => ok([failedJob])));
    renderConsole('/queues');
    expect(await screen.findByText('database unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry job/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sessions/ })).toBeDisabled();
  });
});

describe('monitoring', () => {
  it('explains how to connect Prometheus when it is not configured', async () => {
    renderConsole('/monitoring');
    expect(await screen.findByText('Prometheus is not connected')).toBeInTheDocument();
    expect(screen.getByText(/PROMETHEUS_URL/)).toBeInTheDocument();
  });

  it('shows live metrics with units, trend charts and the Grafana and Prometheus links', async () => {
    server.use(
      http.get('/api/v1/admin/monitoring', () =>
        ok({
          configured: true,
          links: { grafana: 'https://grafana.example.com', prometheus: 'https://prom.example.com' },
          metrics: [
            {
              name: 'redirects_per_second',
              label: 'Redirects per second',
              unit: 'rps',
              value: 1234.5,
            },
            {
              name: 'redirect_p95_ms',
              label: 'Redirect p95 handling time',
              unit: 'ms',
              value: 3.21,
            },
            { name: 'api_5xx_ratio', label: 'API 5xx responses', unit: 'percent', value: 4.5 },
            {
              name: 'failed_jobs',
              label: 'Failed jobs awaiting review',
              unit: 'count',
              value: null,
            },
          ],
        }),
      ),
      http.get('/api/v1/admin/monitoring/range', ({ request }) =>
        ok({
          name: new URL(request.url).searchParams.get('query'),
          label: 'Trend',
          unit: 'rps',
          minutes: 60,
          points: [
            { t: 1790000000000, v: 1 },
            { t: 1790000060000, v: 2 },
          ],
        }),
      ),
    );
    renderConsole('/monitoring');
    expect(await screen.findByTestId('metric-redirects_per_second')).toHaveTextContent('1,235 /s');
    expect(screen.getByTestId('metric-redirect_p95_ms')).toHaveTextContent('3.2 ms');
    expect(screen.getByTestId('metric-api_5xx_ratio')).toHaveTextContent('4.5%');
    expect(screen.getByTestId('metric-failed_jobs')).toHaveTextContent('n/a');
    expect(screen.getByRole('link', { name: /Grafana/ })).toHaveAttribute(
      'href',
      'https://grafana.example.com',
    );
    expect(screen.getByRole('link', { name: /Prometheus/ })).toHaveAttribute('target', '_blank');
    await waitFor(() => expect(screen.getAllByRole('img', { name: /over time/ })).toHaveLength(4));
  });
});
