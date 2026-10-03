import { useEffect, useState } from 'react';
import { Button } from '@go-short/ui/components/button';
import { Callout } from '@go-short/ui/components/callout';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@go-short/ui/components/card';
import { Field } from '@go-short/ui/components/field';
import { NativeSelect } from '@go-short/ui/components/input';
import { Skeleton } from '@go-short/ui/components/skeleton';
import { Switch } from '@go-short/ui/components/switch';
import { useWorkspace } from '@/hooks/useAuth';
import { useUpdateWorkspace, useWorkspaceSettings } from './useWorkspaceSettings';

const RETENTION = [
  { v: '', l: 'Keep forever (default)' },
  { v: '30', l: '30 days' },
  { v: '90', l: '90 days' },
  { v: '180', l: '180 days' },
  { v: '365', l: '365 days' },
];

export function PrivacyPanel() {
  const { canManage } = useWorkspace();
  const s = useWorkspaceSettings();
  const update = useUpdateWorkspace('Privacy settings saved');
  const [hashIps, setHashIps] = useState(true);
  const [filterBots, setFilterBots] = useState(false);
  const [retention, setRetention] = useState('');
  useEffect(() => {
    if (s.data) {
      setHashIps(s.data.hashIps);
      setFilterBots(s.data.filterBots);
      setRetention(s.data.retentionDays ? String(s.data.retentionDays) : '');
    }
  }, [s.data]);
  const known = RETENTION.some((r) => r.v === retention);
  const dirty =
    s.data &&
    (hashIps !== s.data.hashIps ||
      filterBots !== s.data.filterBots ||
      retention !== (s.data.retentionDays ? String(s.data.retentionDays) : ''));

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Analytics privacy</CardTitle>
          <CardDescription>Control what is stored about visitors.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {!s.data ? (
            <Skeleton className="h-40" />
          ) : (
            <>
              <label className="flex items-start justify-between gap-6">
                <span>
                  <span className="label-14 block">Hash IP addresses</span>
                  <span className="copy-13 text-muted-foreground">
                    Store a day-salted hash of the visitor’s IP to support unique-visitor counts.
                    Raw IP addresses are never stored either way.
                  </span>
                </span>
                <Switch
                  checked={hashIps}
                  onCheckedChange={setHashIps}
                  disabled={!canManage}
                  aria-label="Hash IP addresses"
                />
              </label>
              <label className="flex items-start justify-between gap-6">
                <span>
                  <span className="label-14 block">Hide bot traffic by default</span>
                  <span className="copy-13 text-muted-foreground">
                    Dashboards exclude detected crawlers unless you include them. Bot clicks are
                    always stored, just flagged.
                  </span>
                </span>
                <Switch
                  checked={filterBots}
                  onCheckedChange={setFilterBots}
                  disabled={!canManage}
                  aria-label="Hide bot traffic by default"
                />
              </label>
              <Field
                id="retention"
                label="Keep individual click records for"
                hint="Older raw click records are deleted automatically. Aggregated totals contain no personal data and are kept."
              >
                <NativeSelect
                  id="retention"
                  value={retention}
                  onChange={(e) => setRetention(e.target.value)}
                  disabled={!canManage}
                >
                  {!known && <option value={retention}>{retention} days</option>}
                  {RETENTION.map((r) => (
                    <option key={r.v} value={r.v}>
                      {r.l}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </>
          )}
        </CardContent>
        {canManage && (
          <CardFooter>
            <span className="copy-13 text-muted-foreground">Applies to new and existing data.</span>
            <Button
              size="sm"
              loading={update.isPending}
              disabled={!dirty}
              onClick={() =>
                update.mutate({
                  hashIps,
                  filterBots,
                  retentionDays: retention ? Number(retention) : null,
                })
              }
            >
              Save
            </Button>
          </CardFooter>
        )}
      </Card>
      <Callout tone="info" title="Accuracy and compliance">
        Unique visitors are approximate, bot detection is heuristic and location is approximate. You
        are responsible for complying with the privacy laws that apply to you; this software does
        not make a deployment compliant by itself.
      </Callout>
    </div>
  );
}
