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
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), newPassword: password });

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
