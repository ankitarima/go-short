import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@go-short/ui/components/button';
import { Callout } from '@go-short/ui/components/callout';
import { Field } from '@go-short/ui/components/field';
import { Input, PasswordInput } from '@go-short/ui/components/input';
import { ME_KEY } from '@/hooks/useAuth';
import { ApiError, api, setCsrfToken } from '@/lib/api';
import type { AuthResult } from '@/types/api';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  const login = useMutation({
    mutationFn: () =>
      api<AuthResult>('/auth/login', { method: 'POST', body: { email, password }, public: true }),
    onSuccess: async (r) => {
      setCsrfToken(r.csrfToken);
      await qc.invalidateQueries({ queryKey: ME_KEY });
      navigate(from, { replace: true });
    },
  });
  const err = login.error instanceof ApiError ? login.error : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    login.mutate();
  }

  return (
    <AuthLayout
      title="Log in to goShort"
      footer={
        <>
          Don’t have an account?{' '}
          <Link to="/register" className="text-foreground underline-offset-4 hover:underline">
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {err && (
          <Callout
            tone="danger"
            title={err.code === 'RATE_LIMITED' ? 'Too many attempts' : 'Could not sign you in'}
          >
            {err.message}
          </Callout>
        )}
        <Field id="email" label="Email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </Field>
        <Field id="password" label="Password">
          <PasswordInput
            id="password"

            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" loading={login.isPending} disabled={!email || !password}>
          Continue
        </Button>
        <Link
          to="/forgot-password"
          className="copy-14 text-center text-muted-foreground hover:text-foreground"
        >
          Forgot password?
        </Link>
      </form>
    </AuthLayout>
  );
}
