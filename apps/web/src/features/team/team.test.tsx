import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeMe, makeMember } from '@/test/fixtures';
import { capture, renderApp } from '@/test/render';
import { apiError, http, ok, server } from '@/test/server';

const owner = makeMember({
  id: 'm_0',
  role: 'OWNER',
  user: { id: 'u_0', email: 'root@example.com', name: 'Root Owner' },
});
const me = makeMember({
  id: 'm_me',
  role: 'ADMIN',
  user: { id: 'u_1', email: 'ada@example.com', name: 'Ada Lovelace' },
});
const grace = makeMember();

function asRole(role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER', self = me) {
  server.use(
    http.get('/api/v1/me', () => ok(makeMe(role))),
    http.get('/api/v1/workspaces/ws_1/members', () => ok([owner, { ...self, role }, grace])),
  );
}

describe('team', () => {
  it('an admin can change a member role but not an owner’s, and cannot self-edit', async () => {
    asRole('ADMIN');
    renderApp('/team');
    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role for Grace Hopper' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Role for Root Owner' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Role for Ada Lovelace' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('PATCHes the new role', async () => {
    asRole('OWNER');
    const body = capture<Record<string, unknown>>();
    server.use(
      http.patch(
        '/api/v1/workspaces/ws_1/members/m_1',
        async ({ request }) => (
          body.calls.push((await request.json()) as never),
          ok({ ...grace, role: 'VIEWER' })
        ),
      ),
    );
    const { user } = renderApp('/team');
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Role for Grace Hopper' }),
      'VIEWER',
    );
    await waitFor(() => expect(body.last()).toEqual({ role: 'VIEWER' }));
  });

  it('members and viewers see roles read-only and no invite button', async () => {
    asRole('MEMBER');
    renderApp('/team');
    await screen.findByText('Grace Hopper');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument();
  });

  it('invites by email with a role and surfaces server field errors', async () => {
    asRole('OWNER');
    const body = capture<Record<string, unknown>>();
    let reject = true;
    server.use(
      http.post('/api/v1/workspaces/ws_1/members/invite', async ({ request }) => {
        body.calls.push((await request.json()) as never);
        return reject ? apiError(409, 'ALREADY_MEMBER', 'That person is already a member') : ok({});
      }),
    );
    const { user } = renderApp('/team');
    await user.click((await screen.findAllByRole('button', { name: /invite/i }))[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Email'), 'new@example.com');
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'VIEWER');
    await user.click(within(dialog).getByRole('button', { name: /send invitation|invite/i }));
    expect(await within(dialog).findByText(/already a member/i)).toBeInTheDocument();
    reject = false;
    await user.click(within(dialog).getByRole('button', { name: /send invitation|invite/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(body.last()).toEqual({ email: 'new@example.com', role: 'VIEWER' });
  });

  it('leaving asks for confirmation and DELETEs your own membership', async () => {
    asRole('ADMIN');
    let deleted = '';
    server.use(
      http.delete(
        '/api/v1/workspaces/ws_1/members/:id',
        ({ params }) => ((deleted = String(params.id)), ok({})),
      ),
    );
    const { user } = renderApp('/team');
    await user.click(await screen.findByRole('button', { name: 'Actions for Ada Lovelace' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Leave workspace' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Leave this workspace?');
    expect(deleted).toBe('');
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(deleted).toBe('m_me'));
  });
});
