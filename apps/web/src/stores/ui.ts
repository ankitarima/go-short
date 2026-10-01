import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';

interface UiState {
  theme: Theme;
  /** What is actually applied (system resolved). Not persisted. */
  resolvedTheme: 'light' | 'dark';
  activeWorkspaceId: string | null;
  mobileNavOpen: boolean;
  setTheme: (t: Theme) => void;
  setActiveWorkspace: (id: string | null) => void;
  setMobileNav: (open: boolean) => void;
}

const systemDark = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
const resolve = (t: Theme): 'light' | 'dark' =>
  t === 'system' ? (systemDark() ? 'dark' : 'light') : t;

export function applyTheme(t: Theme): 'light' | 'dark' {
  const r = resolve(t);
  document.documentElement.classList.toggle('dark', r === 'dark');
  return r;
}

/**
 * Per-viewer conveniences only (theme, last workspace). Stored in localStorage and always optional:
 * the app works if storage is unavailable. Nothing sensitive (no tokens) is ever stored here.
 */
export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      resolvedTheme: 'light',
      activeWorkspaceId: null,
      mobileNavOpen: false,
      setTheme: (theme) => set({ theme, resolvedTheme: applyTheme(theme) }),
      setActiveWorkspace: (activeWorkspaceId) => set({ activeWorkspaceId }),
      setMobileNav: (mobileNavOpen) => set({ mobileNavOpen }),
    }),
    {
      name: 'gs.ui',
      partialize: (s) => ({ theme: s.theme, activeWorkspaceId: s.activeWorkspaceId }),
      onRehydrateStorage: () => (state) => {
        if (state) state.resolvedTheme = applyTheme(state.theme);
      },
    },
  ),
);

/** Follow OS theme changes while the user is on "system". */
export function watchSystemTheme(): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (useUi.getState().theme === 'system')
      useUi.setState({ resolvedTheme: applyTheme('system') });
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
