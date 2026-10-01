import { describe, expect, it } from 'vitest';
import { cursorQuery, inviteMemberSchema, registerSchema, updateWorkspaceSchema } from './index';

describe('validation', () => {
  it('normalizes email and enforces password length', () => {
    expect(registerSchema.parse({ email: ' A@B.com ', name: 'x', password: 'a'.repeat(12) }).email).toBe('a@b.com');
    expect(registerSchema.safeParse({ email: 'a@b.com', name: 'x', password: 'short' }).success).toBe(false);
  });
  it('cannot invite as OWNER', () => {
    expect(inviteMemberSchema.safeParse({ email: 'a@b.com', role: 'OWNER' }).success).toBe(false);
  });
  it('caps page size at 100', () => {
    expect(cursorQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(cursorQuery.parse({}).limit).toBe(50);
  });
  it('validates timezone and non-empty patch', () => {
    expect(updateWorkspaceSchema.safeParse({ timezone: 'Mars/Base' }).success).toBe(false);
    expect(updateWorkspaceSchema.safeParse({ timezone: 'Asia/Kolkata' }).success).toBe(true);
    expect(updateWorkspaceSchema.safeParse({}).success).toBe(false);
  });
});
