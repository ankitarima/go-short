import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Link2, Pencil, Plus, QrCode, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { AnalyticsView } from '@/features/analytics/AnalyticsView';
import { LinkFormDialog } from '@/features/links/LinkFormDialog';
import { LinkStatus } from '@/features/links/LinkStatus';
import { useLinks } from '@/features/links/hooks';
import { QrThumb } from '@/features/qr/QrThumb';
import { useWorkspace, wsKey, wsPath } from '@/hooks/useAuth';
import { apiPage } from '@/lib/api';
import { displayUrl, formatDate, formatNumber } from '@/lib/format';
import type { Qr } from '@/types/api';
import { CampaignFormDialog } from './CampaignFormDialog';
import { campaignPhase, useCampaign, useDeleteCampaign } from './hooks';

const TONE = { Scheduled: 'blue', Running: 'green', Ended: 'gray', Ongoing: 'outline' } as const;

export function CampaignDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { workspace, canWrite } = useWorkspace();
  const c = useCampaign(id);
  const links = useLinks({ campaignId: id });
  const qrs = useQuery({
    queryKey: wsKey(workspace.id, 'qr', 'list', { campaignId: id }),
    queryFn: () => apiPage<Qr>(wsPath(workspace, '/qr'), { query: { campaignId: id, limit: 50 } }),
  });
  const del = useDeleteCampaign();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addLink, setAddLink] = useState(false);

  if (c.isError) return <ErrorState error={c.error} onRetry={() => void c.refetch()} />;
  const camp = c.data;
  const linkItems = links.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <RouterLink
          to="/campaigns"
          className="copy-13 mb-3 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Campaigns
        </RouterLink>
        {!camp ? (
          <Skeleton className="h-10 w-80" />
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="heading-32">{camp.name}</h1>
                <Badge tone={TONE[campaignPhase(camp)]} dot>
                  {campaignPhase(camp)}
                </Badge>
              </div>
              <p className="copy-14 mt-1.5 text-muted-foreground">
                {camp.description ?? 'No description.'}
                {(camp.startDate || camp.endDate) && (
                  <>
                    {' '}
                    · {formatDate(camp.startDate)} → {formatDate(camp.endDate)}
                  </>
                )}
                {camp.utmCampaign && (
                  <>
                    {' '}
                    · utm_campaign{' '}
                    <span className="font-mono text-[13px] text-foreground">
                      {camp.utmCampaign}
                    </span>
                  </>
                )}
              </p>
            </div>
            {canWrite && (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  <Pencil /> Edit
                </Button>
                <Button variant="destructive-outline" size="sm" onClick={() => setDeleting(true)}>
                  <Trash2 /> Delete
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* The relationship at a glance: Campaign → Links → QR codes → Analytics */}
      <div className="grid gap-3 sm:grid-cols-3" aria-label="Campaign structure">
        {[
          { icon: Link2, label: 'Links', value: camp?.linkCount },
          { icon: QrCode, label: 'QR codes', value: camp?.qrCodeCount },
        ].map((s) => (
          <div
            key={s.label}
            className="flex items-center gap-3 rounded-xl border border-border p-4"
          >
            <s.icon className="size-5 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-xl font-semibold tabular-nums">
                {s.value === undefined ? '—' : formatNumber(s.value)}
              </div>
            </div>
          </div>
        ))}
        <div className="flex items-center rounded-xl border border-dashed border-border-strong p-4 text-sm text-muted-foreground">
          Link clicks and QR scans roll up into the analytics below.
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Analytics</TabsTrigger>
          <TabsTrigger value="links">
            Links{camp ? ` (${formatNumber(camp.linkCount)})` : ''}
          </TabsTrigger>
          <TabsTrigger value="qr">QR codes{camp ? ` (${camp.qrCodeCount})` : ''}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <AnalyticsView scope={{ kind: 'campaign', id }} />
        </TabsContent>
        <TabsContent value="links">
          <div className="mb-4 flex justify-end">
            {canWrite && (
              <Button size="sm" onClick={() => setAddLink(true)}>
                <Plus /> Add link
              </Button>
            )}
          </div>
          {linkItems.length === 0 ? (
            <EmptyState
              icon={Link2}
              title="No links in this campaign"
              description="Create a link here, or assign existing links from their edit form."
            />
          ) : (
            <Card>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Link</TH>
                    <TH>Status</TH>
                    <TH className="hidden md:table-cell">UTM source / medium</TH>
                  </TR>
                </THead>
                <TBody>
                  {linkItems.map((l) => (
                    <TR
                      key={l.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/links/${l.id}`)}
                    >
                      <TD>
                        <span className="mono-13 font-medium">{displayUrl(l.shortUrl)}</span>
                        {l.title && <div className="text-xs text-muted-foreground">{l.title}</div>}
                      </TD>
                      <TD>
                        <LinkStatus link={l} />
                      </TD>
                      <TD className="hidden text-muted-foreground md:table-cell">
                        {[l.utmSource, l.utmMedium].filter(Boolean).join(' / ') || '—'}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="qr">
          <div className="mb-4 flex justify-end">
            {canWrite && (
              <Button size="sm" onClick={() => navigate('/qr/new')}>
                <Plus /> New QR code
              </Button>
            )}
          </div>
          {!qrs.data?.data.length ? (
            <EmptyState
              icon={QrCode}
              title="No QR codes in this campaign"
              description="Design a QR code for one of the campaign's links."
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {qrs.data.data.map((q) => (
                <RouterLink
                  key={q.id}
                  to={`/qr/${q.id}`}
                  className="rounded-xl border border-border p-3 hover:bg-hover/60"
                >
                  <QrThumb qr={q} className="aspect-square w-full" />
                  <div className="mt-2 truncate text-sm font-medium">{q.name}</div>
                </RouterLink>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {camp && <CampaignFormDialog open={editing} onOpenChange={setEditing} campaign={camp} />}
      <LinkFormDialog open={addLink} onOpenChange={setAddLink} campaignId={id} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this campaign?"
        description="Its links and QR codes are kept and become campaign-less."
        confirmLabel="Delete campaign"
        loading={del.isPending}
        onConfirm={() =>
          camp && del.mutate(camp, { onSuccess: () => navigate('/campaigns', { replace: true }) })
        }
      />
    </div>
  );
}
