import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  Globe,
  Link2,
  Megaphone,
  MousePointerClick,
  Plus,
  QrCode,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TimelineChart } from '@/components/charts/TimelineChart';
import { Badge } from '@go-short/ui/components/badge';
import { Button } from '@go-short/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@go-short/ui/components/card';
import { PageHeader } from '@go-short/ui/components/page-header';
import { Skeleton } from '@go-short/ui/components/skeleton';
import { StatCard } from '@go-short/ui/components/stat-card';
import { ErrorState } from '@go-short/ui/components/states';
import { useAnalytics } from '@/features/analytics/useAnalytics';
import { campaignPhase } from '@/features/campaigns/hooks';
import { CampaignFormDialog } from '@/features/campaigns/CampaignFormDialog';
import { LinkFormDialog } from '@/features/links/LinkFormDialog';
import { LinkStatus } from '@/features/links/LinkStatus';
import { useWorkspace, wsKey, wsPath } from '@/hooks/useAuth';
import { api, apiPage } from '@/lib/api';
import {
  daysAgo,
  displayUrl,
  formatNumber,
  formatRelative,
  isoDay,
  plural,
} from '@go-short/ui/lib/format';
import type { Campaign, Link as LinkT, Overview } from '@/types/api';

export function DashboardPage() {
  const { workspace, canWrite, me } = useWorkspace();
  const navigate = useNavigate();
  const [creatingLink, setCreatingLink] = useState(false);
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  const overview = useQuery({
    queryKey: wsKey(workspace.id, 'overview'),
    queryFn: () => api<Overview>(wsPath(workspace, '/overview')),
  });
  const range = useMemo(() => ({ from: isoDay(daysAgo(29)), to: isoDay(new Date()) }), []);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const analytics = useAnalytics(
    { kind: 'workspace' },
    { ...range, timezone, granularity: 'day', includeBots: true },
  );
  const recentLinks = useQuery({
    queryKey: wsKey(workspace.id, 'links', 'recent'),
    queryFn: () => apiPage<LinkT>(wsPath(workspace, '/links'), { query: { limit: 5 } }),
  });
  const recentCampaigns = useQuery({
    queryKey: wsKey(workspace.id, 'campaigns', 'recent'),
    queryFn: () => apiPage<Campaign>(wsPath(workspace, '/campaigns'), { query: { limit: 5 } }),
  });

  const o = overview.data;
  const a = analytics.data;
  const firstName = me.user.name.split(' ')[0];
  const isEmpty = o && o.links === 0;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description={`An overview of ${workspace.name} over the last 30 days.`}
        actions={
          canWrite && (
            <Button onClick={() => setCreatingLink(true)}>
              <Plus /> Create link
            </Button>
          )
        }
      />

      {overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard
              label="Total links"
              icon={Link2}
              loading={!o}
              value={o && formatNumber(o.links)}
            />
            <StatCard
              label="Clicks"
              icon={MousePointerClick}
              loading={!a}
              value={a && formatNumber(a.summary.clicks)}
              hint="Last 30 days"
            />
            <StatCard
              label="Unique visitors"
              icon={Users}
              loading={!a}
              value={a && formatNumber(a.summary.uniqueVisitors)}
              hint="Approximate"
            />
            <StatCard
              label="Campaigns"
              icon={Megaphone}
              loading={!o}
              value={o && formatNumber(o.campaigns)}
            />
            <StatCard
              label="QR codes"
              icon={QrCode}
              loading={!o}
              value={o && formatNumber(o.qrCodes)}
              hint={a ? `${formatNumber(a.summary.qrScans)} scans` : undefined}
            />
          </div>

          {isEmpty && canWrite && (
            <Card>
              <CardHeader>
                <CardTitle>Get started</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                {[
                  {
                    done: (o?.links ?? 0) > 0,
                    icon: Link2,
                    title: 'Create a short link',
                    text: 'Shorten a URL and track every click.',
                    action: () => setCreatingLink(true),
                  },
                  {
                    done: (o?.domains ?? 0) > 0,
                    icon: Globe,
                    title: 'Connect a custom domain',
                    text: 'Use your own brand in short links.',
                    action: () => navigate('/domains'),
                  },
                  {
                    done: (o?.qrCodes ?? 0) > 0,
                    icon: QrCode,
                    title: 'Design a QR code',
                    text: 'Generate print-ready SVG or PNG.',
                    action: () => navigate('/qr/new'),
                  },
                ].map((s) => (
                  <button
                    key={s.title}
                    type="button"
                    onClick={s.action}
                    className="flex items-start gap-3 rounded-lg border border-border p-4 text-left hover:bg-hover/60"
                  >
                    <span className="mt-0.5 flex size-6 items-center justify-center rounded-full border border-border-strong">
                      {s.done ? (
                        <Check className="size-3.5 text-green" />
                      ) : (
                        <s.icon className="size-3.5 text-muted-foreground" />
                      )}
                    </span>
                    <span>
                      <span className="label-14 block">{s.title}</span>
                      <span className="copy-13 text-muted-foreground">{s.text}</span>
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Clicks over time</CardTitle>
            </CardHeader>
            <CardContent>
              {analytics.isError ? (
                <ErrorState
                  error={analytics.error}
                  onRetry={() => void analytics.refetch()}
                  className="border-0"
                />
              ) : a ? (
                <TimelineChart data={a.timeline} showBots={true} height={240} />
              ) : (
                <Skeleton className="h-[240px] w-full" />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Recent links</CardTitle>
                <Link
                  to="/links"
                  className="copy-13 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  View all <ArrowRight className="size-3.5" />
                </Link>
              </CardHeader>
              <CardContent className="px-2 pb-3 pt-3">
                {!recentLinks.data ? (
                  <div className="flex flex-col gap-2 px-3">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-10" />
                    ))}
                  </div>
                ) : recentLinks.data.data.length === 0 ? (
                  <p className="copy-14 px-3 py-6 text-center text-subtle-foreground">
                    No links yet.
                  </p>
                ) : (
                  <ul>
                    {recentLinks.data.data.map((l) => (
                      <li key={l.id}>
                        <Link
                          to={`/links/${l.id}`}
                          className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 hover:bg-hover"
                        >
                          <span className="min-w-0">
                            <span className="mono-13 block truncate font-medium">
                              {displayUrl(l.shortUrl)}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {l.title ?? displayUrl(l.destinationUrl)}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-3">
                            <LinkStatus link={l} />
                            <span className="hidden text-xs text-subtle-foreground sm:inline">
                              {formatRelative(l.createdAt)}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Top links</CardTitle>
                <Link
                  to="/analytics"
                  className="copy-13 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  Analytics <ArrowRight className="size-3.5" />
                </Link>
              </CardHeader>
              <CardContent className="px-2 pb-3 pt-3">
                {!a ? (
                  <div className="flex flex-col gap-2 px-3">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-10" />
                    ))}
                  </div>
                ) : a.topLinks.length === 0 ? (
                  <p className="copy-14 px-3 py-6 text-center text-subtle-foreground">
                    Clicks will appear here.
                  </p>
                ) : (
                  <ul>
                    {a.topLinks.slice(0, 5).map((t) => (
                      <li key={t.linkId}>
                        <Link
                          to={t.deleted ? '/links' : `/links/${t.linkId}`}
                          className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 hover:bg-hover"
                        >
                          <span className="mono-13 truncate">
                            {t.deleted ? '(deleted link)' : `${t.hostname}/${t.slug}`}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {formatNumber(t.clicks)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Recent campaigns</CardTitle>
              <div className="flex items-center gap-3">
                {canWrite && (
                  <Button variant="secondary" size="sm" onClick={() => setCreatingCampaign(true)}>
                    <Plus /> New
                  </Button>
                )}
                <Link
                  to="/campaigns"
                  className="copy-13 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  View all <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </CardHeader>
            <CardContent className="px-2 pb-3 pt-3">
              {!recentCampaigns.data ? (
                <Skeleton className="mx-3 h-10" />
              ) : recentCampaigns.data.data.length === 0 ? (
                <p className="copy-14 px-3 py-6 text-center text-subtle-foreground">
                  No campaigns yet.
                </p>
              ) : (
                <ul>
                  {recentCampaigns.data.data.map((c) => (
                    <li key={c.id}>
                      <Link
                        to={`/campaigns/${c.id}`}
                        className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 hover:bg-hover"
                      >
                        <span className="min-w-0 truncate font-medium">{c.name}</span>
                        <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                          <Badge tone="outline">{campaignPhase(c)}</Badge>
                          {plural(c.linkCount, 'link')} · {plural(c.qrCodeCount, 'QR code')}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      <LinkFormDialog
        open={creatingLink}
        onOpenChange={setCreatingLink}
        onSaved={(l) => navigate(`/links/${l.id}`)}
      />
      <CampaignFormDialog
        open={creatingCampaign}
        onOpenChange={setCreatingCampaign}
        onSaved={(c) => navigate(`/campaigns/${c.id}`)}
      />
    </>
  );
}
