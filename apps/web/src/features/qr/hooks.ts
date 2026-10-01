import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useWorkspace, wsKey, wsPath } from '@/hooks/useAuth';
import { ApiError, api, apiPage } from '@/lib/api';
import type { Qr } from '@/types/api';

export function useQrCodes() {
  const { workspace } = useWorkspace();
  return useInfiniteQuery({
    queryKey: wsKey(workspace.id, 'qr', 'list'),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiPage<Qr>(wsPath(workspace, '/qr'), { query: { limit: 24, cursor: pageParam }, signal }),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
}

export function useQr(id: string | undefined) {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: wsKey(workspace.id, 'qr', 'detail', id),
    enabled: !!id,
    queryFn: () => api<Qr>(wsPath(workspace, `/qr/${id}`)),
  });
}

export function useDeleteQr() {
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (q: Qr) => api(wsPath(workspace, `/qr/${q.id}`), { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('QR code deleted');
      void qc.invalidateQueries({ queryKey: wsKey(workspace.id, 'qr') });
      void qc.invalidateQueries({ queryKey: wsKey(workspace.id, 'overview') });
      void qc.invalidateQueries({ queryKey: wsKey(workspace.id, 'campaigns') });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not delete the QR code'),
  });
}
