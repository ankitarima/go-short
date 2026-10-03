import { useQueryClient } from '@tanstack/react-query';
import { Lock, ShieldAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Button } from '@go-short/ui/components/button';
import { Callout } from '@go-short/ui/components/callout';
import { Field } from '@go-short/ui/components/field';
import { Input } from '@go-short/ui/components/input';
import { ErrorState } from '@go-short/ui/components/states';
import { ApiError, api, setCsrfToken } from '@/lib/api';
import {
  ConsoleProvider,
  SESSION_KEY,
  useConsoleMe,
  useSession,
  useSessionWatcher,
} from '@/hooks/useConsole';
import { Shell } from './Shell';

function Splash() {
  return (
    <div
      className="grid min-h-screen place-items-center bg-surface"
      role="status"
      aria-label="Loading"
    >
      <div className="skeleton h-8 w-8 rounded-full" />
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-surface px-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="8" fill="var(--blue)" />
            <path
              d="M9 10l6 6-6 6M16 10l6 6-6 6"
              fill="none"
              stroke="#fff"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-[18px] font-semibold tracking-[-0.02em]">goShort Console</span>
        </div>
        <div className="rounded-xl border border-border bg-background p-8">{children}</div>
      </div>
    </div>
  );
}

function SignIn() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ csrfToken: string }>('/auth/login', {
        method: 'POST',
        body: { email, password },
        public: true,
      });
      setCsrfToken(r.csrfToken);
      await qc.invalidateQueries({ queryKey: SESSION_KEY });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame>
      <h1 className="heading-24 text-center">Platform staff sign-in</h1>
      <p className="copy-14 mt-2 text-center text-muted-foreground">
        Use your goShort account. Access is limited to platform staff.
      </p>
      <form onSubmit={submit} className="mt-7 flex flex-col gap-5">
        {error && <Callout tone="danger">{error}</Callout>}
        <Field id="email" label="Email">
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field id="password" label="Password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" loading={busy} disabled={!email || !password}>
          <Lock /> Sign in
        </Button>
      </form>
    </Frame>
  );
}

function NoAccess({ email }: { email: string }) {
  const qc = useQueryClient();
  async function signOut() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setCsrfToken(null);
    await qc.resetQueries({ queryKey: SESSION_KEY });
  }
  return (
    <Frame>
      <div className="flex flex-col items-center text-center">
        <span className="grid size-11 place-items-center rounded-full border border-border bg-surface">
          <ShieldAlert className="size-5 text-amber" aria-hidden />
        </span>
        <h1 className="heading-20 mt-4">No console access</h1>
        <p className="copy-14 mt-2 text-muted-foreground">
          <span className="font-medium text-foreground">{email}</span> is not platform staff. Ask a
          super admin to add you under Platform staff.
        </p>
        <div className="mt-6 flex gap-2">
          <Button asChild variant="secondary">
            <a href="/dashboard">Back to the app</a>
          </Button>
          <Button variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </Frame>
  );
}

/** Sign-in, then the staff check, then the console. Everything else is decided by the API. */
export function Gate() {
  useSessionWatcher();
  const session = useSession();
  const staff = useConsoleMe(Boolean(session.data));
  if (session.isPending) return <Splash />;
  if (session.isError)
    return (
      <div className="p-8">
        <ErrorState error={session.error} onRetry={() => void session.refetch()} />
      </div>
    );
  if (!session.data) return <SignIn />;
  if (staff.isPending) return <Splash />;
  if (staff.error instanceof ApiError && staff.error.status === 403)
    return <NoAccess email={session.data.user.email} />;
  if (staff.isError)
    return (
      <div className="p-8">
        <ErrorState error={staff.error} onRetry={() => void staff.refetch()} />
      </div>
    );
  return (
    <ConsoleProvider value={{ me: staff.data, session: session.data }}>
      <Shell />
    </ConsoleProvider>
  );
}
