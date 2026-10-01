import { BlockList, isIP } from 'node:net';

/**
 * Addresses a server-side HTTP client must never connect to on a user's behalf: loopback, private,
 * link-local (cloud metadata is 169.254.169.254), CGNAT, documentation/benchmark, multicast, reserved.
 */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['64:ff9b::', 96],
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

/** True only for globally routable unicast addresses. Unparseable input is NOT public. */
export function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !blocked.check(ip, 'ipv4');
  if (family === 6) {
    // IPv4-mapped (::ffff:a.b.c.d): judge the embedded IPv4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return isPublicIp(mapped[1]!);
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1]!, 16);
      const lo = parseInt(hexMapped[2]!, 16);
      return isPublicIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return !blocked.check(ip, 'ipv6');
  }
  return false;
}

export class UnsafeUrlError extends Error {}

/**
 * Static checks for a webhook URL (early feedback at creation time). The authoritative defence is
 * at delivery time, where the resolved addresses are checked and the connection is pinned to them.
 */
export function validateOutboundUrl(raw: string, opts: { allowInsecure?: boolean } = {}): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError('Malformed URL');
  }
  if (u.protocol !== 'https:' && !(opts.allowInsecure && u.protocol === 'http:')) {
    throw new UnsafeUrlError('Webhook URLs must use https');
  }
  if (u.username || u.password)
    throw new UnsafeUrlError('URLs with embedded credentials are not allowed');
  if (raw.length > 2048) throw new UnsafeUrlError('URL is too long');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!opts.allowInsecure) {
    if (isIP(host) && !isPublicIp(host))
      throw new UnsafeUrlError('URL points at a private or reserved address');
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      (!host.includes('.') && !isIP(host))
    ) {
      throw new UnsafeUrlError('URL must use a public hostname');
    }
  }
  return u;
}
