import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { useWorkspace, wsKey, wsPath } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';
import type { Campaign } from '@/types/api';

const toDay = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const dayToIso = (d: string, endOfDay = false) =>
  d ? new Date(`${d}T${endOfDay ? '23:59:59' : '00:00:00'}Z`).toISOString() : null;

export function CampaignFormDialog({
  open,
  onOpenChange,
  campaign,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaign?: Campaign;
  onSaved?: (c: Campaign) => void;
}) {
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: '',
    description: '',
    startDate: '',
    endDate: '',
    utmCampaign: '',
  });
  const editing = !!campaign;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    if (!open) return;
    setF(
      campaign
        ? {
            name: campaign.name,
            description: campaign.description ?? '',
            startDate: toDay(campaign.startDate),
            endDate: toDay(campaign.endDate),
            utmCampaign: campaign.utmCampaign ?? '',
          }
        : { name: '', description: '', startDate: '', endDate: '', utmCampaign: '' },
    );
  }, [open, campaign]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        description: f.description.trim() || null,
        startDate: dayToIso(f.startDate),
        endDate: dayToIso(f.endDate, true),
        utmCampaign: f.utmCampaign.trim() || null,
      };
      return editing
        ? api<Campaign>(wsPath(workspace, `/campaigns/${campaign.id}`), { method: 'PATCH', body })
        : api<Campaign>(wsPath(workspace, '/campaigns'), { method: 'POST', body });
    },
    onSuccess: (c) => {
      toast.success(editing ? 'Campaign updated' : 'Campaign created');
      void qc.invalidateQueries({ queryKey: wsKey(workspace.id, 'campaigns') });
      void qc.invalidateQueries({ queryKey: wsKey(workspace.id, 'overview') });
      onOpenChange(false);
      onSaved?.(c);
    },
  });
  const err = save.error instanceof ApiError ? save.error : null;
  const badRange = !!f.startDate && !!f.endDate && f.endDate < f.startDate;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!badRange) save.mutate();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit campaign' : 'New campaign'}</DialogTitle>
            <DialogDescription>
              Group links and QR codes, and see their results together.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            {err && !err.details.length && <Callout tone="danger">{err.message}</Callout>}
            <Field id="c-name" label="Name" error={err?.field('name')}>
              <Input
                id="c-name"
                autoFocus
                required
                maxLength={120}
                value={f.name}
                onChange={set('name')}
                placeholder="Diwali 2026"
              />
            </Field>
            <Field id="c-desc" label="Description" optional>
              <Textarea
                id="c-desc"
                maxLength={1000}
                value={f.description}
                onChange={set('description')}
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="c-start" label="Start date" optional>
                <Input id="c-start" type="date" value={f.startDate} onChange={set('startDate')} />
              </Field>
              <Field
                id="c-end"
                label="End date"
                optional
                error={
                  badRange ? 'The end date cannot be before the start date.' : err?.field('endDate')
                }
              >
                <Input
                  id="c-end"
                  type="date"
                  min={f.startDate || undefined}
                  value={f.endDate}
                  onChange={set('endDate')}
                  aria-invalid={badRange}
                />
              </Field>
            </div>
            <Field
              id="c-utm"
              label="Default utm_campaign"
              optional
              hint="New links in this campaign inherit it unless they set their own."
            >
              <Input
                id="c-utm"
                maxLength={200}
                value={f.utmCampaign}
                onChange={set('utmCampaign')}
                placeholder="diwali2026"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending} disabled={!f.name.trim() || badRange}>
              {editing ? 'Save changes' : 'Create campaign'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
