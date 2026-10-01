import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { ApiError, api, authEvents, setCsrfToken } from '@/lib/api';
import { useUi } from '@/stores/ui';
import type { Me, Role, Workspace, WorkspaceRef } from '@/types/api';

export const ME_KEY = ['me'] as const;

export function useMeQuery() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      const me = await api<Me>('/me', { public: true });
      setCsrfToken(me.csrfToken);
      return me;
    },
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 1,
    staleTime: 60_000,
  });
}

const RANK: Record<Role, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };
/** UI-only gating. The server enforces every permission; this just hides controls that would be refused. */
export const atLeast = (role: Role | undefined, min: Role): boolean =>
  !!role && RANK[role] >= RANK[min];

interface WorkspaceCtx {
  me: Me;
  workspaces: WorkspaceRef[];
  workspace: WorkspaceRef;
  role: Role;
  setWorkspace: (id: string) => void;
  canWrite: boolean; // MEMBER+
  canManage: boolean; // ADMIN+
  isOwner: boolean;
}
const Ctx = createContext<WorkspaceCtx | null>(null);

/** Resolves the active workspace from the signed-in user's own list (a stale stored id can never grant anything). */
export function WorkspaceProvider({ me, children }: { me: Me; children: ReactNode }) {
  const stored = useUi((s) => s.activeWorkspaceId);
  const setActive = useUi((s) => s.setActiveWorkspace);
  const workspace = me.workspaces.find((w) => w.id === stored) ?? me.workspaces[0];

  useEffect(() => {
    if (workspace && workspace.id !== stored) setActive(workspace.id);
  }, [workspace, stored, setActive]);

  const value = useMemo<WorkspaceCtx | null>(
    () =>
      workspace
        ? {
            me,
            workspaces: me.workspaces,
            workspace,
            role: workspace.role,
            setWorkspace: setActive,
            canWrite: atLeast(workspace.role, 'MEMBER'),
            canManage: atLeast(workspace.role, 'ADMIN'),
            isOwner: workspace.role === 'OWNER',
          }
        : null,
    [me, workspace, setActive],
  );
  if (!value) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return v;
}

/** Subscribes the query cache to 401s from any request. */
export function useSessionWatcher(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const onExpired = () => {
      setCsrfToken(null);
      // Reset (not setQueryData(undefined), which is a no-op): drop the stale user, then re-ask the server.
      void qc.resetQueries({ queryKey: ME_KEY });
    };
    authEvents.addEventListener('unauthorized', onExpired);
    return () => authEvents.removeEventListener('unauthorized', onExpired);
  }, [qc]);
}

/** Convenience: key prefix for everything scoped to the active workspace. */
export const wsKey = (workspaceId: string, ...rest: unknown[]) =>
  ['ws', workspaceId, ...rest] as const;
export const wsPath = (w: Pick<Workspace, 'id'>, path = '') => `/workspaces/${w.id}${path}`;
