import { createHash, createHmac } from 'node:crypto';
import Bowser from 'bowser';
import { isbot } from 'isbot';

export type Device = 'MOBILE' | 'DESKTOP' | 'TABLET' | 'OTHER';

export interface ParsedUa {
  device: Device;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  isBot: boolean;
}

const clip = (v: string | undefined | null, n: number): string | null => (v ? v.slice(0, n) : null);
const major = (v: string | undefined) => (v ? v.split('.')[0]! : undefined);

/**
 * Heuristic by design: `isbot` matches known crawler/automation user agents (and an empty UA),
 * so unknown or spoofed bots will be counted as humans. Bot events are kept, only flagged.
 */
export function parseUserAgent(ua: string | null): ParsedUa {
  if (!ua)
    return {
      device: 'OTHER',
      browser: null,
      browserVersion: null,
      os: null,
      osVersion: null,
      isBot: true,
    };
  const bot = isbot(ua);
  const r = Bowser.parse(ua);
  const t = r.platform.type;
  const device: Device =
    t === 'mobile' ? 'MOBILE' : t === 'tablet' ? 'TABLET' : t === 'desktop' ? 'DESKTOP' : 'OTHER';
  return {
    device,
    // Major versions only: bounds cardinality and is all a dashboard needs.
    browser: clip(r.browser.name, 50),
    browserVersion: clip(major(r.browser.version), 20),
    os: clip(r.os.name, 50),
    osVersion: clip(major(r.os.version), 20),
    isBot: bot,
  };
}

/** Host only (no path/query: those can hold tokens and are unbounded). Lowercased, `www.` stripped. */
export function referrerHost(referer: string | null): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    return h ? h.slice(0, 100) : null;
  } catch {
    return null;
  }
}

/** First language tag of Accept-Language, e.g. "en-IN,en;q=0.9" -> "en-IN". */
export function primaryLanguage(header: string | null): string | null {
  if (!header) return null;
  const tag = header.split(',')[0]?.split(';')[0]?.trim();
  return tag && /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/.test(tag) ? tag.slice(0, 16) : null;
}

/** UTC calendar day, "YYYY-MM-DD". */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Privacy-preserving identifiers. The salt is derived per UTC day from a server secret, so the
 * same visitor hashes differently tomorrow (no cross-day tracking) and hashes cannot be reversed
 * back to IPs without the secret.
 *
 * `visitorHash` = approximate unique-visitor key: hash(day salt, IP, user agent). Shared NATs
 * undercount; a visitor changing network or browser overcounts.
 */
export class Hasher {
  private readonly cache = new Map<string, Buffer>();
  constructor(private readonly secret: string) {}

  private salt(day: string): Buffer {
    let s = this.cache.get(day);
    if (!s) {
      if (this.cache.size > 8) this.cache.clear();
      s = createHmac('sha256', this.secret).update(`analytics-salt:${day}`).digest();
      this.cache.set(day, s);
    }
    return s;
  }

  visitorHash(day: string, ip: string, userAgent: string | null): string {
    return createHash('sha256')
      .update(this.salt(day))
      .update('v|')
      .update(ip)
      .update('|')
      .update(userAgent ?? '')
      .digest('hex')
      .slice(0, 32);
  }

  ipHash(day: string, ip: string): string {
    return createHash('sha256')
      .update(this.salt(day))
      .update('i|')
      .update(ip)
      .digest('hex')
      .slice(0, 32);
  }
}
