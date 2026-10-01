export const MAX_URL_LENGTH = 2048;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export class UrlValidationError extends Error {}

function hasControlOrSpace(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * Validates and normalizes a destination URL. Only http(s); no embedded credentials.
 * The backend never fetches destinations, so SSRF is not reachable via this value; we additionally
 * reject URLs pointing at this platform's own short domains upstream (redirect loops).
 */
export function normalizeDestinationUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH)
    throw new UrlValidationError('Invalid URL length');
  // Control chars / whitespace inside the URL are never legitimate.
  if (hasControlOrSpace(trimmed)) throw new UrlValidationError('URL contains illegal characters');
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new UrlValidationError('Malformed URL');
  }
  if (!ALLOWED_PROTOCOLS.has(u.protocol))
    throw new UrlValidationError('Only http and https URLs are allowed');
  if (u.username || u.password)
    throw new UrlValidationError('URLs with embedded credentials are not allowed');
  if (!u.hostname) throw new UrlValidationError('URL has no host');
  return u.toString();
}

export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;
export type UtmParams = Partial<Record<(typeof UTM_KEYS)[number], string | null | undefined>>;

/**
 * Merge strategy: UTM values configured on the link are applied only for keys the destination does
 * not already define. A destination that already carries utm_* wins (explicit beats configured),
 * so parameters are never duplicated.
 */
export function mergeUtm(destination: string, utm: UtmParams): string {
  const u = new URL(destination);
  for (const key of UTM_KEYS) {
    const value = utm[key];
    if (value && !u.searchParams.has(key)) u.searchParams.set(key, value);
  }
  return u.toString();
}

/** Lowercase, strip port-less trailing dot; returns null for anything that is not a plausible hostname. */
export function normalizeHostname(input: string): string | null {
  const h = input.trim().toLowerCase().replace(/\.$/, '');
  if (h.length > 253) return null;
  const labels = h.split('.');
  if (labels.length < 2) return null;
  const ok = labels.every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l));
  return ok ? h : null;
}
