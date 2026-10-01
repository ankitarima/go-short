import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { useWorkspace, wsKey, wsPath } from '@/hooks/useAuth';
import { ApiError, api, apiPage } from '@/lib/api';
import type { Campaign, Domain, Link } from '@/types/api';

export interface LinkFilters {
  q?: string;
  isActive?: 'true' | 'false';
  campaignId?: string;
}

export function useLinks(filters: LinkFilters) {
  const { workspace } = useWorkspace();
  return useInfiniteQuery({
    queryKey: wsKey(workspace.id, 'links', 'list', filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiPage<Link>(wsPath(workspace, '/links'), {
        query: { limit: 25, cursor: pageParam, ...filters },
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useLink(id: string) {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: wsKey(workspace.id, 'links', 'detail', id),
    queryFn: () => api<Link>(wsPath(workspace, `/links/${id}`)),
  });
}

/** Domains a link can use (verified, not disabled). */
export function useUsableDomains() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: wsKey(workspace.id, 'domains'),
    queryFn: () => api<Domain[]>(wsPath(workspace, '/domains')),
    select: (all) => all.filter((d) => d.status === 'VERIFIED'),
    staleTime: 30_000,
  });
}

export function useCampaignOptions() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: wsKey(workspace.id, 'campaigns', 'options'),
    queryFn: () => apiPage<Campaign>(wsPath(workspace, '/campaigns'), { query: { limit: 100 } }),
    select: (p) => p.data,
    staleTime: 30_000,
  });
}

export const invalidateLinks = (qc: QueryClient, workspaceId: string) => {
  void qc.invalidateQueries({ queryKey: wsKey(workspaceId, 'links') });
  void qc.invalidateQueries({ queryKey: wsKey(workspaceId, 'overview') });
  void qc.invalidateQueries({ queryKey: wsKey(workspaceId, 'campaigns') });
};

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong');

export function useLinkActions() {
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  const done = () => invalidateLinks(qc, workspace.id);
  const toggle = useMutation({
    mutationFn: (l: Link) =>
      api<Link>(wsPath(workspace, `/links/${l.id}/${l.isActive ? 'disable' : 'enable'}`), {
        method: 'POST',
      }),
    onSuccess: (l) => {
      toast.success(l.isActive ? 'Link enabled' : 'Link disabled');
      done();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: (l: Link) => api(wsPath(workspace, `/links/${l.id}`), { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Link deleted');
      done();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return { toggle, remove };
}
