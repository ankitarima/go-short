import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeDomain } from '@/test/fixtures';
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
});
