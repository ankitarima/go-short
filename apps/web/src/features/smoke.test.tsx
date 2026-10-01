import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeDomain, makeMe } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { http, ok, server } from '@/test/server';

describe('remaining screens', () => {
  it('dashboard shows workspace totals and the click summary', async () => {
    renderApp('/dashboard');
    expect(await screen.findByRole('heading', { name: /welcome back, ada/i })).toBeInTheDocument();
    expect(await screen.findByText('1,200')).toBeInTheDocument();
  });

  it('domains lists hostnames with their verification status', async () => {
    server.use(
      http.get('/api/v1/workspaces/ws_1/domains', () =>
        ok([
          makeDomain(),
          makeDomain({ id: 'd_2', hostname: 'links.acme.dev', status: 'PENDING' }),
        ]),
      ),
    );
    renderApp('/domains');
    expect(await screen.findByText('links.acme.dev')).toBeInTheDocument();
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });

  it('settings loads for an owner, with the danger zone', async () => {
    server.use(
      http.get('/api/v1/workspaces/ws_1/webhooks', () => ok([])),
      http.get('/api/v1/workspaces/ws_1', () =>
        ok({
          id: 'ws_1',
          name: 'Acme',
          slug: 'acme',
          timezone: 'UTC',
          hashIps: true,
          filterBots: true,
          retentionDays: null,
        }),
      ),
    );
    renderApp('/settings');
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('admin is for platform admins only', async () => {
    renderApp('/admin');
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Platform admin' })).not.toBeInTheDocument();
  });

  it('admin loads platform stats for a system admin', async () => {
    server.use(
      http.get('/api/v1/me', () => ok(makeMe('OWNER', { systemRole: 'ADMIN' }))),
      http.get('/api/v1/admin/stats', () =>
        ok({ users: 3, workspaces: 2, links: 10, clickEvents: 500, domains: 2, queues: {} }),
      ),
      http.get('/api/v1/admin/users', () => ok([], { nextCursor: null })),
      http.get('/api/v1/admin/workspaces', () => ok([], { nextCursor: null })),
    );
    renderApp('/admin');
    expect(await screen.findByRole('heading', { name: 'Platform admin' })).toBeInTheDocument();
  });
});
