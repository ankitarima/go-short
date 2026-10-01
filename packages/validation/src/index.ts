import { z } from 'zod';
import { ROLES } from '@go-short/shared';

export const email = z.string().trim().toLowerCase().email().max(254);
// 12+ chars; Argon2id makes length the main defence. Max stops hashing-DoS.
export const password = z.string().min(12, 'Password must be at least 12 characters').max(256);

export const registerSchema = z.object({
  email,
  name: z.string().trim().min(1).max(100),
  password,
});
export const loginSchema = z.object({ email, password: z.string().min(1).max(256) });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: password,
});
export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: password,
});

export const workspaceSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, 'Use 3-40 lowercase letters, numbers or hyphens');

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: workspaceSlug.optional(),
});
export const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    timezone: z.string().refine(isValidTimezone, 'Unknown IANA timezone'),
    hashIps: z.boolean(),
    filterBots: z.boolean(),
    retentionDays: z.number().int().min(1).max(3650).nullable(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No fields to update');

export const inviteMemberSchema = z.object({ email, role: z.enum(ROLES).exclude(['OWNER']) });
export const updateMemberSchema = z.object({ role: z.enum(ROLES) });

export const cursorQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

// ---- domains ----
export const createDomainSchema = z.object({ hostname: z.string().trim().min(1).max(253) });
export const updateDomainSchema = z
  .object({ isDefault: z.boolean(), disabled: z.boolean() })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No fields to update');

// ---- links ----
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();

const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

export const createLinkSchema = z.object({
  destinationUrl: z.string().min(1).max(2048),
  domainId: z.string().min(1).max(50).optional(),
  slug: z.string().min(1).max(64).optional(),
  title: optionalText(200),
  description: optionalText(1000),
  campaignId: z.string().min(1).max(50).nullish(),
  utmSource: optionalText(200),
  utmMedium: optionalText(200),
  utmCampaign: optionalText(200),
  utmTerm: optionalText(200),
  utmContent: optionalText(200),
  expiresAt: isoDate.nullish(),
  password: z.string().min(4).max(128).nullish(),
  isActive: z.boolean().optional(),
  redirectStatus: z
    .union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)])
    .nullish(),
});
export const updateLinkSchema = createLinkSchema
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No fields to update');

export const listLinksQuery = cursorQuery.extend({
  campaignId: z.string().max(50).optional(),
  domainId: z.string().max(50).optional(),
  q: z.string().trim().max(100).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// ---- analytics ----
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Invalid date');

export const analyticsQuery = z.object({
  /** Inclusive local dates in `timezone`. Default: the last 30 days. */
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  timezone: z.string().max(64).refine(isValidTimezone, 'Unknown IANA timezone').optional(),
  granularity: z.enum(['day', 'hour']).default('day'),
  linkId: z.string().max(50).optional(),
  campaignId: z.string().max(50).optional(),
  country: z
    .string()
    .length(2)
    .transform((s) => s.toUpperCase())
    .optional(),
  device: z.enum(['MOBILE', 'DESKTOP', 'TABLET', 'OTHER']).optional(),
  includeBots: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuery>;

export const exportQuery = analyticsQuery
  .pick({ from: true, to: true, timezone: true, linkId: true, campaignId: true, includeBots: true })
  .extend({
    /** daily = rollup rows (small); events = streamed raw clicks (no IPs or visitor ids). */
    type: z.enum(['daily', 'events']).default('daily'),
  });

// ---- campaigns ----
const campaignDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const campaignBase = z.object({
  name: z.string().trim().min(1).max(120),
  description: z
    .string()
    .trim()
    .max(1000)
    .transform((v) => (v === '' ? null : v))
    .nullish(),
  startDate: campaignDate.nullish(),
  endDate: campaignDate.nullish(),
  utmCampaign: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v === '' ? null : v))
    .nullish(),
});
const endAfterStart = (c: { startDate?: Date | null; endDate?: Date | null }) =>
  !c.startDate || !c.endDate || c.endDate >= c.startDate;
export const createCampaignSchema = campaignBase.refine(endAfterStart, {
  message: 'endDate must not be before startDate',
  path: ['endDate'],
});
export const updateCampaignSchema = campaignBase
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No fields to update')
  .refine(endAfterStart, { message: 'endDate must not be before startDate', path: ['endDate'] });
export const listCampaignsQuery = cursorQuery.extend({ q: z.string().trim().max(100).optional() });

// ---- QR codes ----
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour such as #000000')
  .transform((v) => v.toUpperCase());
export const qrSize = z.number().int().min(128).max(2048);
export const qrOptions = {
  format: z.enum(['svg', 'png']),
  size: qrSize,
  margin: z.number().int().min(0).max(10),
  errorCorrection: z.enum(['L', 'M', 'Q', 'H']),
  foregroundColor: hexColor,
  backgroundColor: hexColor,
};
export const createQrSchema = z.object({
  name: z.string().trim().min(1).max(120),
  linkId: z.string().min(1).max(50),
  campaignId: z.string().min(1).max(50).nullish(),
  format: qrOptions.format.default('svg'),
  size: qrOptions.size.default(512),
  margin: qrOptions.margin.default(2),
  errorCorrection: qrOptions.errorCorrection.default('M'),
  foregroundColor: qrOptions.foregroundColor.default('#000000'),
  backgroundColor: qrOptions.backgroundColor.default('#FFFFFF'),
  logoPath: z.string().min(1).max(200).nullish(),
});
export const updateQrSchema = z
  .object({
    name: createQrSchema.shape.name,
    campaignId: z.string().min(1).max(50).nullable(),
    format: qrOptions.format,
    size: qrOptions.size,
    margin: qrOptions.margin,
    errorCorrection: qrOptions.errorCorrection,
    foregroundColor: qrOptions.foregroundColor,
    backgroundColor: qrOptions.backgroundColor,
    logoPath: z.string().min(1).max(200).nullable(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No fields to update');
export const listQrQuery = cursorQuery.extend({
  campaignId: z.string().max(50).optional(),
  linkId: z.string().max(50).optional(),
});
export const qrImageQuery = z.object({
  format: qrOptions.format.optional(),
  size: z.coerce.number().int().min(128).max(2048).optional(),
  download: z.enum(['1', 'true']).optional(),
});
