import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { ApiError, api, authEvents, setCsrfToken } from '@/lib/api';
import type { ConsoleMe, Session } from '@/types';

export const SESSION_KEY = ['session'] as const;
export const CONSOLE_ME_KEY = ['console', 'me'] as const;

/** The signed-in person, or null when signed out. A 401 here is a normal state, not an error. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<Session | null> => {
      try {
        const me = await api<{ user: Session['user']; csrfToken: string }>('/me', { public: true });
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
  });
}

/** Platform role and capabilities. 403 means "signed in, but not platform staff". */
export function useConsoleMe(enabled: boolean) {
  return useQuery({
    queryKey: CONSOLE_ME_KEY,
    queryFn: () => api<ConsoleMe>('/admin/me'),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

/** Any 401 from a protected call drops the console back to the sign-in screen. */
export function useSessionWatcher() {
  const qc = useQueryClient();
  useEffect(() => {
    const onExpired = () => {
      setCsrfToken(null);
      void qc.resetQueries({ queryKey: SESSION_KEY });
    };
    authEvents.addEventListener('unauthorized', onExpired);
    return () => authEvents.removeEventListener('unauthorized', onExpired);
  }, [qc]);
}

interface Ctx {
  me: ConsoleMe;
  session: Session;
  can: (capability: string) => boolean;
}
const ConsoleCtx = createContext<Ctx | null>(null);

export function ConsoleProvider({
  value,
  children,
}: {
  value: { me: ConsoleMe; session: Session };
  children: ReactNode;
}) {
  const can = (c: string) => value.me.capabilities.includes(c);
  return <ConsoleCtx.Provider value={{ ...value, can }}>{children}</ConsoleCtx.Provider>;
}

export function useConsole(): Ctx {
  const c = useContext(ConsoleCtx);
  if (!c) throw new Error('useConsole must be used inside the console shell');
  return c;
}
