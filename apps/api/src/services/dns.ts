import { promises as dns } from 'node:dns';

/** Injectable so tests (and future DoH resolvers) don't need real DNS. */
export interface DnsResolver {
  resolveCname(hostname: string): Promise<string[]>;
  resolveTxt(hostname: string): Promise<string[][]>;
}

export const systemDnsResolver: DnsResolver = {
  resolveCname: (h) => dns.resolveCname(h),
  resolveTxt: (h) => dns.resolveTxt(h),
};

export const VERIFY_TXT_PREFIX = '_goshort-verify';
const norm = (h: string) => h.toLowerCase().replace(/\.$/, '');

export type DnsCheck = { ok: true; method: 'CNAME' | 'TXT' } | { ok: false };

/**
 * Ownership proof: either a CNAME to the platform host (preferred for redirect subdomains) or a TXT
 * record `_goshort-verify.<host>` holding the token (works for apex domains and proxied/flattened
 * CNAMEs). NXDOMAIN/NODATA and other resolver errors simply count as "not verified".
 */
export async function checkDomainDns(
  resolver: DnsResolver,
  hostname: string,
  token: string,
  cnameTarget: string,
): Promise<DnsCheck> {
  const target = norm(cnameTarget);
  const cnames = await resolver.resolveCname(hostname).catch(() => [] as string[]);
  if (cnames.some((c) => norm(c) === target)) return { ok: true, method: 'CNAME' };
  const txts = await resolver
    .resolveTxt(`${VERIFY_TXT_PREFIX}.${hostname}`)
    .catch(() => [] as string[][]);
  if (txts.some((chunks) => chunks.join('') === token)) return { ok: true, method: 'TXT' };
  return { ok: false };
}
