import { describe, expect, it } from 'vitest';
import { cursorQuery, inviteMemberSchema, registerSchema, updateWorkspaceSchema } from './index';

describe('validation', () => {
  it('normalizes email and enforces password length', () => {
    expect(
      registerSchema.parse({ email: ' A@B.com ', name: 'x', password: 'a'.repeat(12) }).email,
    ).toBe('a@b.com');
    expect(
      registerSchema.safeParse({ email: 'a@b.com', name: 'x', password: 'short' }).success,
    ).toBe(false);
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

import { createLinkSchema, listLinksQuery, updateLinkSchema } from './index';

describe('link schemas', () => {
  it('accepts a minimal link and normalizes blank optionals to null', () => {
    const v = createLinkSchema.parse({
      destinationUrl: 'https://a.com',
      title: '  ',
      utmSource: '',
    });
    expect(v.title).toBeNull();
    expect(v.utmSource).toBeNull();
  });
  it('parses ISO expiry into a Date and rejects junk', () => {
    expect(
      createLinkSchema.parse({ destinationUrl: 'https://a.com', expiresAt: '2030-01-01T00:00:00Z' })
        .expiresAt,
    ).toBeInstanceOf(Date);
    expect(
      createLinkSchema.safeParse({ destinationUrl: 'https://a.com', expiresAt: 'tomorrow' })
        .success,
    ).toBe(false);
  });
  it('only allows the four redirect status codes', () => {
    expect(
      createLinkSchema.safeParse({ destinationUrl: 'https://a.com', redirectStatus: 303 }).success,
    ).toBe(false);
    expect(
      createLinkSchema.safeParse({ destinationUrl: 'https://a.com', redirectStatus: 307 }).success,
    ).toBe(true);
  });
  it('update requires at least one field; list caps limit', () => {
    expect(updateLinkSchema.safeParse({}).success).toBe(false);
    expect(updateLinkSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(listLinksQuery.safeParse({ limit: '500' }).success).toBe(false);
    expect(listLinksQuery.parse({ isActive: 'false' }).isActive).toBe(false);
  });
});
