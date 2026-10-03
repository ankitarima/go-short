import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@go-short/ui/components/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@go-short/ui/components/dialog';
import { Field } from '@go-short/ui/components/field';
import { Input } from '@go-short/ui/components/input';
import { ME_KEY } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';
import { useUi } from '@/stores/ui';
import type { Workspace } from '@/types/api';

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = useState('');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setActive = useUi((s) => s.setActiveWorkspace);

  const create = useMutation({
    mutationFn: () => api<Workspace>('/workspaces', { method: 'POST', body: { name } }),
    onSuccess: async (w) => {
      setActive(w.id);
      qc.removeQueries({ queryKey: ['ws'] });
      await qc.invalidateQueries({ queryKey: ME_KEY });
      toast.success(`Workspace “${w.name}” created`);
      setName('');
      onOpenChange(false);
      navigate('/dashboard');
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create a workspace</DialogTitle>
            <DialogDescription>
              Workspaces keep links, domains, campaigns and teams separate.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field
              id="ws-name"
              label="Name"
              error={create.error instanceof ApiError ? create.error.message : undefined}
            >
              <Input
                id="ws-name"
                autoFocus
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Marketing"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
