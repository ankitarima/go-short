import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ME_KEY, useWorkspace, wsKey, wsPath } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';
import type { Workspace } from '@/types/api';

export function useWorkspaceSettings() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: wsKey(workspace.id, 'settings'),
    queryFn: () => api<Workspace>(wsPath(workspace)),
  });
}

export function useUpdateWorkspace(successMessage = 'Settings saved') {
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      body: Partial<
        Pick<Workspace, 'name' | 'timezone' | 'hashIps' | 'filterBots' | 'retentionDays'>
      >,
    ) => api<Workspace>(wsPath(workspace), { method: 'PATCH', body }),
    onSuccess: () => {
      toast.success(successMessage);
      void qc.invalidateQueries({ queryKey: wsKey(workspace.id, 'settings') });
      void qc.invalidateQueries({ queryKey: ME_KEY });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save settings'),
  });
}
