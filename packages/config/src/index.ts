import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

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
  })
  .superRefine((c, ctx) => {
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
  return { ...c, isProd: c.NODE_ENV === 'production', trustProxy: parseTrustProxy(c.TRUST_PROXY) };
}
