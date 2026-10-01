import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ApiKey } from '@/types/api';
import { makeMe } from '@/test/fixtures';
import { capture, renderApp } from '@/test/render';
import { http, ok, server } from '@/test/server';

const key = (over: Partial<ApiKey> = {}): ApiKey => ({
  id: 'k_1',
  name: 'Zapier',
  keyPrefix: 'gs_live_ab12',
  role: 'MEMBER',
  createdAt: '2026-09-01T00:00:00Z',
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  ...over,
});

describe('api keys', () => {
  it('lists keys by prefix only', async () => {
    server.use(http.get('/api/v1/workspaces/ws_1/api-keys', () => ok([key()])));
    renderApp('/api-keys');
    expect(await screen.findByText('Zapier')).toBeInTheDocument();
    expect(screen.getByText(/gs_live_ab12/)).toBeInTheDocument();
  });

  it('shows the full key once after creation and posts the chosen role', async () => {
    const body = capture<Record<string, unknown>>();
    server.use(
      http.get('/api/v1/workspaces/ws_1/api-keys', () => ok([])),
      http.post('/api/v1/workspaces/ws_1/api-keys', async ({ request }) => {
        body.calls.push((await request.json()) as never);
        return ok({ ...key({ role: 'VIEWER' }), key: 'gs_live_SECRETSECRETSECRET' });
      }),
    );
    const { user } = renderApp('/api-keys');
    await user.click((await screen.findAllByRole('button', { name: 'Create API key' }))[0]!);
    const form = await screen.findByRole('dialog');
    await user.type(within(form).getByLabelText('Name'), 'Zapier');
    await user.selectOptions(within(form).getByLabelText('Access'), 'VIEWER');
    await user.click(within(form).getByRole('button', { name: 'Create key' }));
    await waitFor(() => expect(body.calls).toHaveLength(1));
    expect(body.last()).toMatchObject({ name: 'Zapier', role: 'VIEWER' });

    const reveal = await screen.findByRole('dialog', { name: 'Your new API key' });
    expect(reveal).toHaveTextContent('gs_live_SECRETSECRETSECRET');
    expect(reveal).toHaveTextContent('read-only');
    await user.click(within(reveal).getByRole('button', { name: /saved it/i }));
    await waitFor(() =>
      expect(screen.queryByText('gs_live_SECRETSECRETSECRET')).not.toBeInTheDocument(),
    );
  });

  it('revokes a key after confirmation', async () => {
    let revoked = 0;
    server.use(
      http.get('/api/v1/workspaces/ws_1/api-keys', () => ok([key()])),
      http.delete('/api/v1/workspaces/ws_1/api-keys/k_1', () => (revoked++, ok({}))),
    );
    const { user } = renderApp('/api-keys');
    await user.click(await screen.findByRole('button', { name: 'Revoke Zapier' }));
    expect(revoked).toBe(0);
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revoke key' }),
    );
    await waitFor(() => expect(revoked).toBe(1));
  });

  it.each(['MEMBER', 'VIEWER'] as const)('redirects a %s away from the page', async (role) => {
    server.use(http.get('/api/v1/me', () => ok(makeMe(role))));
    renderApp('/api-keys');
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'API Keys' })).not.toBeInTheDocument();
  });
});
