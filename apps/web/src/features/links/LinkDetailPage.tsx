import { ArrowLeft, ExternalLink, Pencil, Power, QrCode, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CodeValue } from '@/components/ui/copy-button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/states';
import { Skeleton } from '@/components/ui/skeleton';
import { AnalyticsView } from '@/features/analytics/AnalyticsView';
import { useWorkspace } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';
import { displayUrl, formatDateTime } from '@/lib/format';
import { useCampaignOptions, useLink, useLinkActions } from './hooks';
import { LinkFormDialog } from './LinkFormDialog';
import { LinkStatus } from './LinkStatus';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-subtle-foreground">{label}</dt>
      <dd className="copy-14 min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function LinkDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { canWrite } = useWorkspace();
  const link = useLink(id);
  const campaigns = useCampaignOptions();
  const { toggle, remove } = useLinkActions();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (link.isError) {
    const notFound = link.error instanceof ApiError && link.error.status === 404;
    return (
      <ErrorState
        error={
          notFound
            ? new ApiError(404, 'LINK_NOT_FOUND', 'This link does not exist or was deleted.')
            : link.error
        }
        onRetry={() => void link.refetch()}
      />
    );
  }
  const l = link.data;
  const campaign = l?.campaignId ? campaigns.data?.find((c) => c.id === l.campaignId) : undefined;
  const utm = l
    ? (
        [
          ['source', l.utmSource],
          ['medium', l.utmMedium],
          ['campaign', l.utmCampaign],
          ['term', l.utmTerm],
          ['content', l.utmContent],
        ] as const
      ).filter(([, v]) => v)
    : [];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <RouterLink
          to="/links"
          className="copy-13 mb-3 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Links
        </RouterLink>
        {!l ? (
          <Skeleton className="h-10 w-96" />
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1
                  className="heading-24 mono-13 !text-[24px] break-all"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {displayUrl(l.shortUrl)}
                </h1>
                <LinkStatus link={l} />
              </div>
              <a
                href={l.destinationUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="copy-14 mt-1.5 inline-flex max-w-full items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <span className="truncate">{l.destinationUrl}</span>{' '}
                <ExternalLink className="size-3.5 shrink-0" />
              </a>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.open(l.shortUrl, '_blank', 'noopener')}
              >
                <ExternalLink /> Visit
              </Button>
              {canWrite && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(`/qr/new?linkId=${l.id}`)}
                  >
                    <QrCode /> Generate QR
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                    <Pencil /> Edit
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={toggle.isPending}
                    onClick={() => toggle.mutate(l)}
                  >
                    <Power /> {l.isActive ? 'Disable' : 'Enable'}
                  </Button>
                  <Button variant="destructive-outline" size="sm" onClick={() => setDeleting(true)}>
                    <Trash2 /> Delete
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <Card>
        <CardContent>
          {!l ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
              <Detail label="Short URL">
                <CodeValue value={l.shortUrl} />
              </Detail>
              <Detail label="Campaign">
                {campaign ? (
                  <RouterLink
                    to={`/campaigns/${campaign.id}`}
                    className="text-blue hover:underline"
                  >
                    {campaign.name}
                  </RouterLink>
                ) : (
                  <span className="text-subtle-foreground">None</span>
                )}
              </Detail>
              <Detail label="Created">{formatDateTime(l.createdAt)}</Detail>
              <Detail label="Expires">
                {l.expiresAt ? (
                  formatDateTime(l.expiresAt)
                ) : (
                  <span className="text-subtle-foreground">Never</span>
                )}
              </Detail>
              <Detail label="Redirect type">
                {l.redirectStatus ? `${l.redirectStatus}` : 'Default (302)'}
              </Detail>
              <Detail label="Password">
                {l.hasPassword ? 'Protected' : <span className="text-subtle-foreground">None</span>}
              </Detail>
              <Detail label="Title">
                {l.title ?? <span className="text-subtle-foreground">—</span>}
              </Detail>
              <Detail label="UTM">
                {utm.length ? (
                  <span className="flex flex-wrap gap-1.5">
                    {utm.map(([k, v]) => (
                      <Badge key={k} tone="outline">
                        {k}: {v}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  <span className="text-subtle-foreground">None</span>
                )}
              </Detail>
            </dl>
          )}
        </CardContent>
      </Card>

      <section aria-label="Link analytics" className="flex flex-col gap-4">
        <h2 className="heading-20">Analytics</h2>
        <AnalyticsView scope={{ kind: 'link', id }} />
      </section>

      {l && <LinkFormDialog open={editing} onOpenChange={setEditing} link={l} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this link?"
        description="The short link will stop working and its QR codes will be deleted. Analytics history is kept."
        confirmLabel="Delete link"
        loading={remove.isPending}
        onConfirm={() =>
          l && remove.mutate(l, { onSuccess: () => navigate('/links', { replace: true }) })
        }
      />
    </div>
  );
}
