import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Empty/absent => undefined (feature off); otherwise a positive integer number of days. */
const optionalDays = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : Number(v)))
  .pipe(z.number().int().min(1).max(36500).optional());

const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    APP_URL: z.url(),
    API_PORT: z.coerce.number().int().default(4000),
    REDIRECT_PORT: z.coerce.number().int().default(4001),
    DEFAULT_SHORT_DOMAIN: z.string().min(1),
    CORS_ORIGINS: csv.default([]),
    TRUST_PROXY: z.string().default('loopback'),
    REDIRECT_STATUS: z.coerce
      .number()
      .refine((n) => [301, 302, 307, 308].includes(n), 'must be 301, 302, 307 or 308')
      .default(302),
    REDIRECT_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
    RESERVED_SLUGS: csv.default([
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
    ]),
    GEOIP_DATABASE_PATH: z.string().default('./storage/geoip/dbip-city-lite.mmdb'),
    STORAGE_PATH: z.string().default('./storage'),
    /** Redirect service: flush buffered click events to the queue every N ms, or at ANALYTICS_BATCH_MAX events. */
    ANALYTICS_BATCH_FLUSH_MS: z.coerce.number().int().min(10).max(5000).default(250),
    ANALYTICS_BATCH_MAX: z.coerce.number().int().min(1).max(2000).default(500),
    /** Hard cap on events held in memory while the queue is unreachable; oldest are dropped beyond it. */
    ANALYTICS_BUFFER_MAX: z.coerce.number().int().min(1000).max(1_000_000).default(20_000),
    /** Requests per minute allowed per API key (fixed window). */
    API_KEY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(600),
    /** Scheduled cleanup jobs run in the worker. Set false to disable all of them. */
    CLEANUP_ENABLED: bool.default(true),
    /** Optional retention: unset (the default) means "keep forever". */
    AUDIT_LOG_RETENTION_DAYS: optionalDays,
    EXPIRED_LINK_DELETE_AFTER_DAYS: optionalDays,
    /** 15-minute buckets only exist to serve timezone-exact timelines; older ones can go. */
    BUCKET_RETENTION_DAYS: z.coerce.number().int().min(31).max(3650).default(400),
    /** Dev/test only: allow http:// and private-network webhook targets (disables the SSRF guard). */
    WEBHOOK_ALLOW_INSECURE: bool.default(false),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
    FEATURE_CUSTOM_DOMAINS: bool.default(true),
    FEATURE_CAMPAIGNS: bool.default(true),
    FEATURE_QR_LOGOS: bool.default(true),
    FEATURE_PASSWORD_LINKS: bool.default(true),
    FEATURE_API: bool.default(true),
    /** If set, expired/disabled/unknown links redirect here instead of showing an error page. */
    LINK_UNAVAILABLE_REDIRECT_URL: z
      .union([z.url(), z.literal('')])
      .optional()
      .transform((v) => v || undefined),
    /** Shared secret for internal endpoints (Caddy on-demand TLS "ask"). Required in production when custom domains are on. */
    INTERNAL_API_TOKEN: z.string().min(16).optional(),
    /** Prometheus metrics are served on a separate, non-public port per process (never on the public listener). */
    METRICS_ENABLED: bool.default(true),
    /** Bind address for the metrics ports. Loopback by default; use 0.0.0.0 only on a private network, with METRICS_TOKEN. */
    METRICS_HOST: z.string().min(1).default('127.0.0.1'),
    /** Optional bearer token required to scrape metrics. Required in production when METRICS_HOST is not loopback. */
    METRICS_TOKEN: z.string().min(16).optional(),
    API_METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9101),
    REDIRECT_METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9102),
    WORKER_METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9103),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === 'production') {
      // The shipped .env.example value passes the length check; it must never run in production.
      if (/change[-_ ]?me|example|secret|password/i.test(c.SESSION_SECRET)) {
        ctx.addIssue({
          code: 'custom',
          path: ['SESSION_SECRET'],
          message: 'looks like a placeholder; generate one with: openssl rand -hex 32',
        });
      }
      if (new Set(c.SESSION_SECRET).size < 10) {
        ctx.addIssue({
          code: 'custom',
          path: ['SESSION_SECRET'],
          message: 'has too little variety to be random; generate one with: openssl rand -hex 32',
        });
      }
      const loopback = ['127.0.0.1', '::1', 'localhost'].includes(c.METRICS_HOST);
      if (c.METRICS_ENABLED && !loopback && !c.METRICS_TOKEN) {
        ctx.addIssue({
          code: 'custom',
          path: ['METRICS_TOKEN'],
          message: 'required in production when METRICS_HOST is not loopback (min 16 chars)',
        });
      }
    }
    if (c.NODE_ENV === 'production' && c.FEATURE_CUSTOM_DOMAINS && !c.INTERNAL_API_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        path: ['INTERNAL_API_TOKEN'],
        message: 'required in production when FEATURE_CUSTOM_DOMAINS=true (min 16 chars)',
      });
    }
  });

export type Config = z.infer<typeof schema> & {
  isProd: boolean;
  /** Parsed value for Express `trust proxy`: hop count, or comma-separated CIDRs/keywords. */
  trustProxy: number | string[] | boolean;
};

/** Express "trust proxy": digits => hop count, "false" => off, otherwise a list of subnets/keywords. */
export function parseTrustProxy(raw: string): Config['trustProxy'] {
  if (raw === 'false') return false;
  if (raw === 'true')
    throw new Error(
      'TRUST_PROXY=true trusts any client-supplied X-Forwarded-For; use a hop count or CIDR list',
    );
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const c = result.data;
  const root = findProjectRoot();
  return {
    ...c,
    // Relative paths are anchored to the project root, not whichever app directory we were started in.
    GEOIP_DATABASE_PATH: resolvePath(c.GEOIP_DATABASE_PATH, root),
    STORAGE_PATH: resolvePath(c.STORAGE_PATH, root),
    isProd: c.NODE_ENV === 'production',
    trustProxy: parseTrustProxy(c.TRUST_PROXY),
  };
}

/**
 * Nearest ancestor directory whose package.json declares `workspaces` (the monorepo root).
 * Falls back to `start` (e.g. /app inside a container, where there is no monorepo root).
 */
export function findProjectRoot(start: string = process.cwd()): string {
  let dir = start;
  for (;;) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, 'utf8')) as { workspaces?: unknown }).workspaces)
          return dir;
      } catch {
        /* unreadable package.json: keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

const resolvePath = (p: string, root: string): string => (isAbsolute(p) ? p : resolve(root, p));
