import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const m = useMutation({
    mutationFn: () =>
      api('/auth/forgot-password', { method: 'POST', body: { email }, public: true }),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    m.mutate();
  }
  return (
    <AuthLayout
      title="Reset your password"
      description="Enter your email and we’ll send a reset link if an account exists."
      footer={
        <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
          Back to log in
        </Link>
      }
    >
      {m.isSuccess ? (
        <Callout tone="info" title="Check your inbox">
          If an account exists for {email}, a reset link is on its way. The link expires in one
          hour.
        </Callout>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          {m.error instanceof ApiError && <Callout tone="danger">{m.error.message}</Callout>}
          <Field id="email" label="Email">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Button type="submit" loading={m.isPending} disabled={!email}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
