export type StaffRole = 'MANAGER' | 'ADMIN' | 'SUPER_ADMIN';
export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export interface ConsoleMe {
  user: { id: string; email: string; name: string };
  role: StaffRole;
  capabilities: string[];
  links: { grafana: string | null; prometheus: string | null };
  metricsConfigured: boolean;
  csrfToken: string;
}

export interface Stats {
  users: number;
  workspaces: number;
  domains: number;
  links: number;
  qrCodes: number;
  campaigns: number;
  clickEventsEstimate: number;
  queues: Record<string, Record<string, number>>;
}

export interface DailyCount {
  date: string;
  count: number;
}
export interface Usage {
  days: number;
  totals: {
    signups: number;
    workspacesCreated: number;
    linksCreated: number;
    clicks: number;
    activeWorkspaces: number;
  };
  signups: DailyCount[];
  workspacesCreated: DailyCount[];
  linksCreated: DailyCount[];
  clicks: DailyCount[];
  topWorkspaces: Array<{ workspaceId: string; name: string; slug: string; clicks: number }>;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  systemRole: 'USER' | StaffRole;
  disabledAt: string | null;
  createdAt: string;
  workspaceCount: number;
}
export interface AdminUserDetail extends Omit<AdminUser, 'workspaceCount'> {
  activeSessions: number;
  apiKeyCount: number;
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    role: WorkspaceRole;
    joinedAt: string;
  }>;
}

export interface AdminWorkspace {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  retentionDays: number | null;
  createdAt: string;
  memberCount: number;
  linkCount: number;
  domainCount: number;
  campaignCount: number;
}
export interface AdminWorkspaceDetail {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  retentionDays: number | null;
  hashIps: boolean;
  filterBots: boolean;
  createdAt: string;
  clicksLast30Days: number;
  counts: { links: number; campaigns: number; qrCodes: number; apiKeys: number; webhooks: number };
  members: Array<{
    userId: string;
    email: string;
    name: string;
    disabled: boolean;
    role: WorkspaceRole;
    joinedAt: string;
  }>;
  domains: Array<{ id: string; hostname: string; status: string }>;
}

export interface TeamMember {
  id: string;
  role: WorkspaceRole;
  joinedAt: string;
  user: { id: string; email: string; name: string; disabled: boolean };
  workspace: { id: string; name: string; slug: string };
}

export interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  disabled: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  workspaceId: string | null;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata?: unknown;
  createdAt: string;
  actor: { email: string; name: string } | null;
}

export interface FailedJob {
  id: string | null;
  name: string;
  attemptsMade: number;
  failedReason: string | null;
  createdAt: string;
  failedAt: string | null;
  summary: Record<string, unknown>;
}

export interface MetricValue {
  name: string;
  label: string;
  unit: 'rps' | 'ms' | 'percent' | 'count' | 'per_minute';
  value: number | null;
}
export interface Monitoring {
  configured: boolean;
  links: { grafana: string | null; prometheus: string | null };
  metrics: MetricValue[];
}
export interface MetricRange {
  name: string;
  label: string;
  unit: string;
  minutes: number;
  points: Array<{ t: number; v: number | null }>;
}

export interface SharedDomain {
  id: string;
  hostname: string;
  status: 'VERIFIED' | 'DISABLED';
  isDefault: boolean;
  linkCount: number;
  createdAt: string;
}
export interface SharedDomains {
  domains: SharedDomain[];
  cnameTarget: string;
  appHostname: string;
}
export interface SharedDomainDns {
  hostname: string;
  addresses: string[];
  appAddresses: string[];
  result: 'matches' | 'differs' | 'not_resolving' | 'unknown';
}
