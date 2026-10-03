import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeMe } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { http, ok, server } from '@/test/server';

const asRole = (role: Parameters<typeof makeMe>[0], user = {}) =>
  server.use(http.get('/api/v1/me', () => ok(makeMe(role, user))));

describe('app shell', () => {
  it('shows the workspace, user and main navigation', async () => {
    renderApp('/dashboard');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    for (const name of [
      'Dashboard',
      'Links',
      'Campaigns',
      'QR Codes',
      'Analytics',
      'Domains',
      'Team',
      'API Keys',
      'Settings',
    ]) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Switch workspace' })).toHaveTextContent('Acme');
    expect(screen.getByRole('button', { name: 'Account menu' })).toHaveTextContent(
      'ada@example.com',
    );
  });

  it('hides API Keys from members and viewers (admin-only)', async () => {
    asRole('MEMBER');
    renderApp('/dashboard');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'API Keys' })).not.toBeInTheDocument();
  });

  it('only offers the Platform console entry to platform staff', async () => {
    const a = renderApp('/dashboard');
    await a.user.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(screen.queryByText('Platform console')).not.toBeInTheDocument();
    a.unmount();
    for (const role of ['MANAGER', 'ADMIN', 'SUPER_ADMIN'] as const) {
      asRole('OWNER', { systemRole: role });
      const b = renderApp('/dashboard');
      await b.user.click(await screen.findByRole('button', { name: 'Account menu' }));
      expect(await screen.findByText('Platform console')).toBeInTheDocument();
      b.unmount();
    }
  });

  it('switches workspaces and clears what was cached for the previous one', async () => {
    server.use(
      http.get('/api/v1/me', () =>
        ok({
          ...makeMe(),
          workspaces: [
            { id: 'ws_1', name: 'Acme', slug: 'acme', role: 'OWNER' },
            { id: 'ws_2', name: 'Globex', slug: 'globex', role: 'VIEWER' },
          ],
        }),
      ),
      http.get('/api/v1/workspaces/ws_2/overview', () =>
        ok({ links: 99, campaigns: 0, qrCodes: 0, domains: 0, members: 1 }),
      ),
      http.get('/api/v1/workspaces/ws_2/analytics', () => ok(undefined as never, {})),
    );
    const { user } = renderApp('/dashboard');
    await user.click(await screen.findByRole('button', { name: 'Switch workspace' }));
    await user.click(await screen.findByRole('menuitem', { name: /globex/i }));
    expect(await screen.findByText('99')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch workspace' })).toHaveTextContent('Globex');
    expect(JSON.parse(localStorage.getItem('gs.ui')!).state.activeWorkspaceId).toBe('ws_2');
  });

  it('ignores a stale stored workspace id the user no longer belongs to', async () => {
    localStorage.setItem(
      'gs.ui',
      JSON.stringify({ state: { theme: 'system', activeWorkspaceId: 'ws_gone' }, version: 0 }),
    );
    renderApp('/dashboard');
    expect(await screen.findByRole('button', { name: 'Switch workspace' })).toHaveTextContent(
      'Acme',
    );
  });

  it('toggles the theme and remembers it', async () => {
    const { user } = renderApp('/dashboard');
    await user.click(await screen.findByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(JSON.parse(localStorage.getItem('gs.ui')!).state.theme).toBe('dark');
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('shows a friendly 404 inside the app', async () => {
    renderApp('/nope/nothing');
    expect(await screen.findByRole('heading', { name: /could not be found/i })).toBeInTheDocument();
  });
});
