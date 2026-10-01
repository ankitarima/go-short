import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { AuthLayout } from './AuthLayout';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const m = useMutation({
    mutationFn: () =>
      api('/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword: password },
        public: true,
      }),
  });
  const tooShort = password.length > 0 && password.length < 12;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!tooShort) m.mutate();
  }
  return (
    <AuthLayout
      title="Choose a new password"
      footer={
        <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
          Back to log in
        </Link>
      }
    >
      {!token ? (
        <Callout tone="danger" title="This reset link is incomplete">
          Request a new one from the “Forgot password” page.
        </Callout>
      ) : m.isSuccess ? (
        <div className="flex flex-col gap-4">
          <Callout tone="info" title="Password updated">
            All your devices were signed out. Log in with your new password.
          </Callout>
          <Button asChild>
            <Link to="/login">Log in</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          {m.error instanceof ApiError && <Callout tone="danger">{m.error.message}</Callout>}
          <Field
            id="password"
            label="New password"
            hint="At least 12 characters."
            error={tooShort ? 'Use at least 12 characters.' : undefined}
          >
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={tooShort}
            />
          </Field>
          <Button type="submit" loading={m.isPending} disabled={password.length < 12}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
