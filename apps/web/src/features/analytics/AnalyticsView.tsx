import { useQuery } from '@tanstack/react-query';
import { Bot, Download, MousePointerClick, QrCode, Users } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { BreakdownList, type BreakdownItem } from '@/components/charts/BreakdownList';
import { TimelineChart } from '@/components/charts/TimelineChart';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { ErrorState } from '@/components/ui/states';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { atLeast, useWorkspace, wsKey, wsPath } from '@/hooks/useAuth';
import { apiPage, apiUrl } from '@/lib/api';
import { countryFlag, countryName, daysAgo, formatNumber, isoDay, titleCase } from '@/lib/format';
import type { BreakdownRow, Campaign, Link as LinkT } from '@/types/api';
import { type AnalyticsFilters, analyticsPath, useAnalytics } from './useAnalytics';

type Preset = 'today' | '7d' | '30d' | '90d' | 'custom';

const TIMEZONES: string[] = (() => {
  const all = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
    'timeZone',
  ) ?? ['America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo'];
  return ['UTC', ...all.filter((z) => z !== 'UTC')];
})();

function rows(list: BreakdownRow[], render?: (v: string) => ReactNode): BreakdownItem[] {
  return list.map((r) => ({
    key: r.value,
    label: render ? render(r.value) : r.value,
    clicks: r.clicks,
  }));
}
const geo = (v: string) => (
  <span className="flex items-center gap-2">
    <span aria-hidden>{countryFlag(v)}</span>
    {countryName(v)}
  </span>
);

export type Scope = Parameters<typeof analyticsPath>[0];

export function AnalyticsView({
  scope,
  showScopeFilters,
}: {
  scope: Scope;
  showScopeFilters?: boolean;
}) {
  const { workspace, role } = useWorkspace();
  const [preset, setPreset] = useState<Preset>('30d');
  const [custom, setCustom] = useState({ from: isoDay(daysAgo(13)), to: isoDay(new Date()) });
  // Default to the viewer's own timezone when the list knows it; the API makes timelines exact in any zone.
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [timezone, setTimezone] = useState(TIMEZONES.includes(browserTz) ? browserTz : 'UTC');
  const [includeBots, setIncludeBots] = useState(true);
  const [linkId, setLinkId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [device, setDevice] = useState('');
  const [country, setCountry] = useState('');

  const range = useMemo(() => {
    const today = isoDay(new Date());
    if (preset === 'today') return { from: today, to: today };
    if (preset === 'custom') return custom;
    const n = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
    return { from: isoDay(daysAgo(n - 1)), to: today };
  }, [preset, custom]);
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;

  const filters: AnalyticsFilters = {
    ...range,
    timezone,
    granularity: days <= 2 ? 'hour' : 'day',
    includeBots,
    linkId: linkId || undefined,
    campaignId: campaignId || undefined,
    country: /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : undefined,
    device: device || undefined,
  };
  const q = useAnalytics(scope, filters);
  const d = q.data;

  const links = useQuery({
    queryKey: wsKey(workspace.id, 'links', 'options'),
    enabled: !!showScopeFilters,
    queryFn: () => apiPage<LinkT>(wsPath(workspace, '/links'), { query: { limit: 100 } }),
    staleTime: 60_000,
  });
  const campaigns = useQuery({
    queryKey: wsKey(workspace.id, 'campaigns', 'options'),
    enabled: !!showScopeFilters,
    queryFn: () => apiPage<Campaign>(wsPath(workspace, '/campaigns'), { query: { limit: 100 } }),
    staleTime: 60_000,
  });

  const exportParams = {
    from: range.from,
    to: range.to,
    timezone,
    includeBots,
    linkId: linkId || undefined,
    campaignId: campaignId || undefined,
  };
  const exportBase = wsPath(workspace, `${analyticsPath(scope)}/export`);
  const canExport = atLeast(role, 'MEMBER');
  const filtered = !!(filters.country || filters.device);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-border bg-surface p-4">
        <Segmented
          label="Date range"
          value={preset}
          onChange={setPreset}
          options={[
            { value: 'today', label: 'Today' },
            { value: '7d', label: '7d' },
            { value: '30d', label: '30d' },
            { value: '90d', label: '90d' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        {preset === 'custom' && (
          <>
            <Field id="from" label="From" className="w-40">
              <Input
                id="from"
                type="date"
                max={custom.to}
                value={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                className="h-9"
              />
            </Field>
            <Field id="to" label="To" className="w-40">
              <Input
                id="to"
                type="date"
                min={custom.from}
                value={custom.to}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                className="h-9"
              />
            </Field>
          </>
        )}
        <Field id="tz" label="Timezone" className="w-56">
          <NativeSelect
            id="tz"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="h-9"
          >
            {TIMEZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {showScopeFilters && (
          <>
            <Field id="f-link" label="Link" className="w-48">
              <NativeSelect
                id="f-link"
                value={linkId}
                onChange={(e) => setLinkId(e.target.value)}
                className="h-9"
              >
                <option value="">All links</option>
                {links.data?.data.map((l) => (
                  <option key={l.id} value={l.id}>
                    /{l.slug}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="f-campaign" label="Campaign" className="w-48">
              <NativeSelect
                id="f-campaign"
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="h-9"
              >
                <option value="">All campaigns</option>
                {campaigns.data?.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </>
        )}
        <Field id="f-device" label="Device" className="w-36">
          <NativeSelect
            id="f-device"
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            className="h-9"
          >
            <option value="">All devices</option>
            <option value="MOBILE">Mobile</option>
            <option value="DESKTOP">Desktop</option>
            <option value="TABLET">Tablet</option>
            <option value="OTHER">Other</option>
          </NativeSelect>
        </Field>
        <Field id="f-country" label="Country" className="w-24">
          <Input
            id="f-country"
            maxLength={2}
            placeholder="IN"
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            className="h-9 uppercase"
          />
        </Field>
        <label className="flex h-9 items-center gap-2 text-sm">
          <Switch
            checked={includeBots}
            onCheckedChange={setIncludeBots}
            aria-label="Include bots"
          />
          Include bots
        </label>
        {canExport && (
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  <Download /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() =>
                    window.open(apiUrl(exportBase, { ...exportParams, type: 'daily' }), '_blank')
                  }
                >
                  Daily summary (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    window.open(apiUrl(exportBase, { ...exportParams, type: 'events' }), '_blank')
                  }
                >
                  Raw clicks (CSV)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {filtered && days > 31 && (
        <Callout tone="warning" title="Country and device filters cover up to 31 days">
          Choose a shorter range to use them.
        </Callout>
      )}

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard
              label="Clicks"
              icon={MousePointerClick}
              loading={q.isPending}
              value={d && formatNumber(d.summary.clicks)}
            />
            <StatCard
              label="Unique visitors"
              icon={Users}
              loading={q.isPending}
              value={d && formatNumber(d.summary.uniqueVisitors)}
              hint="Approximate"
            />
            <StatCard
              label="Human clicks"
              icon={MousePointerClick}
              loading={q.isPending}
              value={d && formatNumber(d.summary.humanClicks)}
            />
            <StatCard
              label="Bot clicks"
              icon={Bot}
              loading={q.isPending}
              value={d && formatNumber(d.summary.botClicks)}
            />
            <StatCard
              label="QR scans"
              icon={QrCode}
              loading={q.isPending}
              value={d && formatNumber(d.summary.qrScans)}
            />
          </div>

          <Card>
            <CardHeader className="pb-0">
              <CardTitle>Clicks over time</CardTitle>
            </CardHeader>
            <CardContent>
              {d ? (
                <TimelineChart
                  data={d.timeline}
                  hourly={d.meta.granularity === 'hour'}
                  showBots={includeBots}
                />
              ) : (
                <Skeleton className="h-[280px] w-full" />
              )}
            </CardContent>
          </Card>

          {d && (
            <div className="grid gap-4 lg:grid-cols-2">
              <TabCard
                title="Geography"
                tabs={[
                  { id: 'countries', label: 'Countries', items: rows(d.countries, geo) },
                  { id: 'regions', label: 'Regions', items: rows(d.regions) },
                  { id: 'cities', label: 'Cities', items: rows(d.cities) },
                ]}
              />
              <TabCard
                title="Technology"
                tabs={[
                  { id: 'devices', label: 'Devices', items: rows(d.devices, titleCase) },
                  { id: 'browsers', label: 'Browsers', items: rows(d.browsers) },
                  { id: 'os', label: 'OS', items: rows(d.os) },
                ]}
              />
              <TabCard
                title="Referrers"
                tabs={[{ id: 'referrers', label: 'Referrers', items: rows(d.referrers) }]}
              />
              <TabCard
                title="Campaign sources"
                tabs={[
                  { id: 'src', label: 'Source', items: rows(d.utmSources) },
                  { id: 'med', label: 'Medium', items: rows(d.utmMediums) },
                  { id: 'cmp', label: 'Campaign', items: rows(d.utmCampaigns) },
                ]}
              />
              {d.qrCodes.length > 0 && (
                <TabCard
                  title="QR codes"
                  tabs={[
                    {
                      id: 'qr',
                      label: 'Scans',
                      items: d.qrCodes.map((r) => ({
                        key: r.value,
                        label: r.name ?? r.value,
                        clicks: r.clicks,
                      })),
                    },
                  ]}
                />
              )}
              {d.topLinks.length > 0 && (
                <TabCard
                  title="Top links"
                  tabs={[
                    {
                      id: 'links',
                      label: 'Links',
                      items: d.topLinks.map((l) => ({
                        key: l.linkId,
                        label: l.deleted ? (
                          <span className="text-subtle-foreground">(deleted link)</span>
                        ) : (
                          <span className="font-mono text-[13px]">
                            {l.hostname}/{l.slug}
                          </span>
                        ),
                        clicks: l.clicks,
                      })),
                    },
                  ]}
                />
              )}
            </div>
          )}

          {d && (
            <Disclosure
              title="About these numbers"
              hint={`${d.meta.timezone} · ${d.meta.source === 'events' ? 'from click events' : 'from rollups'}`}
            >
              <ul className="copy-13 list-disc space-y-1 pl-5 text-muted-foreground">
                {d.meta.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Disclosure>
          )}
        </>
      )}
    </div>
  );
}

function TabCard({
  title,
  tabs,
}: {
  title: string;
  tabs: Array<{ id: string; label: string; items: BreakdownItem[] }>;
}) {
  return (
    <Card>
      <Tabs defaultValue={tabs[0]!.id}>
        <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
          <CardTitle>{title}</CardTitle>
          {tabs.length > 1 && (
            <TabsList className="border-0">
              {tabs.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="pb-1.5">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          )}
        </CardHeader>
        {tabs.map((t) => (
          <TabsContent key={t.id} value={t.id} className="px-3 pb-4 pt-1">
            <BreakdownList items={t.items} />
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}
