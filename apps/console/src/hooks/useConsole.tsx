import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { ApiError, api, authEvents, setCsrfToken } from '@/lib/api';
import type { ConsoleMe } from '@/types';

export const SESSION_KEY = ['console', 'session'] as const;

/**
 * The console's own sign-in (a separate cookie from the app's): who am I, with which platform role.
 * Null when signed out. A 401 here is a normal state, not an error.
 */
export function useConsoleSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<ConsoleMe | null> => {
      try {
        const me = await api<ConsoleMe>('/admin/me', { public: true });
        setCsrfToken(me.csrfToken);
        return me;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setCsrfToken(null);
          return null;
        }
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

/** Any 401 from a protected call (expired or revoked console session) drops back to the sign-in screen. */
export function useSessionWatcher() {
  const qc = useQueryClient();
  useEffect(() => {
    const onExpired = () => {
      setCsrfToken(null);
      qc.setQueryData(SESSION_KEY, null);
    };
    authEvents.addEventListener('unauthorized', onExpired);
    return () => authEvents.removeEventListener('unauthorized', onExpired);
  }, [qc]);
}

interface Ctx {
  me: ConsoleMe;
  can: (capability: string) => boolean;
}
const ConsoleCtx = createContext<Ctx | null>(null);

export function ConsoleProvider({ me, children }: { me: ConsoleMe; children: ReactNode }) {
  const can = (c: string) => me.capabilities.includes(c);
  return <ConsoleCtx.Provider value={{ me, can }}>{children}</ConsoleCtx.Provider>;
}

export function useConsole(): Ctx {
  const c = useContext(ConsoleCtx);
  if (!c) throw new Error('useConsole must be used inside the console shell');
  return c;
}
