import { Link2, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@go-short/ui/components/badge';
import { Button } from '@go-short/ui/components/button';
import { Card } from '@go-short/ui/components/card';
import { ConfirmDialog } from '@go-short/ui/components/dialog';
import { CopyButton } from '@go-short/ui/components/copy-button';
import { Input, NativeSelect } from '@go-short/ui/components/input';
import { PageHeader } from '@go-short/ui/components/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@go-short/ui/components/states';
import { Table, TBody, TD, TH, THead, TR } from '@go-short/ui/components/table';
import { useWorkspace } from '@/hooks/useAuth';
import { displayUrl, formatRelative, truncate } from '@go-short/ui/lib/format';
import type { Link } from '@/types/api';
import { useLinkActions, useLinks, useCampaignOptions } from './hooks';
import { LinkFormDialog } from './LinkFormDialog';
import { LinkRowActions } from './LinkRowActions';
import { LinkStatus } from './LinkStatus';

export function LinksPage() {
  const { canWrite } = useWorkspace();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'true' | 'false'>('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Link | null>(null);
  const [deleting, setDeleting] = useState<Link | null>(null);
  const { toggle, remove } = useLinkActions();
  const campaigns = useCampaignOptions();

  // Debounce typing so we do not query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useLinks({ q: q || undefined, isActive: status || undefined });
  const items = query.data?.pages.flatMap((p) => p.data) ?? [];
  const filtering = !!q || !!status;
  const campaignName = (id: string | null) =>
    id ? campaigns.data?.find((c) => c.id === id)?.name : undefined;

  return (
    <>
      <PageHeader
        title="Links"
        description="Create, organise and track short links on your domains."
        actions={
          canWrite && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create link
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
          <Input
            aria-label="Search links"
            placeholder="Search by slug, title or destination"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <NativeSelect
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="sm:w-44"
        >
          <option value="">All statuses</option>
          <option value="true">Active</option>
          <option value="false">Disabled</option>
        </NativeSelect>
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <Card>
          <TableSkeleton rows={6} cols={5} />
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Link2}
          title={filtering ? 'No links match your filters' : 'No links yet'}
          description={
            filtering
              ? 'Try a different search or clear the filters.'
              : 'Create your first short link to start tracking clicks.'
          }
          action={
            !filtering && canWrite ? (
              <Button onClick={() => setCreating(true)}>
                <Plus /> Create link
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Link</TH>
                <TH className="hidden md:table-cell">Destination</TH>
                <TH className="hidden md:table-cell">Status</TH>
                <TH className="hidden lg:table-cell">Created</TH>
                <TH className="w-12">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {items.map((l) => (
                <TR
                  key={l.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/links/${l.id}`)}
                >
                  <TD>
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="mono-13 truncate font-medium">
                            {displayUrl(l.shortUrl)}
                          </span>
                          <span onClick={(e) => e.stopPropagation()}>
                            <CopyButton value={l.shortUrl} size="icon" label={`Copy ${l.slug}`} />
                          </span>
                        </div>
                        <div className="mt-1 md:hidden">
                          <LinkStatus link={l} />
                        </div>
                        {(l.title || campaignName(l.campaignId)) && (
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                            {l.title && <span className="truncate">{l.title}</span>}
                            {campaignName(l.campaignId) && (
                              <Badge tone="outline">{campaignName(l.campaignId)}</Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </TD>
                  <TD className="hidden max-w-xs md:table-cell">
                    <span className="block truncate text-muted-foreground" title={l.destinationUrl}>
                      {truncate(displayUrl(l.destinationUrl), 60)}
                    </span>
                  </TD>
                  <TD className="hidden md:table-cell">
                    <LinkStatus link={l} />
                  </TD>
                  <TD className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                    {formatRelative(l.createdAt)}
                  </TD>
                  <TD>
                    <LinkRowActions
                      link={l}
                      onEdit={() => setEditing(l)}
                      onDelete={() => setDeleting(l)}
                      onToggle={() => toggle.mutate(l)}
                    />
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

      <LinkFormDialog open={creating} onOpenChange={setCreating} />
      <LinkFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        link={editing ?? undefined}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this link?"
        description={
          <>
            The short link{' '}
            <span className="mono-13 text-foreground">
              {deleting && displayUrl(deleting.shortUrl)}
            </span>{' '}
            will stop working and its QR codes will be deleted. Analytics history is kept.
          </>
        }
        confirmLabel="Delete link"
        loading={remove.isPending}
        onConfirm={() =>
          deleting && remove.mutate(deleting, { onSuccess: () => setDeleting(null) })
        }
      />
    </>
  );
}
