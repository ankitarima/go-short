import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@go-short/ui/components/button';
import { Callout } from '@go-short/ui/components/callout';
import { Field } from '@go-short/ui/components/field';
import { Input, PasswordInput } from '@go-short/ui/components/input';
import { ME_KEY } from '@/hooks/useAuth';
import { ApiError, api, setCsrfToken } from '@/lib/api';
import type { AuthResult } from '@/types/api';
import { AuthLayout } from './AuthLayout';

export function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tooShort = password.length > 0 && password.length < 12;

  const register = useMutation({
    mutationFn: () =>
      api<AuthResult>('/auth/register', {
        method: 'POST',
        body: { name, email, password },
        public: true,
      }),
    onSuccess: async (r) => {
      setCsrfToken(r.csrfToken);
      await qc.invalidateQueries({ queryKey: ME_KEY });
      navigate('/dashboard', { replace: true });
    },
  });
  const err = register.error instanceof ApiError ? register.error : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!tooShort) register.mutate();
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Short links, QR codes and campaign analytics, on your own server."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {err && !err.details.length && err.code !== 'EMAIL_TAKEN' && (
          <Callout tone="danger">{err.message}</Callout>
        )}
        <Field id="name" label="Name" error={err?.field('name')}>
          <Input
            id="name"
            autoComplete="name"
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!err?.field('name')}
          />
        </Field>
        <Field
          id="email"
          label="Email"
          error={err?.code === 'EMAIL_TAKEN' ? err.message : err?.field('email')}
        >
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={err?.code === 'EMAIL_TAKEN' || !!err?.field('email')}
          />
        </Field>
        <Field
          id="password"
          label="Password"
          hint="At least 12 characters."
          error={tooShort ? 'Use at least 12 characters.' : err?.field('password')}
        >
          <PasswordInput
            id="password"

            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={tooShort}
          />
        </Field>
        <Button
          type="submit"
          loading={register.isPending}
          disabled={!name || !email || password.length < 12}
        >
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
