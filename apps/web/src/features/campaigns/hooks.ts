import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useWorkspace, wsKey, wsPath } from '@/hooks/useAuth';
import { ApiError, api, apiPage } from '@/lib/api';
import type { Campaign } from '@/types/api';

export function useCampaigns(q?: string) {
  const { workspace } = useWorkspace();
  return useInfiniteQuery({
    queryKey: wsKey(workspace.id, 'campaigns', 'list', q ?? ''),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiPage<Campaign>(wsPath(workspace, '/campaigns'), {
        query: { limit: 24, cursor: pageParam, q },
        signal,
      }),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
}

export function useCampaign(id: string) {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: wsKey(workspace.id, 'campaigns', 'detail', id),
    queryFn: () => api<Campaign>(wsPath(workspace, `/campaigns/${id}`)),
  });
}

export function useDeleteCampaign() {
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (c: Campaign) => api(wsPath(workspace, `/campaigns/${c.id}`), { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Campaign deleted. Its links and QR codes were kept.');
      void qc.invalidateQueries({ queryKey: wsKey(workspace.id) });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : 'Could not delete the campaign'),
  });
}

/** Factual lifecycle label from the dates only (no ranking or scoring of campaigns). */
export function campaignPhase(
  c: Pick<Campaign, 'startDate' | 'endDate'>,
  now = Date.now(),
): 'Scheduled' | 'Running' | 'Ended' | 'Ongoing' {
  const start = c.startDate ? Date.parse(c.startDate) : null;
  const end = c.endDate ? Date.parse(c.endDate) : null;
  if (start && start > now) return 'Scheduled';
  if (end && end < now) return 'Ended';
  return start || end ? 'Running' : 'Ongoing';
}
