import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeMe } from '@/test/fixtures';
import { capture, renderApp } from '@/test/render';
import { apiError, http, HttpResponse, ok, server } from '@/test/server';

/** A session that becomes valid after POST /auth/login or /auth/register. */
function stubSession() {
  let signedIn = false;
  const login = capture<{ email: string; password: string }>();
  server.use(
    http.get('/api/v1/me', () =>
      signedIn ? ok(makeMe()) : apiError(401, 'UNAUTHENTICATED', 'Authentication required'),
    ),
    http.post('/api/v1/auth/login', async ({ request }) => {
      login.calls.push((await request.json()) as never);
      signedIn = true;
      return ok({ user: makeMe().user, csrfToken: 'csrf-token-123' });
    }),
  );
  return { login, signOut: () => (signedIn = false) };
}

describe('route guards and sign in', () => {
  it('sends an unauthenticated visitor to the login screen, then back to where they were going', async () => {
    const s = stubSession();
    const { user, router } = renderApp('/links');
    expect(await screen.findByRole('heading', { name: /log in to go-short/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Links' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/links');
    expect(s.login.last()).toEqual({ email: 'ada@example.com', password: 'correct-horse-battery' });
  });

  it('shows the server message on bad credentials and keeps the form usable', async () => {
    server.use(
      http.get('/api/v1/me', () => apiError(401, 'UNAUTHENTICATED', 'Authentication required')),
      http.post('/api/v1/auth/login', () =>
        apiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password'),
      ),
    );
    const { user } = renderApp('/login');
    await user.type(await screen.findByLabelText('Email'), 'a@b.co');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('explains rate limiting', async () => {
    server.use(
      http.get('/api/v1/me', () => apiError(401, 'UNAUTHENTICATED', 'x')),
      http.post('/api/v1/auth/login', () =>
        apiError(429, 'RATE_LIMITED', 'Too many requests, please try again later'),
      ),
    );
    const { user } = renderApp('/login');
    await user.type(await screen.findByLabelText('Email'), 'a@b.co');
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Too many attempts')).toBeInTheDocument();
  });

  it('bounces an already signed-in user away from /login', async () => {
    renderApp('/login');
    expect(await screen.findByRole('heading', { name: /welcome back, ada/i })).toBeInTheDocument();
  });

  it('returns to the login screen when the session expires mid-use', async () => {
    let expired = false;
    server.use(
      http.get('/api/v1/me', () =>
        expired ? apiError(401, 'UNAUTHENTICATED', 'Authentication required') : ok(makeMe()),
      ),
      http.get('/api/v1/workspaces/ws_1/links', () =>
        expired
          ? apiError(401, 'UNAUTHENTICATED', 'Authentication required')
          : ok([], { nextCursor: null }),
      ),
    );
    const { user } = renderApp('/dashboard');
    await screen.findByRole('heading', { name: /welcome back/i });
    expired = true;
    await user.click(screen.getByRole('link', { name: 'Links' }));
    expect(await screen.findByRole('heading', { name: /log in to go-short/i })).toBeInTheDocument();
  });
});

describe('registration', () => {
  it('requires a 12 character password and reports a taken email on the email field', async () => {
    server.use(
      http.get('/api/v1/me', () => apiError(401, 'UNAUTHENTICATED', 'x')),
      http.post('/api/v1/auth/register', () =>
        apiError(409, 'EMAIL_TAKEN', 'An account with this email already exists'),
      ),
    );
    const { user } = renderApp('/register');
    await user.type(await screen.findByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    expect(screen.getByText('Use at least 12 characters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(
      await screen.findByText('An account with this email already exists'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('onboarding, invitations and password reset', () => {
  it('asks for a first workspace when the user has none, then lands on the dashboard', async () => {
    let created = false;
    const body = capture<{ name: string }>();
    server.use(
      http.get('/api/v1/me', () =>
        ok({ ...makeMe(), workspaces: created ? makeMe().workspaces : [] }),
      ),
      http.post('/api/v1/workspaces', async ({ request }) => {
        body.calls.push((await request.json()) as never);
        created = true;
        return ok(
          {
            id: 'ws_1',
            name: 'Acme',
            slug: 'acme',
            timezone: 'UTC',
            hashIps: true,
            filterBots: false,
            retentionDays: null,
            createdAt: '2026-01-01T00:00:00Z',
            role: 'OWNER',
          },
          {},
        );
      }),
    );
    const { user } = renderApp('/dashboard');
    await user.type(await screen.findByLabelText('Workspace name'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(body.last()).toEqual({ name: 'Acme' });
  });

  it('invites a signed-out visitor to log in first; a signed-in user can accept', async () => {
    server.use(http.get('/api/v1/me', () => apiError(401, 'UNAUTHENTICATED', 'x')));
    const first = renderApp('/accept-invite?token=' + 'x'.repeat(30));
    expect(await screen.findByRole('link', { name: 'Log in' })).toBeInTheDocument();
    first.unmount();

    server.resetHandlers();
    const body = capture<{ token: string }>();
    server.use(
      http.post(
        '/api/v1/workspaces/invitations/accept',
        async ({ request }) => (
          body.calls.push((await request.json()) as never),
          ok({ workspaceId: 'ws_1' })
        ),
      ),
    );
    const { user } = renderApp('/accept-invite?token=' + 'y'.repeat(30));
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    await waitFor(() => expect(body.last()).toEqual({ token: 'y'.repeat(30) }));
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  });

  it('forgot password never reveals whether an account exists', async () => {
    server.use(
      http.get('/api/v1/me', () => apiError(401, 'UNAUTHENTICATED', 'x')),
      http.post('/api/v1/auth/forgot-password', () => ok({})),
    );
    const { user } = renderApp('/forgot-password');
    await user.type(await screen.findByLabelText('Email'), 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(
      await screen.findByText(/if an account exists for nobody@example.com/i),
    ).toBeInTheDocument();
  });

  it('reset password needs a token and sends it with the new password', async () => {
    server.use(http.get('/api/v1/me', () => apiError(401, 'UNAUTHENTICATED', 'x')));
    const noToken = renderApp('/reset-password');
    expect(await screen.findByText(/reset link is incomplete/i)).toBeInTheDocument();
    noToken.unmount();
    const body = capture<{ token: string; newPassword: string }>();
    server.use(
      http.post(
        '/api/v1/auth/reset-password',
        async ({ request }) => (body.calls.push((await request.json()) as never), ok({})),
      ),
    );
    const { user } = renderApp('/reset-password?token=' + 'z'.repeat(30));
    await user.type(await screen.findByLabelText('New password'), 'a-brand-new-password');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText(/signed out/i)).toBeInTheDocument();
    expect(body.last()).toEqual({ token: 'z'.repeat(30), newPassword: 'a-brand-new-password' });
  });

  it('verifies an email address from the link', async () => {
    server.use(
      http.get('/api/v1/me', () => apiError(401, 'UNAUTHENTICATED', 'x')),
      http.post('/api/v1/auth/verify-email', () => ok({})),
    );
    renderApp('/verify-email?token=' + 'v'.repeat(30));
    expect(await screen.findByText('Email verified')).toBeInTheDocument();
    server.use(
      http.post('/api/v1/auth/verify-email', () =>
        apiError(400, 'VALIDATION_ERROR', 'Verification link is invalid or has expired'),
      ),
    );
  });
});

void HttpResponse;
