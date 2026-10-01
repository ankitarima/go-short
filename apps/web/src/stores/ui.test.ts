import { describe, expect, it } from 'vitest';
import { useUi } from './ui';

describe('ui store', () => {
  it('applies the dark class and persists only theme and workspace', () => {
    useUi.getState().setTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    useUi.getState().setActiveWorkspace('ws_9');
    useUi.getState().setTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    const stored = JSON.parse(localStorage.getItem('gs.ui')!);
    expect(stored.state).toEqual({ theme: 'light', activeWorkspaceId: 'ws_9' });
    // Nothing sensitive is ever stored.
    expect(JSON.stringify(stored)).not.toMatch(/csrf|token|password/i);
  });
});
