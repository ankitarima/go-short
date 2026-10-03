import { Megaphone, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Input } from '@go-short/ui/components/input';
import { PageHeader } from '@go-short/ui/components/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@go-short/ui/components/states';
import { Table, TBody, TD, TH, THead, TR } from '@go-short/ui/components/table';
import { useWorkspace } from '@/hooks/useAuth';
import { formatDate, formatNumber, formatRelative } from '@go-short/ui/lib/format';
import type { Campaign } from '@/types/api';
import { CampaignFormDialog } from './CampaignFormDialog';
import { campaignPhase, useCampaigns, useDeleteCampaign } from './hooks';

const PHASE_TONE = {
  Scheduled: 'blue',
  Running: 'green',
  Ended: 'gray',
  Ongoing: 'outline',
} as const;

export function CampaignsPage() {
  const { canWrite } = useWorkspace();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const del = useDeleteCampaign();
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const query = useCampaigns(q || undefined);
  const items = query.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="A campaign groups links and QR codes so you can see their combined results."
        actions={
          canWrite && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New campaign
            </Button>
          )
        }
      />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
        <Input
          aria-label="Search campaigns"
          placeholder="Search campaigns"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <Card>
          <TableSkeleton rows={4} cols={5} />
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={q ? 'No campaigns match' : 'No campaigns yet'}
          description={
            q ? 'Try a different search.' : 'Create a campaign, then add links and QR codes to it.'
          }
          action={
            !q && canWrite ? (
              <Button onClick={() => setCreating(true)}>
                <Plus /> New campaign
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Name</TH>
                <TH>Status</TH>
                <TH className="hidden md:table-cell">Dates</TH>
                <TH className="text-right">Links</TH>
                <TH className="text-right">QR codes</TH>
                <TH className="hidden lg:table-cell">Created</TH>
                <TH className="w-12">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {items.map((c) => (
                <TR
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/campaigns/${c.id}`)}
                >
                  <TD>
                    <div className="font-medium">{c.name}</div>
                    {c.description && (
                      <div className="max-w-xs truncate text-xs text-muted-foreground">
                        {c.description}
                      </div>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={PHASE_TONE[campaignPhase(c)]} dot>
                      {campaignPhase(c)}
                    </Badge>
                  </TD>
                  <TD className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                    {c.startDate || c.endDate
                      ? `${formatDate(c.startDate)} → ${formatDate(c.endDate)}`
                      : '—'}
                  </TD>
                  <TD className="text-right tabular-nums">{formatNumber(c.linkCount)}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(c.qrCodeCount)}</TD>
                  <TD className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                    {formatRelative(c.createdAt)}
                  </TD>
                  <TD>
                    {canWrite && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${c.name}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem onSelect={() => setEditing(c)}>
                            <Pencil /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem destructive onSelect={() => setDeleting(c)}>
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {query.hasNextPage && (
            <div className="flex justify-center border-t border-border p-3">
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
        </Card>
      )}
      <CampaignFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(c) => navigate(`/campaigns/${c.id}`)}
      />
      <CampaignFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        campaign={editing ?? undefined}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this campaign?"
        description={
          <>
            “{deleting?.name}” will be removed. Its {deleting?.linkCount ?? 0} links and{' '}
            {deleting?.qrCodeCount ?? 0} QR codes are kept and simply become campaign-less.
          </>
        }
        confirmLabel="Delete campaign"
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting, { onSuccess: () => setDeleting(null) })}
      />
    </>
  );
}
