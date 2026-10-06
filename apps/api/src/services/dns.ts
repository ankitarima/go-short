import { promises as dns } from 'node:dns';

/** Injectable so tests (and future DoH resolvers) don't need real DNS. */
export interface DnsResolver {
  resolveCname(hostname: string): Promise<string[]>;
  resolveTxt(hostname: string): Promise<string[][]>;
  /** A and AAAA addresses; empty when the name does not resolve. */
  resolveAddresses(hostname: string): Promise<string[]>;
}

export const systemDnsResolver: DnsResolver = {
  resolveCname: (h) => dns.resolveCname(h),
  resolveTxt: (h) => dns.resolveTxt(h),
  resolveAddresses: async (h) => {
    const [v4, v6] = await Promise.all([
      dns.resolve4(h).catch(() => [] as string[]),
      dns.resolve6(h).catch(() => [] as string[]),
    ]);
    return [...v4, ...v6];
  },
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
  cnameTarget: string | readonly string[],
): Promise<DnsCheck> {
  const targets = (Array.isArray(cnameTarget) ? cnameTarget : [cnameTarget]).map(norm);
  const cnames = await resolver.resolveCname(hostname).catch(() => [] as string[]);
  if (cnames.some((c) => targets.includes(norm(c)))) return { ok: true, method: 'CNAME' };
  const txts = await resolver
    .resolveTxt(`${VERIFY_TXT_PREFIX}.${hostname}`)
    .catch(() => [] as string[][]);
  if (txts.some((chunks) => chunks.join('') === token)) return { ok: true, method: 'TXT' };
  return { ok: false };
}
