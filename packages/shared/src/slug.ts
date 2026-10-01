import { customAlphabet } from 'nanoid';

// No look-alike chars (0/O, 1/l/I) so slugs survive printing on posters.
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
const gen = customAlphabet(ALPHABET, 7);

export const generateSlug = (): string => gen();

export const SLUG_MIN = 3;
export const SLUG_MAX = 64;
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const DEFAULT_RESERVED_SLUGS = [
  'api',
  'admin',
  'login',
  'register',
  'dashboard',
  'settings',
  'health',
  'ready',
  'metrics',
  'favicon.ico',
  'robots.txt',
];

export type SlugCheck = { ok: true } | { ok: false; reason: 'length' | 'characters' | 'reserved' };

export function checkCustomSlug(
  slug: string,
  reserved: readonly string[] = DEFAULT_RESERVED_SLUGS,
): SlugCheck {
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return { ok: false, reason: 'length' };
  if (reserved.some((r) => r.toLowerCase() === slug.toLowerCase()))
    return { ok: false, reason: 'reserved' };
  if (!SLUG_RE.test(slug)) return { ok: false, reason: 'characters' };
  return { ok: true };
}
