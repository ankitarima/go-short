import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';

export function SecurityPanel() {
  const { me } = useWorkspace();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () =>
      api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      }),
    onSuccess: () => {
      toast.success('Password changed. Other devices were signed out.');
      setCurrent('');
      setNext('');
    },
  });
  const err = change.error instanceof ApiError ? change.error : null;
  const short = next.length > 0 && next.length < 12;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!short) change.mutate();
  }
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>You are signed in as {me.user.email}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Name</span>
            <span>{me.user.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Email</span>
            <span>
              {me.user.email} {me.user.emailVerified ? '· verified' : '· not verified'}
            </span>
          </div>
        </CardContent>
      </Card>
      <form onSubmit={submit}>
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>Changing it signs you out everywhere else.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {err && !err.field('newPassword') && <Callout tone="danger">{err.message}</Callout>}
            <Field id="cur-pw" label="Current password">
              <Input
                id="cur-pw"
                type="password"
                autoComplete="current-password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
            <Field
              id="new-pw"
              label="New password"
              hint="At least 12 characters."
              error={short ? 'Use at least 12 characters.' : err?.field('newPassword')}
            >
              <Input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                required
                value={next}
                onChange={(e) => setNext(e.target.value)}
                aria-invalid={short}
              />
            </Field>
          </CardContent>
          <CardFooter>
            <span className="copy-13 text-muted-foreground">
              Use a password you don’t use anywhere else.
            </span>
            <Button
              type="submit"
              size="sm"
              loading={change.isPending}
              disabled={!current || next.length < 12}
            >
              Update password
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
