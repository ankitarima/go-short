export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  systemRole: 'USER' | 'ADMIN';
}
export interface WorkspaceRef {
  id: string;
  name: string;
  slug: string;
  role: Role;
}
export interface Me {
  user: User;
  csrfToken: string;
  workspaces: WorkspaceRef[];
}
export interface AuthResult {
  user: User;
  csrfToken: string;
}
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  hashIps: boolean;
  filterBots: boolean;
  retentionDays: number | null;
  createdAt: string;
  role?: Role;
}
export interface Overview {
  links: number;
  campaigns: number;
  qrCodes: number;
  domains: number;
  members: number;
}
export interface Member {
  id: string;
  role: Role;
  createdAt: string;
  user: { id: string; email: string; name: string };
}
export interface AuditLog {
  id: string;
  workspaceId: string | null;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}
export interface Domain {
  id: string;
  hostname: string;
  status: 'PENDING' | 'VERIFIED' | 'DISABLED';
  isVerified: boolean;
  isDefault: boolean;
  shared: boolean;
  createdAt: string;
  dns: { cname: DnsRecord; txt: DnsRecord } | null;
}
export interface DnsRecord {
  type: string;
  name: string;
  value: string;
}
export interface DomainVerification {
  verified: boolean;
  method?: 'CNAME' | 'TXT';
  domain: Domain;
}
export interface Link {
  id: string;
  domainId: string;
  hostname: string;
  slug: string;
  shortUrl: string;
  destinationUrl: string;
  title: string | null;
  description: string | null;
  campaignId: string | null;
  isActive: boolean;
  expiresAt: string | null;
  expired: boolean;
  hasPassword: boolean;
  redirectStatus: number | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  utmCampaign: string | null;
  linkCount: number;
  qrCodeCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface Qr {
  id: string;
  name: string;
  linkId: string;
  campaignId: string | null;
  format: 'svg' | 'png';
  size: number;
  margin: number;
  errorCorrection: 'L' | 'M' | 'Q' | 'H';
  foregroundColor: string;
  backgroundColor: string;
  hasLogo: boolean;
  url: string;
  createdAt: string;
  updatedAt: string;
}
export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  role: 'VIEWER' | 'MEMBER';
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdBy?: { id: string; name: string };
}
export interface ApiKeyCreated extends ApiKey {
  key: string;
}
export interface Webhook {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
}
export interface WebhookCreated extends Webhook {
  secret: string;
}

export interface BreakdownRow {
  value: string;
  clicks: number;
  name?: string | null;
}
export interface Analytics {
  summary: {
    clicks: number;
    humanClicks: number;
    botClicks: number;
    uniqueVisitors: number;
    qrScans: number;
  };
  timeline: Array<{ date: string; clicks: number; humanClicks: number; botClicks: number }>;
  countries: BreakdownRow[];
  regions: BreakdownRow[];
  cities: BreakdownRow[];
  devices: BreakdownRow[];
  browsers: BreakdownRow[];
  os: BreakdownRow[];
  referrers: BreakdownRow[];
  utmSources: BreakdownRow[];
  utmMediums: BreakdownRow[];
  utmCampaigns: BreakdownRow[];
  qrCodes: BreakdownRow[];
  topLinks: Array<{
    linkId: string;
    clicks: number;
    slug: string | null;
    title: string | null;
    hostname: string | null;
    deleted: boolean;
  }>;
  meta: {
    timezone: string;
    from: string;
    to: string;
    granularity: 'day' | 'hour';
    includeBots: boolean;
    source: 'rollup' | 'events';
    notes: string[];
  };
}

export interface AdminStats {
  users: number;
  workspaces: number;
  domains: number;
  links: number;
  qrCodes: number;
  campaigns: number;
  clickEventsEstimate: number;
  queues: Record<string, Record<string, number>>;
}
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  systemRole: 'USER' | 'ADMIN';
  createdAt: string;
  workspaceCount: number;
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
export interface FailedJob {
  id: string | null;
  name: string;
  attemptsMade: number;
  failedReason: string | null;
  createdAt: string;
  failedAt: string | null;
  summary: Record<string, unknown>;
}
