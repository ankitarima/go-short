import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ME_KEY, useWorkspace, wsPath } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';
import { useUi } from '@/stores/ui';
import { useUpdateWorkspace, useWorkspaceSettings } from './useWorkspaceSettings';

const ZONES: string[] = (() => {
  const all =
    (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  return ['UTC', ...all.filter((z) => z !== 'UTC')];
})();

export function GeneralPanel() {
  const { workspace, canManage, isOwner } = useWorkspace();
  const settings = useWorkspaceSettings();
  const update = useUpdateWorkspace();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState('');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setActive = useUi((s) => s.setActiveWorkspace);

  useEffect(() => {
    if (settings.data) {
      setName(settings.data.name);
      setTimezone(settings.data.timezone);
    }
  }, [settings.data]);

  const del = useMutation({
    mutationFn: () => api(wsPath(workspace), { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Workspace deleted');
      setActive(null);
      qc.removeQueries({ queryKey: ['ws'] });
      await qc.invalidateQueries({ queryKey: ME_KEY });
      navigate('/dashboard', { replace: true });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : 'Could not delete the workspace'),
  });
  const dirty =
    settings.data && (name.trim() !== settings.data.name || timezone !== settings.data.timezone);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>
            The name appears in the workspace switcher and in invitations.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {!settings.data ? (
            <Skeleton className="h-24" />
          ) : (
            <>
              <Field id="ws-name" label="Name">
                <Input
                  id="ws-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  disabled={!canManage}
                />
              </Field>
              <Field
                id="ws-slug"
                label="Slug"
                hint="Identifies the workspace; it cannot be changed."
              >
                <Input
                  id="ws-slug"
                  value={settings.data.slug}
                  readOnly
                  disabled
                  className="mono-13"
                />
              </Field>
              <Field
                id="ws-tz"
                label="Default time zone"
                hint="Analytics use this to define days unless you pick another zone."
              >
                <NativeSelect
                  id="ws-tz"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  disabled={!canManage}
                >
                  {ZONES.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </>
          )}
        </CardContent>
        {canManage && (
          <CardFooter>
            <span className="copy-13 text-muted-foreground">
              Only admins can change these settings.
            </span>
            <Button
              size="sm"
              loading={update.isPending}
              disabled={!dirty || !name.trim()}
              onClick={() => update.mutate({ name: name.trim(), timezone })}
            >
              Save
            </Button>
          </CardFooter>
        )}
      </Card>

      {isOwner && (
        <Card className="border-red/40">
          <CardHeader>
            <CardTitle className="text-red">Delete workspace</CardTitle>
            <CardDescription>
              Permanently deletes this workspace with all its links, domains, campaigns, QR codes
              and API keys. This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardFooter className="border-red/20 bg-red-soft">
            <span className="copy-13 text-muted-foreground">
              Analytics history for deleted links is not recoverable.
            </span>
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete workspace
            </Button>
          </CardFooter>
        </Card>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(o) => {
          setConfirmDelete(o);
          if (!o) setTyped('');
        }}
        title="Delete this workspace?"
        description={
          <div className="flex flex-col gap-3">
            <p>
              Type <span className="mono-13 text-foreground">{workspace.name}</span> to confirm.
            </p>
            <Input
              aria-label="Type the workspace name to confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          </div>
        }
        confirmLabel="Delete workspace"
        loading={del.isPending}
        onConfirm={() => typed === workspace.name && del.mutate()}
      />
    </div>
  );
}
