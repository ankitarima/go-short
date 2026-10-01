import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useWorkspace, wsKey, wsPath } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import type { Analytics } from '@/types/api';

export interface AnalyticsFilters {
  from: string;
  to: string;
  timezone: string;
  granularity: 'day' | 'hour';
  includeBots: boolean;
  linkId?: string;
  campaignId?: string;
  country?: string;
  device?: string;
}

/** `scope` selects the endpoint: the whole workspace, one link, or one campaign. */
export function analyticsPath(
  scope: { kind: 'workspace' } | { kind: 'link'; id: string } | { kind: 'campaign'; id: string },
): string {
  return scope.kind === 'workspace'
    ? '/analytics'
    : scope.kind === 'link'
      ? `/links/${scope.id}/analytics`
      : `/campaigns/${scope.id}/analytics`;
}

export function useAnalytics(scope: Parameters<typeof analyticsPath>[0], f: AnalyticsFilters) {
  const { workspace } = useWorkspace();
  const path = analyticsPath(scope);
  const params = {
    from: f.from,
    to: f.to,
    timezone: f.timezone,
    granularity: f.granularity,
    includeBots: f.includeBots,
    limit: 10,
    linkId: f.linkId,
    campaignId: f.campaignId,
    country: f.country,
    device: f.device,
  };
  return useQuery({
    queryKey: wsKey(workspace.id, 'analytics', path, params),
    queryFn: ({ signal }) => api<Analytics>(wsPath(workspace, path), { query: params, signal }),
    placeholderData: keepPreviousData,
  });
}
