export const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
export type WorkspaceRole = (typeof ROLES)[number];

export const PERMISSIONS = [
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'members:read',
  'members:manage',
  'domains:read',
  'domains:manage',
  'links:read',
  'links:write',
  'links:delete',
  'campaigns:read',
  'campaigns:write',
  'campaigns:delete',
  'qr:read',
  'qr:write',
  'analytics:read',
  'analytics:export',
  'apikeys:manage',
  'webhooks:manage',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = [
  'workspace:read',
  'members:read',
  'domains:read',
  'links:read',
  'campaigns:read',
  'qr:read',
  'analytics:read',
];
const MEMBER: Permission[] = [
  ...VIEWER,
  'links:write',
  'links:delete',
  'campaigns:write',
  'campaigns:delete',
  'qr:write',
  'analytics:export',
];
const ADMIN: Permission[] = [
  ...MEMBER,
  'workspace:update',
  'members:manage',
  'domains:manage',
  'apikeys:manage',
  'webhooks:manage',
  'audit:read',
];

export const ROLE_PERMISSIONS: Record<WorkspaceRole, ReadonlySet<Permission>> = {
  VIEWER: new Set(VIEWER),
  MEMBER: new Set(MEMBER),
  ADMIN: new Set(ADMIN),
  OWNER: new Set<Permission>([...ADMIN, 'workspace:delete']),
};

export function can(role: WorkspaceRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

const RANK: Record<WorkspaceRole, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

/** Whether `actor` may assign/remove `target` role. Nobody can grant a role above their own; only OWNER manages OWNER. */
export function canAssignRole(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (!can(actor, 'members:manage')) return false;
  if (target === 'OWNER') return actor === 'OWNER';
  return RANK[actor] >= RANK[target];
}
