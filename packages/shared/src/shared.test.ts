import { describe, expect, it } from 'vitest';
import {
  buildCacheEntry,
  can,
  canAssignRole,
  checkCustomSlug,
  generateSlug,
  linkCacheKey,
  mergeUtm,
  normalizeDestinationUrl,
  normalizeHostname,
} from './index';

describe('slugs', () => {
  it('generates 7 char unambiguous slugs', () => {
    for (let i = 0; i < 200; i++)
      expect(generateSlug()).toMatch(/^[2-9a-hj-km-np-zA-HJ-KM-NP-Z]{7}$/);
  });
  it('rejects reserved, short and bad-charset custom slugs', () => {
    expect(checkCustomSlug('Admin')).toEqual({ ok: false, reason: 'reserved' });
    expect(checkCustomSlug('ab')).toEqual({ ok: false, reason: 'length' });
    expect(checkCustomSlug('a/b')).toEqual({ ok: false, reason: 'characters' });
    expect(checkCustomSlug('summer-sale')).toEqual({ ok: true });
  });
  it('honours a configured reserved list', () => {
    expect(checkCustomSlug('promo', ['promo'])).toEqual({ ok: false, reason: 'reserved' });
  });
});

describe('normalizeDestinationUrl', () => {
  it('accepts http(s)', () =>
    expect(normalizeDestinationUrl(' https://Example.com/a ')).toBe('https://example.com/a'));
  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///etc/passwd',
    'vbscript:x',
    'ftp://x.com',
    'not a url',
    'https://user:pw@example.com',
    'https://exa mple.com',
    '',
  ])('rejects %s', (u) => {
    expect(() => normalizeDestinationUrl(u)).toThrow();
  });
  it('rejects overlong URLs', () =>
    expect(() => normalizeDestinationUrl('https://a.com/' + 'x'.repeat(3000))).toThrow());
});

describe('mergeUtm', () => {
  it('adds missing params', () => {
    expect(mergeUtm('https://a.com/p', { utm_source: 'ig', utm_medium: 'social' })).toBe(
      'https://a.com/p?utm_source=ig&utm_medium=social',
    );
  });
  it('does not duplicate or override params already on the destination', () => {
    const out = new URL(
      mergeUtm('https://a.com/p?utm_source=mail&x=1', { utm_source: 'ig', utm_campaign: 'c' }),
    );
    expect(out.searchParams.getAll('utm_source')).toEqual(['mail']);
    expect(out.searchParams.get('utm_campaign')).toBe('c');
    expect(out.searchParams.get('x')).toBe('1');
  });
  it('ignores empty values', () =>
    expect(mergeUtm('https://a.com/', { utm_term: '' })).toBe('https://a.com/'));
});

describe('normalizeHostname', () => {
  it('normalizes and validates', () => {
    expect(normalizeHostname('Links.Client.com.')).toBe('links.client.com');
    expect(normalizeHostname('localhost')).toBeNull();
    expect(normalizeHostname('-bad.com')).toBeNull();
    expect(normalizeHostname('a b.com')).toBeNull();
  });
});

describe('permissions', () => {
  it('viewer is read-only', () => {
    expect(can('VIEWER', 'analytics:read')).toBe(true);
    expect(can('VIEWER', 'links:write')).toBe(false);
  });
  it('member can write links but not manage domains', () => {
    expect(can('MEMBER', 'links:write')).toBe(true);
    expect(can('MEMBER', 'domains:manage')).toBe(false);
  });
  it('admin manages members/domains but cannot delete workspace', () => {
    expect(can('ADMIN', 'domains:manage')).toBe(true);
    expect(can('ADMIN', 'workspace:delete')).toBe(false);
    expect(can('OWNER', 'workspace:delete')).toBe(true);
  });
  it('role assignment is bounded by actor role', () => {
    expect(canAssignRole('ADMIN', 'MEMBER')).toBe(true);
    expect(canAssignRole('ADMIN', 'OWNER')).toBe(false);
    expect(canAssignRole('MEMBER', 'VIEWER')).toBe(false);
    expect(canAssignRole('OWNER', 'OWNER')).toBe(true);
  });
});

describe('redirect cache entry', () => {
  const link = {
    id: 'l1',
    workspaceId: 'w1',
    campaignId: 'c1',
    destinationUrl: 'https://a.com/p?x=1',
    isActive: true,
    expiresAt: null,
    passwordHash: null,
    redirectStatus: null,
    utmSource: 'ig',
    utmMedium: 'social',
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
  };
  it('has stable, lowercase-host keys', () => {
    expect(linkCacheKey('Go.Example.com', 'aK92xP')).toBe('link:go.example.com:aK92xP');
  });
  it('merges UTM into the cached destination', () => {
    expect(buildCacheEntry(link).destinationUrl).toBe(
      'https://a.com/p?x=1&utm_source=ig&utm_medium=social',
    );
  });
  it('never caches the destination or hash of a password-protected link', () => {
    const e = buildCacheEntry({ ...link, passwordHash: '$argon2id$secret' });
    expect(e.destinationUrl).toBeNull();
    expect(e.hasPassword).toBe(true);
    expect(JSON.stringify(e)).not.toContain('argon2');
  });
  it('serializes expiry', () => {
    expect(
      buildCacheEntry({ ...link, expiresAt: new Date('2030-01-01T00:00:00Z') }).expiresAt,
    ).toBe('2030-01-01T00:00:00.000Z');
  });
});
