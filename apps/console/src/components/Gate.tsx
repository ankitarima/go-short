import { useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Button } from '@go-short/ui/components/button';
import { Callout } from '@go-short/ui/components/callout';
import { Field } from '@go-short/ui/components/field';
import { Input } from '@go-short/ui/components/input';
import { ErrorState } from '@go-short/ui/components/states';
import { ApiError, api } from '@/lib/api';
import {
  ConsoleProvider,
  SESSION_KEY,
  useConsoleSession,
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
      // The console has its own sign-in (and cookie); it never uses the app's /auth endpoints.
      await api('/admin/auth/login', { method: 'POST', body: { email, password }, public: true });
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
        Platform staff only. This sign-in is separate from the app, and sessions last 8 hours.
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

/** Sign-in, then the staff check, then the console. Everything else is decided by the API. */
export function Gate() {
  useSessionWatcher();
  const session = useConsoleSession();
  if (session.isPending) return <Splash />;
  if (session.isError)
    return (
      <div className="p-8">
        <ErrorState error={session.error} onRetry={() => void session.refetch()} />
      </div>
    );
  if (!session.data) return <SignIn />;
  return (
    <ConsoleProvider me={session.data}>
      <Shell />
    </ConsoleProvider>
  );
}
