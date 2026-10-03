export * from '@go-short/ui/lib/format';

export const ROLE_LABEL = {
  USER: 'User',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
  SUPER_ADMIN: 'Super admin',
  OWNER: 'Owner',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
} as const;

export const ROLE_HINT = {
  MANAGER: 'Read-only: sees everything, changes nothing. For monitoring and support.',
  ADMIN: 'Everything a manager can, plus suspending accounts, retrying jobs and running cleanups.',
  SUPER_ADMIN: 'Everything an admin can, plus adding and removing platform staff.',
} as const;

/** Human formatting for a metric value, by its unit. */
export function formatMetric(unit: string, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 'n/a';
  switch (unit) {
    case 'rps':
      return `${v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)} /s`;
    case 'ms':
      return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ms`;
    case 'percent':
      return `${v.toFixed(v >= 10 ? 0 : v >= 1 ? 1 : 2)}%`;
    case 'per_minute':
      return `${v.toFixed(1)} /min`;
    default:
      return Math.round(v).toLocaleString('en-US');
  }
}
