import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { ME_KEY } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';
import { useUi } from '@/stores/ui';
import type { Workspace } from '@/types/api';

/** Shown when a signed-in user belongs to no workspace yet. */
export function OnboardingPage() {
  const [name, setName] = useState('');
  const qc = useQueryClient();
  const setActive = useUi((s) => s.setActiveWorkspace);
  const create = useMutation({
    mutationFn: () => api<Workspace>('/workspaces', { method: 'POST', body: { name } }),
    onSuccess: async (w) => {
      setActive(w.id);
      await qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }
  return (
    <AuthLayout
      title="Create your first workspace"
      description="A workspace holds your links, domains, campaigns and team."
    >
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {create.error instanceof ApiError && (
          <Callout tone="danger">{create.error.message}</Callout>
        )}
        <Field id="name" label="Workspace name">
          <Input
            id="name"
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Marketing"
          />
        </Field>
        <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
          Continue
        </Button>
      </form>
    </AuthLayout>
  );
}
