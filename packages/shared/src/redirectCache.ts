import { mergeUtm } from './url';

export type RedirectStatus = 301 | 302 | 307 | 308;

/**
 * What the redirect service needs and nothing more. Shared by the API (which invalidates keys) and
 * the redirect service (which fills them) so the two can never disagree about the key format.
 * Never contains password hashes. For password-protected links `destinationUrl` is null, so a
 * cache read can never yield an open redirect to a protected destination.
 */
export interface RedirectCacheEntry {
  linkId: string;
  workspaceId: string;
  campaignId: string | null;
  destinationUrl: string | null;
  active: boolean;
  expiresAt: string | null;
  hasPassword: boolean;
  status: RedirectStatus | null; // null = use the service default
}

export const NEGATIVE_CACHE_VALUE = '{"missing":true}';

/** Hostname is lowercased; the slug is case-sensitive. Host header is validated upstream. */
export const linkCacheKey = (hostname: string, slug: string): string =>
  `link:${hostname.toLowerCase()}:${slug}`;

export interface CacheableLink {
  id: string;
  workspaceId: string;
  campaignId: string | null;
  destinationUrl: string;
  isActive: boolean;
  expiresAt: Date | null;
  passwordHash: string | null;
  redirectStatus: number | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
}

export function buildCacheEntry(link: CacheableLink): RedirectCacheEntry {
  const hasPassword = link.passwordHash !== null;
  return {
    linkId: link.id,
    workspaceId: link.workspaceId,
    campaignId: link.campaignId,
    destinationUrl: hasPassword
      ? null
      : mergeUtm(link.destinationUrl, {
          utm_source: link.utmSource,
          utm_medium: link.utmMedium,
          utm_campaign: link.utmCampaign,
          utm_term: link.utmTerm,
          utm_content: link.utmContent,
        }),
    active: link.isActive,
    expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
    hasPassword,
    status: (link.redirectStatus as RedirectStatus | null) ?? null,
  };
}
