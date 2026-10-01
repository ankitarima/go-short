const nf = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const formatNumber = (n: number): string => nf.format(n);
export const formatCompact = (n: number): string =>
  Math.abs(n) >= 10_000 ? compact.format(n) : nf.format(n);
export const formatPercent = (part: number, total: number): string =>
  total > 0 ? `${Math.round((part / total) * 100)}%` : '0%';

export function formatDate(
  iso: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', opts);
}
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['week', 604800],
    ['month', 2592000],
    ['year', 31536000],
  ];
  let best: [Intl.RelativeTimeFormatUnit, number] = units[0]!;
  for (const u of units) if (abs >= u[1]) best = u;
  return rtf.format(Math.round(diff / best[1]), best[0]);
}

/** `https://go.example.com/sale` -> `go.example.com/sale` */
export const displayUrl = (url: string): string => url.replace(/^https?:\/\//, '');

export const truncate = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/** YYYY-MM-DD for a Date in the browser's local time. */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const daysAgo = (n: number, from = new Date()): Date =>
  new Date(from.getFullYear(), from.getMonth(), from.getDate() - n);

/** A `datetime-local` input value -> ISO string with offset, or undefined when empty. */
export function localToIso(v: string): string | undefined {
  return v ? new Date(v).toISOString() : undefined;
}
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** `1 link`, `2 links` */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${formatNumber(n)} ${n === 1 ? one : many}`;

/** `DESKTOP` -> `Desktop` */
export const titleCase = (s: string): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;

export const ROLE_LABEL = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
} as const;

const COUNTRIES =
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : undefined;
export function countryName(code: string): string {
  try {
    return COUNTRIES?.of(code) ?? code;
  } catch {
    return code;
  }
}
export function countryFlag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}
