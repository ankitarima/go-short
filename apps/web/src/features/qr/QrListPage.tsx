import { Download, MoreHorizontal, Pencil, Plus, QrCode, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '@go-short/ui/components/badge';
import { Button } from '@go-short/ui/components/button';
import { Card } from '@go-short/ui/components/card';
import { ConfirmDialog } from '@go-short/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@go-short/ui/components/dropdown-menu';
import { PageHeader } from '@go-short/ui/components/page-header';
import { Skeleton } from '@go-short/ui/components/skeleton';
import { EmptyState, ErrorState } from '@go-short/ui/components/states';
import { useCampaignOptions, useLinks } from '@/features/links/hooks';
import { useWorkspace, wsPath } from '@/hooks/useAuth';
import { apiUrl } from '@/lib/api';
import { displayUrl, formatRelative } from '@go-short/ui/lib/format';
import type { Qr } from '@/types/api';
import { useDeleteQr, useQrCodes } from './hooks';
import { QrThumb } from './QrThumb';

export function QrListPage() {
  const { workspace, canWrite } = useWorkspace();
  const navigate = useNavigate();
  const query = useQrCodes();
  const links = useLinks({});
  const campaigns = useCampaignOptions();
  const del = useDeleteQr();
  const [deleting, setDeleting] = useState<Qr | null>(null);
  const items = query.data?.pages.flatMap((p) => p.data) ?? [];
  const linkById = new Map(links.data?.pages.flatMap((p) => p.data).map((l) => [l.id, l]));
  const download = (q: Qr, format: 'svg' | 'png') =>
    window.open(
      apiUrl(wsPath(workspace, `/qr/${q.id}/image`), { format, size: 1024, download: 1 }),
      '_blank',
    );

  return (
    <>
      <PageHeader
        title="QR Codes"
        description="Designed QR codes that point to your short links. Scans are counted separately from ordinary clicks."
        actions={
          canWrite && (
            <Button onClick={() => navigate('/qr/new')}>
              <Plus /> New QR code
            </Button>
          )
        }
      />
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={QrCode}
          title="No QR codes yet"
          description="Pick a link, choose colours and add a logo. Download as SVG or PNG for print."
          action={
            canWrite ? (
              <Button onClick={() => navigate('/qr/new')}>
                <Plus /> New QR code
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((q) => {
              const link = linkById.get(q.linkId);
              const camp = campaigns.data?.find((c) => c.id === q.campaignId);
              return (
                <Card key={q.id} className="overflow-hidden">
                  <Link to={`/qr/${q.id}`} className="block p-4 pb-0">
                    <QrThumb qr={q} className="aspect-square w-full" />
                  </Link>
                  <div className="flex items-start justify-between gap-2 p-4">
                    <div className="min-w-0">
                      <Link
                        to={`/qr/${q.id}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {q.name}
                      </Link>
                      <div className="mono-13 truncate text-xs text-muted-foreground">
                        {link ? displayUrl(link.shortUrl) : 'Linked URL'}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {camp && <Badge tone="outline">{camp.name}</Badge>}
                        <span>{formatRelative(q.createdAt)}</span>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Actions for ${q.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => download(q, 'svg')}>
                          <Download /> Download SVG
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => download(q, 'png')}>
                          <Download /> Download PNG
                        </DropdownMenuItem>
                        {canWrite && (
                          <>
                            <DropdownMenuItem onSelect={() => navigate(`/qr/${q.id}`)}>
                              <Pencil /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem destructive onSelect={() => setDeleting(q)}>
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </Card>
              );
            })}
          </div>
          {query.hasNextPage && (
            <div className="mt-6 flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                loading={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this QR code?"
        description={
          <>
            “{deleting?.name}” will be deleted. Printed copies will keep working because they point
            to the short link, but you can no longer manage or download this design.
          </>
        }
        confirmLabel="Delete QR code"
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting, { onSuccess: () => setDeleting(null) })}
      />
    </>
  );
}
