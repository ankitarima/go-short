/* global localStorage, matchMedia, document */
// Applies the saved theme before first paint to avoid a flash.
// External (not inline) so the production CSP can forbid inline scripts entirely.
try {
  const t = JSON.parse(localStorage.getItem('gs.ui') || '{}').state?.theme || 'system';
  const dark =
    t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
} catch {
  // Storage unavailable (private mode, blocked): keep the default theme.
}
