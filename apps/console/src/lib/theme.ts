// The console shares the app's saved theme (same origin, same storage key), so staff see one theme everywhere.
export type Theme = 'light' | 'dark' | 'system';
const KEY = 'gs.ui';

export function getTheme(): Theme {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || '{}').state?.theme;
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(t: Theme) {
  const dark =
    t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function setTheme(t: Theme) {
  try {
    const cur = JSON.parse(localStorage.getItem(KEY) || '{}');
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...cur,
        state: { ...(cur.state ?? {}), theme: t },
        version: cur.version ?? 0,
      }),
    );
  } catch {
    /* storage unavailable: the choice applies to this visit only */
  }
  applyTheme(t);
}
